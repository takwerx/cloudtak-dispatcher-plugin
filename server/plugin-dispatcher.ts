// CloudTAK lints copied plugin routes with its OWN house-style rules, which differ across
// versions: @stylistic/brace-style flips between 13.2 (Stroustrup) and 13.3 (1TBS), and
// isn't even defined on 12.82 (naming it in a disable errors there). A plugin can't satisfy
// every CloudTAK version, so opt this route file out of CloudTAK's lint — the plugin repo
// owns its correctness (vue-tsc/eslint in dev).
/* eslint-disable */
import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
// CloudTAK 13.45+ (hub/api split): routes live in api/stateless/routes/, shared libs
// moved to api/common/, and route files receive ConfigStateless (which still extends
// the base Config owning pg/models/server — our raw drizzle SQL is unaffected).
// This file therefore requires CloudTAK >= 13.45; the infra-TAK installer copies it
// into api/stateless/routes/ and refuses to install onto a pre-split tree.
import Auth from '../../common/auth.js';
import { TAKAPI, APIAuthCertificate } from '@tak-ps/node-tak';
import type ConfigStateless from '../config.js';

// Server-side store for the standalone Dispatcher: Events (1:1 with a DataSync feed) and the
// Incidents within them. Lives in CloudTAK's own Postgres so every dispatcher on this CloudTAK
// shares the same board — closed incidents persist (findable) until the Event is nuked.
//
// We own two tables via CREATE TABLE IF NOT EXISTS (config.pg is a drizzle PgDatabase, so
// config.pg.execute(sql`...`) runs raw SQL); this does not touch CloudTAK's drizzle migrations,
// and the gis DB survives API image rebuilds. Auto-loaded by schema.load('./routes/') and
// installed alongside the TAK-CAD proxy route by the infra-TAK plugin installer.

interface EventRow {
    id: string;
    name: string;
    prefix: string;
    feed_guid: string;
    feed_name: string;
    channel: string | null;
    status: string;
    seq: number;
    created_at: string;
    created_by: string | null;
}

interface IncidentRow {
    id: string;
    event_id: string;
    number: string;
    type: string | null;
    address: string | null;
    lat: number | null;
    lon: number | null;
    dispatcher: string | null;
    details: string | null;
    status: string;
    assigned: unknown;
    notes: unknown;
    created_at: string;
    closed_at: string | null;
}

// drizzle's execute() returns the driver RowList; cast to the row shape we SELECTed.
async function query<T>(config: ConfigStateless, statement: ReturnType<typeof sql>): Promise<T[]> {
    const result = await config.pg.execute(statement);
    return result as unknown as T[];
}

// jsonb columns can come back from the driver as a (possibly double-encoded) JSON string.
// Unwrap to a real array so the UI can map/spread it, and so a read-modify-write never
// re-JSON.stringifies an already-stringified value (which double-encodes the column).
function asArray(v: unknown): unknown[] {
    let x: unknown = v;
    for (let i = 0; i < 4 && typeof x === 'string'; i++) {
        try {
            x = JSON.parse(x);
        } catch {
            return [];
        }
    }
    return Array.isArray(x) ? x : [];
}

// Normalize an incident row's jsonb fields to arrays before sending it to the client.
function mapIncident(row: IncidentRow): IncidentRow {
    return { ...row, assigned: asArray(row.assigned), notes: asArray(row.notes) };
}

// ── Feed-driven visibility ────────────────────────────────────────────────────
// The chain is event → feed → channel (operator design, 2026-08-13): every event
// syncs to a DataSync feed, the feed carries the channel, and the channel drives
// access. Enforcement therefore derives from ONE rule — you can see an event iff
// TAK Server shows you its feed. That single rule covers everything: channel
// removal hides the feed (and thus the event), toggling a channel off hides its
// missions (and thus its events), a public feed means a public event, and legacy
// channel-less events simply follow their feed like everything else. The stored
// event.channel is display metadata (badges); the feed is the law. Orphaned
// events (feed deleted outside the plugin) become invisible — the rows persist
// in the DB. Resolved with the caller's own client certificate — same pattern as
// the TAK-CAD proxy — and cached briefly per user so refreshes don't hammer TAK.

const TAK_CACHE_TTL_MS = 60_000;
const channelCache = new Map<string, { ts: number; channels: Set<string> }>();
const feedCache = new Map<string, { ts: number; feeds: Map<string, string[]> }>();

async function userApi(config: ConfigStateless, email: string) {
    const profile = await config.models.Profile.from(email);
    return await TAKAPI.init(new URL(String(config.server.api)), new APIAuthCertificate(profile.auth.cert, profile.auth.key));
}

// Channels the user is a member of — used to validate channel labels on write.
async function userChannels(config: ConfigStateless, email: string): Promise<Set<string>> {
    const hit = channelCache.get(email);
    if (hit && Date.now() - hit.ts < TAK_CACHE_TTL_MS) return hit.channels;
    const api = await userApi(config, email);
    const groups = await api.Group.list({}) as { data?: { name: string }[] };
    const channels = new Set((groups.data ?? []).map(g => g.name));
    channelCache.set(email, { ts: Date.now(), channels });
    return channels;
}

// DataSync feeds (missions) TAK Server currently shows this user, with each feed's
// live channel list — feeds ALWAYS live in channels; this is the display truth the
// event badges render from (the stored event.channel label is only a fallback).
async function userFeeds(config: ConfigStateless, email: string): Promise<Map<string, string[]>> {
    const hit = feedCache.get(email);
    if (hit && Date.now() - hit.ts < TAK_CACHE_TTL_MS) return hit.feeds;
    const api = await userApi(config, email);
    const missions = await api.Mission.list({}) as { data?: { guid: string; groups?: string | string[] }[] };
    const feeds = new Map<string, string[]>();
    for (const m of missions.data ?? []) {
        feeds.set(m.guid, !m.groups ? [] : Array.isArray(m.groups) ? m.groups : [m.groups]);
    }
    feedCache.set(email, { ts: Date.now(), feeds });
    return feeds;
}

async function eventById(config: ConfigStateless, eventid: string): Promise<EventRow | null> {
    const rows = await query<EventRow>(config, sql`
        SELECT id, name, prefix, feed_guid, feed_name, channel, status, seq, created_at, created_by
        FROM dispatcher_events WHERE id = ${eventid}
    `);
    return rows[0] ?? null;
}

// Load the event and 403/404 unless the caller's TAK view includes its feed.
async function requireEventAccess(config: ConfigStateless, email: string, eventid: string): Promise<EventRow> {
    const ev = await eventById(config, eventid);
    if (!ev) throw new Err(404, null, 'Event not found');
    if (!(await userFeeds(config, email)).has(ev.feed_guid)) {
        throw new Err(403, null, 'No access to this event\'s DataSync feed');
    }
    return ev;
}

export default async function router(schema: Schema, config: ConfigStateless) {
    // Idempotent schema bootstrap. Best-effort so a transient DB hiccup can't block CloudTAK
    // startup; CREATE TABLE IF NOT EXISTS is safe to re-run on every load.
    try {
        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS dispatcher_events (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                prefix      TEXT NOT NULL,
                feed_guid   TEXT NOT NULL,
                feed_name   TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'active',
                seq         INTEGER NOT NULL DEFAULT 0,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                created_by  TEXT
            )
        `);
        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS dispatcher_incidents (
                id          TEXT PRIMARY KEY,
                event_id    TEXT NOT NULL REFERENCES dispatcher_events(id) ON DELETE CASCADE,
                number      TEXT NOT NULL,
                type        TEXT,
                address     TEXT,
                lat         DOUBLE PRECISION,
                lon         DOUBLE PRECISION,
                dispatcher  TEXT,
                details     TEXT,
                status      TEXT NOT NULL DEFAULT 'active',
                assigned    JSONB NOT NULL DEFAULT '[]'::jsonb,
                notes       JSONB NOT NULL DEFAULT '[]'::jsonb,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                closed_at   TIMESTAMPTZ
            )
        `);
        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS dispatcher_settings (
                key   TEXT PRIMARY KEY,
                value JSONB NOT NULL
            )
        `);
        // Channel label (v1.1) — display metadata; visibility is feed-driven (v1.2).
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_events ADD COLUMN IF NOT EXISTS channel TEXT
        `);
    } catch (err) {
        console.error('[dispatcher] table bootstrap failed', err);
    }

    // ── Settings (shared per-CloudTAK, e.g. agency identity on reports) ─────────

    await schema.get('/dispatcher/settings', {
        name: 'Get Dispatcher Settings',
        group: 'Dispatcher',
        description: 'All shared dispatcher settings as a key/value map',
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.is_auth(config, req);
            const rows = await query<{ key: string; value: unknown }>(config, sql`
                SELECT key, value FROM dispatcher_settings
            `);
            const settings: Record<string, unknown> = {};
            for (const r of rows) {
                // Same jsonb normalize as asArray: a raw read can hand back a string.
                settings[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
            }
            res.json({ settings });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.put('/dispatcher/settings/:key', {
        name: 'Put Dispatcher Setting',
        group: 'Dispatcher',
        description: 'Upsert one shared dispatcher setting',
        params: Type.Object({ key: Type.String() }),
        body: Type.Object({ value: Type.Any() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.is_auth(config, req);
            const encoded = JSON.stringify(req.body.value ?? null);
            // Settings carry small blobs (agency logo as a downscaled data URI) — cap the
            // row so a raw upload can't bloat the gis DB.
            if (encoded.length > 400_000) throw new Err(400, null, 'Setting too large (400KB max)');
            await config.pg.execute(sql`
                INSERT INTO dispatcher_settings (key, value)
                VALUES (${req.params.key}, ${encoded}::jsonb)
                ON CONFLICT (key) DO UPDATE SET value = ${encoded}::jsonb
            `);
            res.json({ ok: true });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // ── Events ──────────────────────────────────────────────────────────────────

    await schema.get('/dispatcher/events', {
        name: 'List Events',
        group: 'Dispatcher',
        description: 'List dispatcher events visible to the caller (active + archived)',
        query: Type.Object({
            // fresh=1 bypasses the 60s feed-visibility cache — the board's manual
            // refresh uses it so a channel toggle shows immediately.
            fresh: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            if (req.query.fresh) feedCache.delete(user.email);
            const feeds = await userFeeds(config, user.email);
            const events = await query<EventRow>(config, sql`
                SELECT id, name, prefix, feed_guid, feed_name, channel, status, seq, created_at, created_by
                FROM dispatcher_events ORDER BY created_at DESC
            `);
            res.json({
                events: events
                    .filter(e => feeds.has(e.feed_guid))
                    // feed_channels = the feed's LIVE channels (badges render from this;
                    // stored channel label is only a fallback for older responses).
                    .map(e => ({ ...e, feed_channels: feeds.get(e.feed_guid) ?? [] })),
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/dispatcher/events', {
        name: 'Create Event',
        group: 'Dispatcher',
        description: 'Create a dispatcher event tied to a DataSync feed',
        body: Type.Object({
            name: Type.String(),
            prefix: Type.String(),
            feed_guid: Type.String(),
            feed_name: Type.String(),
            channel: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            const channel = (req.body.channel || '').trim() || null;
            if (channel && !(await userChannels(config, user.email)).has(channel)) {
                throw new Err(403, null, `You are not a member of channel "${channel}"`);
            }
            const id = randomUUID();
            const prefix = (req.body.prefix || 'INC').replace(/[^A-Z0-9-]/gi, '').toUpperCase().slice(0, 12) || 'INC';
            const events = await query<EventRow>(config, sql`
                INSERT INTO dispatcher_events (id, name, prefix, feed_guid, feed_name, channel, created_by)
                VALUES (${id}, ${req.body.name}, ${prefix}, ${req.body.feed_guid}, ${req.body.feed_name}, ${channel}, ${user.email})
                RETURNING id, name, prefix, feed_guid, feed_name, channel, status, seq, created_at, created_by
            `);
            res.json({ event: events[0] });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/dispatcher/events/:eventid', {
        name: 'Update Event',
        group: 'Dispatcher',
        description: 'Archive/reactivate an event, or assign its channel',
        params: Type.Object({ eventid: Type.String() }),
        body: Type.Object({
            status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('archived')])),
            channel: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            const ev = await requireEventAccess(config, user.email, req.params.eventid);
            const nextChannel = req.body.channel !== undefined
                ? ((req.body.channel || '').trim() || null)
                : ev.channel;
            if (nextChannel && nextChannel !== ev.channel
                && !(await userChannels(config, user.email)).has(nextChannel)) {
                throw new Err(403, null, `You are not a member of channel "${nextChannel}"`);
            }
            const events = await query<EventRow>(config, sql`
                UPDATE dispatcher_events
                SET status = ${req.body.status ?? ev.status}, channel = ${nextChannel}
                WHERE id = ${req.params.eventid}
                RETURNING id, name, prefix, feed_guid, feed_name, channel, status, seq, created_at, created_by
            `);
            res.json({ event: events[0] });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/dispatcher/events/:eventid', {
        name: 'Delete Event',
        group: 'Dispatcher',
        description: 'Nuke an event and all its incidents (permanent)',
        params: Type.Object({ eventid: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireEventAccess(config, user.email, req.params.eventid);
            await config.pg.execute(sql`DELETE FROM dispatcher_events WHERE id = ${req.params.eventid}`);
            res.json({ status: 200, message: 'deleted' });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // ── Incidents ───────────────────────────────────────────────────────────────

    await schema.get('/dispatcher/events/:eventid/incidents', {
        name: 'List Incidents',
        group: 'Dispatcher',
        description: 'List incidents in an event (active + closed)',
        params: Type.Object({ eventid: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireEventAccess(config, user.email, req.params.eventid);
            const incidents = await query<IncidentRow>(config, sql`
                SELECT id, event_id, number, type, address, lat, lon, dispatcher, details,
                       status, assigned, notes, created_at, closed_at
                FROM dispatcher_incidents WHERE event_id = ${req.params.eventid}
                ORDER BY created_at ASC
            `);
            res.json({ incidents: incidents.map(mapIncident) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/dispatcher/events/:eventid/incidents', {
        name: 'Create Incident',
        group: 'Dispatcher',
        description: 'Create an incident in an event (number assigned server-side)',
        params: Type.Object({ eventid: Type.String() }),
        body: Type.Object({
            type: Type.Optional(Type.String()),
            address: Type.Optional(Type.String()),
            lat: Type.Number(),
            lon: Type.Number(),
            dispatcher: Type.Optional(Type.String()),
            details: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireEventAccess(config, user.email, req.params.eventid);

            // Atomically claim the next sequence number for this event.
            const bumped = await query<{ seq: number; prefix: string }>(config, sql`
                UPDATE dispatcher_events SET seq = seq + 1 WHERE id = ${req.params.eventid}
                RETURNING seq, prefix
            `);
            if (!bumped.length) throw new Err(404, null, 'Event not found');
            const number = `${bumped[0].prefix}-${String(bumped[0].seq).padStart(3, '0')}`;

            const id = randomUUID();
            // Details entered at creation also seed the notes log as its first entry —
            // dispatchers work off the running note stream, where details-only was invisible.
            const seedNotes = req.body.details
                ? [{ text: req.body.details, time: new Date().toISOString() }]
                : [];
            const incidents = await query<IncidentRow>(config, sql`
                INSERT INTO dispatcher_incidents
                    (id, event_id, number, type, address, lat, lon, dispatcher, details, notes)
                VALUES
                    (${id}, ${req.params.eventid}, ${number}, ${req.body.type ?? null},
                     ${req.body.address ?? null}, ${req.body.lat}, ${req.body.lon},
                     ${req.body.dispatcher ?? null}, ${req.body.details ?? null},
                     ${JSON.stringify(seedNotes)}::jsonb)
                RETURNING id, event_id, number, type, address, lat, lon, dispatcher, details,
                          status, assigned, notes, created_at, closed_at
            `);
            res.json({ incident: mapIncident(incidents[0]) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/dispatcher/incidents/:incidentid', {
        name: 'Update Incident',
        group: 'Dispatcher',
        description: 'Update an incident (assign / note / close / reopen)',
        params: Type.Object({ incidentid: Type.String() }),
        body: Type.Object({
            type: Type.Optional(Type.String()),
            address: Type.Optional(Type.String()),
            lat: Type.Optional(Type.Number()),
            lon: Type.Optional(Type.Number()),
            dispatcher: Type.Optional(Type.String()),
            details: Type.Optional(Type.String()),
            status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('closed')])),
            assigned: Type.Optional(Type.Array(Type.Any())),
            notes: Type.Optional(Type.Array(Type.Any())),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            // Read-modify-write: merge the patch over the current row, then write all columns.
            const current = await query<IncidentRow>(config, sql`
                SELECT id, event_id, number, type, address, lat, lon, dispatcher, details,
                       status, assigned, notes, created_at, closed_at
                FROM dispatcher_incidents WHERE id = ${req.params.incidentid}
            `);
            if (!current.length) throw new Err(404, null, 'Incident not found');
            const cur = current[0];
            await requireEventAccess(config, user.email, cur.event_id);
            const b = req.body;

            const next = {
                type: b.type ?? cur.type,
                address: b.address ?? cur.address,
                lat: b.lat ?? cur.lat,
                lon: b.lon ?? cur.lon,
                dispatcher: b.dispatcher ?? cur.dispatcher,
                details: b.details ?? cur.details,
                status: b.status ?? cur.status,
                assigned: b.assigned ?? asArray(cur.assigned),
                notes: b.notes ?? asArray(cur.notes),
            };
            // Closing stamps closed_at; reopening clears it.
            const closedAt = next.status === 'closed'
                ? (cur.closed_at ?? new Date().toISOString())
                : null;

            const incidents = await query<IncidentRow>(config, sql`
                UPDATE dispatcher_incidents SET
                    type       = ${next.type},
                    address    = ${next.address},
                    lat        = ${next.lat},
                    lon        = ${next.lon},
                    dispatcher = ${next.dispatcher},
                    details    = ${next.details},
                    status     = ${next.status},
                    assigned   = ${JSON.stringify(next.assigned)}::jsonb,
                    notes      = ${JSON.stringify(next.notes)}::jsonb,
                    closed_at  = ${closedAt}
                WHERE id = ${req.params.incidentid}
                RETURNING id, event_id, number, type, address, lat, lon, dispatcher, details,
                          status, assigned, notes, created_at, closed_at
            `);
            res.json({ incident: mapIncident(incidents[0]) });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
