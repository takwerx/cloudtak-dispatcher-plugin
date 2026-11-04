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
    report_number: string | null;
    // `callers` is the stored list. caller_name / caller_phone are NOT columns we read: mapIncident
    // derives them from the primary caller so older clients and PR code keep a single name/phone.
    callers?: unknown;
    caller_name?: string | null;
    caller_phone?: string | null;
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

// Report numbers are free text from the agency's records system. Trim, cap the length,
// and store an empty value as NULL so "cleared" and "never set" read the same.
const REPORT_NUMBER_MAX = 64;
function normReportNumber(v: string | undefined): string | null {
    const t = (v ?? '').trim();
    if (t.length > REPORT_NUMBER_MAX) throw new Err(400, null, `Report number is too long (${REPORT_NUMBER_MAX} characters max)`);
    return t || null;
}

// ── Callers ─────────────────────────────────────────────────────────────────────
// An incident keeps a list of callers (several calls about one crash, each with the time of the
// call). Exactly one is the PRIMARY caller: the first one added unless a dispatcher picks another.
// A CoT <contact> holds one phone, so the primary caller's number is the marker's tap-to-call
// number; every caller is listed in the marker remarks, the report and the CSV. Callers are NOT
// copied into the notes log, so switching Caller Details off keeps all of it off the markers.
// The list logic below is pure (no database) so plugin/test/callers-server.test.ts can run it.
// <callers-pure>
const CALLER_NAME_MAX = 120;
const CALLER_PHONE_MAX = 40;
const CALLER_NOTE_MAX = 200;
const CALLERS_MAX = 50;

interface CallerEntry {
    id: string;
    name: string | null;
    phone: string | null;
    note: string | null;
    time: string;      // when the call was received (ISO)
    primary: boolean;
}

// Free text from the call taker: trim, cap the length, store empty as NULL.
function normCaller(v: string | undefined, max: number, label: string): string | null {
    const t = (v ?? '').trim();
    if (t.length > max) throw new Err(400, null, `${label} is too long (${max} characters max)`);
    return t || null;
}

// The time of a call: a valid date, stored as ISO. Missing means "now".
function normCallTime(v: string | undefined): string {
    if (v === undefined || v === '') return new Date().toISOString();
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new Err(400, null, 'Call time is not a valid date');
    return d.toISOString();
}

// Normalize a stored list: drop junk, order by call time (stable), and enforce exactly one
// primary (the first one marked, else the first caller) whenever the list is not empty.
function normalizeCallers(v: unknown): CallerEntry[] {
    const list = asArray(v)
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c, i) => ({
            id: typeof c.id === 'string' && c.id ? c.id : `caller-${i}`,
            name: typeof c.name === 'string' && c.name ? c.name : null,
            phone: typeof c.phone === 'string' && c.phone ? c.phone : null,
            note: typeof c.note === 'string' && c.note ? c.note : null,
            time: typeof c.time === 'string' && !Number.isNaN(new Date(c.time).getTime()) ? c.time : new Date(0).toISOString(),
            primary: c.primary === true,
            i,
        }))
        .sort((a, b) => (new Date(a.time).getTime() - new Date(b.time).getTime()) || (a.i - b.i));
    const primaryIdx = Math.max(0, list.findIndex(c => c.primary));
    return list.map(({ i: _i, ...c }, n) => ({ ...c, primary: n === primaryIdx }));
}

interface CallerInput {
    name?: string;
    phone?: string;
    note?: string;
    time?: string;
    primary?: boolean;
}

// Add a caller (the first one is always primary). A caller needs a name or a phone.
function addCallerTo(list: CallerEntry[], b: CallerInput): CallerEntry[] {
    const name = normCaller(b.name, CALLER_NAME_MAX, 'Caller name');
    const phone = normCaller(b.phone, CALLER_PHONE_MAX, 'Caller phone');
    const note = normCaller(b.note, CALLER_NOTE_MAX, 'Caller note');
    if (!name && !phone) throw new Err(400, null, 'Enter a caller name or phone number');
    if (list.length >= CALLERS_MAX) throw new Err(400, null, `An incident can have at most ${CALLERS_MAX} callers`);
    const primary = b.primary === true || list.length === 0;
    const entry: CallerEntry = { id: randomUUID(), name, phone, note, time: normCallTime(b.time), primary };
    return [...list.map(c => (primary ? { ...c, primary: false } : c)), entry];
}

// Edit one caller. undefined = leave as is, '' = clear. primary: true makes this caller the primary.
function updateCallerIn(list: CallerEntry[], id: string, b: CallerInput): CallerEntry[] {
    if (!list.some(c => c.id === id)) throw new Err(404, null, 'Caller not found');
    const name = b.name !== undefined ? normCaller(b.name, CALLER_NAME_MAX, 'Caller name') : undefined;
    const phone = b.phone !== undefined ? normCaller(b.phone, CALLER_PHONE_MAX, 'Caller phone') : undefined;
    const note = b.note !== undefined ? normCaller(b.note, CALLER_NOTE_MAX, 'Caller note') : undefined;
    const time = b.time !== undefined ? normCallTime(b.time) : undefined;
    return list.map((c) => {
        if (c.id !== id) return b.primary ? { ...c, primary: false } : c;
        const next = {
            ...c,
            name: name !== undefined ? name : c.name,
            phone: phone !== undefined ? phone : c.phone,
            note: note !== undefined ? note : c.note,
            time: time !== undefined ? time : c.time,
            primary: b.primary ? true : c.primary,
        };
        if (!next.name && !next.phone) throw new Err(400, null, 'A caller needs a name or phone number. Remove the caller instead.');
        return next;
    });
}

// Remove a caller. If it was the primary, normalizeCallers promotes the first one left.
function removeCallerFrom(list: CallerEntry[], id: string): CallerEntry[] {
    if (!list.some(c => c.id === id)) throw new Err(404, null, 'Caller not found');
    return list.filter(c => c.id !== id);
}

// A single caller from the New Incident form (or the old caller_name / caller_phone fields).
function firstCaller(nameIn: string | undefined, phoneIn: string | undefined): CallerEntry[] {
    const name = normCaller(nameIn, CALLER_NAME_MAX, 'Caller name');
    const phone = normCaller(phoneIn, CALLER_PHONE_MAX, 'Caller phone');
    return (name || phone)
        ? [{ id: randomUUID(), name, phone, note: null, time: new Date().toISOString(), primary: true }]
        : [];
}
// </callers-pure>

// Normalize an incident row's jsonb fields to arrays before sending it to the client, and
// derive caller_name / caller_phone from the primary caller.
function mapIncident(row: IncidentRow): IncidentRow {
    const callers = normalizeCallers(row.callers);
    const primary = callers.find(c => c.primary);
    return {
        ...row,
        assigned: asArray(row.assigned),
        notes: asArray(row.notes),
        callers,
        caller_name: primary?.name ?? null,
        caller_phone: primary?.phone ?? null,
    };
}

// Lock the incident row, apply `edit` to its caller list and write it back, all in one
// transaction, so two dispatchers changing callers at the same moment can't overwrite each
// other. The incident PATCH never writes `callers`, and caller changes never write `notes`.
async function editCallers(
    config: ConfigStateless,
    incidentid: string,
    edit: (list: CallerEntry[]) => CallerEntry[],
): Promise<IncidentRow> {
    return await config.pg.transaction(async (tx) => {
        const locked = await tx.execute(sql`
            SELECT callers FROM dispatcher_incidents WHERE id = ${incidentid} FOR UPDATE
        `) as unknown as { callers: unknown }[];
        if (!locked.length) throw new Err(404, null, 'Incident not found');
        const next = normalizeCallers(edit(normalizeCallers(locked[0].callers)));
        const rows = await tx.execute(sql`
            UPDATE dispatcher_incidents SET callers = ${JSON.stringify(next)}::jsonb
            WHERE id = ${incidentid}
            RETURNING id, event_id, number, type, address, lat, lon, dispatcher, details,
                      report_number, callers, status, assigned, notes, created_at, closed_at
        `) as unknown as IncidentRow[];
        return mapIncident(rows[0]);
    });
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
    const auth = profile.auth;
    if (!auth) throw new Err(401, null, 'User has been provisioned but has not yet logged in');
    return await TAKAPI.init(new URL(String(config.server.api)), new APIAuthCertificate(auth.cert, auth.key));
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

// Access check for the caller routes: the incident's Event feed must be visible to the user.
async function requireIncidentAccess(config: ConfigStateless, email: string, incidentid: string): Promise<void> {
    const rows = await query<{ event_id: string }>(config, sql`
        SELECT event_id FROM dispatcher_incidents WHERE id = ${incidentid}
    `);
    if (!rows.length) throw new Err(404, null, 'Incident not found');
    await requireEventAccess(config, email, rows[0].event_id);
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
        // Report number — optional agency report/case number, often assigned after
        // the incident is opened. Nullable, so existing incidents are unaffected.
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS report_number TEXT
        `);
        // Callers (standalone mode): a list, so one incident can have several callers.
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS callers JSONB NOT NULL DEFAULT '[]'::jsonb
        `);
        // A database that ran the single-caller version has caller_name / caller_phone columns:
        // move each value into the list once (as the primary caller, received when the incident
        // was opened) and empty the old columns, so a restart never copies them twice.
        await config.pg.execute(sql`
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = current_schema() AND table_name = 'dispatcher_incidents'
                             AND column_name = 'caller_name')
                   AND EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = current_schema() AND table_name = 'dispatcher_incidents'
                             AND column_name = 'caller_phone') THEN
                    UPDATE dispatcher_incidents
                    SET callers = jsonb_build_array(jsonb_build_object(
                            'id', gen_random_uuid()::text, 'name', caller_name, 'phone', caller_phone,
                            'note', NULL, 'time', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                            'primary', true)),
                        caller_name = NULL, caller_phone = NULL
                    WHERE callers = '[]'::jsonb AND (caller_name IS NOT NULL OR caller_phone IS NOT NULL);
                END IF;
            END $$
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
                       report_number, callers, status, assigned, notes, created_at, closed_at
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
            report_number: Type.Optional(Type.String()),
            caller_name: Type.Optional(Type.String()),
            caller_phone: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireEventAccess(config, user.email, req.params.eventid);
            const reportNumber = normReportNumber(req.body.report_number);
            // The New Incident form records the first caller; more are added from the incident.
            const callers = firstCaller(req.body.caller_name, req.body.caller_phone);

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
            const now = new Date().toISOString();
            const seedNotes: { text: string; time: string }[] = [];
            if (req.body.details) seedNotes.push({ text: req.body.details, time: now });
            if (reportNumber) seedNotes.push({ text: `Report number: ${reportNumber}`, time: now });
            const incidents = await query<IncidentRow>(config, sql`
                INSERT INTO dispatcher_incidents
                    (id, event_id, number, type, address, lat, lon, dispatcher, details, report_number, callers, notes)
                VALUES
                    (${id}, ${req.params.eventid}, ${number}, ${req.body.type ?? null},
                     ${req.body.address ?? null}, ${req.body.lat}, ${req.body.lon},
                     ${req.body.dispatcher ?? null}, ${req.body.details ?? null}, ${reportNumber},
                     ${JSON.stringify(callers)}::jsonb,
                     ${JSON.stringify(seedNotes)}::jsonb)
                RETURNING id, event_id, number, type, address, lat, lon, dispatcher, details,
                          report_number, callers, status, assigned, notes, created_at, closed_at
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
            report_number: Type.Optional(Type.String()),
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
                       report_number, callers, status, assigned, notes, created_at, closed_at
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
            // Report number: undefined = leave as is; '' = clear. A change is logged as a
            // timestamped note here on the server, so the history survives even though the
            // column itself only holds the current value.
            const reportNumber = b.report_number !== undefined
                ? normReportNumber(b.report_number)
                : cur.report_number;
            if (reportNumber !== cur.report_number) {
                next.notes = [...next.notes, {
                    text: reportNumber
                        ? (cur.report_number ? `Report number changed: ${cur.report_number} → ${reportNumber}` : `Report number: ${reportNumber}`)
                        : `Report number cleared (was ${cur.report_number})`,
                    time: new Date().toISOString(),
                }];
            }

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
                    report_number = ${reportNumber},
                    status     = ${next.status},
                    assigned   = ${JSON.stringify(next.assigned)}::jsonb,
                    notes      = ${JSON.stringify(next.notes)}::jsonb,
                    closed_at  = ${closedAt}
                WHERE id = ${req.params.incidentid}
                RETURNING id, event_id, number, type, address, lat, lon, dispatcher, details,
                          report_number, callers, status, assigned, notes, created_at, closed_at
            `);
            res.json({ incident: mapIncident(incidents[0]) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // ── Callers ─────────────────────────────────────────────────────────────────
    // Each change goes through editCallers (row lock + one UPDATE). Callers are not copied into
    // the notes log; the list itself is the record, with the time of each call.

    await schema.post('/dispatcher/incidents/:incidentid/callers', {
        name: 'Add Caller',
        group: 'Dispatcher',
        description: 'Add a caller to an incident (the first caller becomes primary)',
        params: Type.Object({ incidentid: Type.String() }),
        body: Type.Object({
            name: Type.Optional(Type.String()),
            phone: Type.Optional(Type.String()),
            note: Type.Optional(Type.String()),
            time: Type.Optional(Type.String()),
            primary: Type.Optional(Type.Boolean()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireIncidentAccess(config, user.email, req.params.incidentid);
            const incident = await editCallers(config, req.params.incidentid, list => addCallerTo(list, req.body));
            res.json({ incident });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/dispatcher/incidents/:incidentid/callers/:callerid', {
        name: 'Update Caller',
        group: 'Dispatcher',
        description: 'Edit a caller, or make them the primary caller',
        params: Type.Object({ incidentid: Type.String(), callerid: Type.String() }),
        body: Type.Object({
            name: Type.Optional(Type.String()),
            phone: Type.Optional(Type.String()),
            note: Type.Optional(Type.String()),
            time: Type.Optional(Type.String()),
            primary: Type.Optional(Type.Literal(true)),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireIncidentAccess(config, user.email, req.params.incidentid);
            const incident = await editCallers(config, req.params.incidentid, list => updateCallerIn(list, req.params.callerid, req.body));
            res.json({ incident });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/dispatcher/incidents/:incidentid/callers/:callerid', {
        name: 'Remove Caller',
        group: 'Dispatcher',
        description: 'Remove a caller (if it was primary, the first remaining caller becomes primary)',
        params: Type.Object({ incidentid: Type.String(), callerid: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireIncidentAccess(config, user.email, req.params.incidentid);
            const incident = await editCallers(config, req.params.incidentid, list => removeCallerFrom(list, req.params.callerid));
            res.json({ incident });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
