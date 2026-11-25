// CloudTAK lints copied plugin routes with its OWN house-style rules, which differ across
// versions: @stylistic/brace-style flips between 13.2 (Stroustrup) and 13.3 (1TBS), and
// isn't even defined on 12.82 (naming it in a disable errors there). A plugin can't satisfy
// every CloudTAK version, so opt this route file out of CloudTAK's lint — the plugin repo
// owns its correctness (vue-tsc/eslint in dev).
/* eslint-disable */
import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
// CloudTAK 13.45+ (hub/api split) — see plugin-dispatcher.ts header; same contract:
// api/stateless/routes/ placement, libs from api/common/, ConfigStateless signature.
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';
import { TAKAPI, APIAuthCertificate } from '@tak-ps/node-tak';
import { sql } from 'drizzle-orm';

// ── Who may use the Dispatcher ──────────────────────────────────────────────────
// Optional limit set by a CloudTAK system admin in Dispatcher Settings (dispatcher_settings key
// `allowed_groups`, a list of TAK group names). An empty or missing list is OFF: every signed-in user
// gets the Dispatcher, exactly as before. With names in the list, a signed-in user gets it only when
// they are a CloudTAK system admin or a member of one of those TAK groups; anyone else is refused
// with a 403 on every route of the plugin, and the plugin hides its menu item (GET /dispatcher/access).
// The list is read on every request, so a change takes effect at once. A user's TAK groups come from
// TAK Server with their own certificate and are cached for a minute. If the list cannot be read or the
// groups cannot be looked up, the user is refused (never let in by accident); admins never need the lookup.
// The same block is in plugin-dispatcher.ts, plugin-addressing.ts and plugin-takcad.ts (CloudTAK loads
// each route file on its own, so they cannot share one); plugin/test/access-server.test.ts fails if the
// three copies differ. Group names are compared ignoring upper and lower case, spaces at the ends ignored.
// <access-gate>
const ALLOWED_GROUPS_SETTING = 'allowed_groups';
const ACCESS_DENIED = 'The Dispatcher is limited to certain TAK groups, and your account is not in one of them. Ask your CloudTAK admin.';
const ACCESS_GROUP_TTL_MS = 60_000;
const accessGroupCache = new Map<string, { ts: number; groups: string[] }>();

// The stored setting as a limit. Off for no value, '' or an empty list. A list with names is on. Anything
// else (a hand-edited value that is not a list) is on with no names, so only admins get in until an admin fixes it.
function parseAllowedGroups(stored: unknown): { limited: boolean; groups: string[] } {
    let v: unknown = stored;
    for (let i = 0; i < 2 && typeof v === 'string'; i++) {
        try { v = JSON.parse(v); } catch { break; }
    }
    if (v === null || v === undefined || v === '') return { limited: false, groups: [] };
    if (!Array.isArray(v)) return { limited: true, groups: [] };
    if (v.length === 0) return { limited: false, groups: [] };
    const groups = v.filter((g): g is string => typeof g === 'string').map(g => g.trim()).filter(g => g.length > 0);
    return { limited: true, groups };
}

// May this user use the Dispatcher: no limit, or an admin, or a member of one of the listed groups.
function mayUseDispatcher(limit: { limited: boolean; groups: string[] }, isAdmin: boolean, memberOf: Iterable<string>): boolean {
    if (!limit.limited || isAdmin) return true;
    const wanted = new Set(limit.groups.map(g => g.toLowerCase()));
    for (const g of memberOf) {
        if (typeof g === 'string' && wanted.has(g.trim().toLowerCase())) return true;
    }
    return false;
}

async function readDispatcherLimit(config: ConfigStateless): Promise<{ limited: boolean; groups: string[] }> {
    try {
        const rows = await config.pg.execute(sql`
            SELECT value FROM dispatcher_settings WHERE key = ${ALLOWED_GROUPS_SETTING}
        `) as unknown as { value: unknown }[];
        return parseAllowedGroups(rows[0]?.value);
    } catch (err) {
        console.error('[dispatcher] could not read who may use the Dispatcher', err);
        throw new Err(503, null, 'Could not check who may use the Dispatcher. Try again in a moment.');
    }
}

// The TAK groups the user belongs to, as TAK Server shows them with the user's own certificate.
async function dispatcherUserGroups(config: ConfigStateless, email: string): Promise<string[]> {
    const hit = accessGroupCache.get(email);
    if (hit && Date.now() - hit.ts < ACCESS_GROUP_TTL_MS) return hit.groups;
    try {
        const profile = await config.models.Profile.from(email);
        const auth = profile.auth;
        if (!auth) throw new Error('no certificate yet');
        const api = await TAKAPI.init(new URL(String(config.server.api)), new APIAuthCertificate(auth.cert, auth.key));
        const list = await api.Group.list({}) as { data?: { name: string }[] };
        const groups = (list.data ?? []).map(g => String(g.name));
        accessGroupCache.set(email, { ts: Date.now(), groups });
        return groups;
    } catch (err) {
        console.error('[dispatcher] could not read the TAK groups of a user', err);
        throw new Err(503, null, 'Could not check your TAK groups right now. Try again in a moment.');
    }
}

// What the caller may do: `limited` says whether the admin's list is on; `allowed` whether this caller gets in.
async function dispatcherAccess(config: ConfigStateless, req: any): Promise<{ allowed: boolean; limited: boolean; admin: boolean }> {
    const auth = await Auth.is_auth(config, req) as any;
    const limit = await readDispatcherLimit(config);
    const isUser = !!auth && typeof auth.is_admin === 'function' && typeof auth.email === 'string' && auth.email.length > 0;
    const admin = isUser && auth.is_admin() === true;
    if (!limit.limited) return { allowed: true, limited: false, admin };
    // A resource token (layer or connection) is not a person in a TAK group: refused while the limit is on.
    if (!isUser) return { allowed: false, limited: true, admin: false };
    if (admin) return { allowed: true, limited: true, admin: true };
    const groups = await dispatcherUserGroups(config, auth.email);
    return { allowed: mayUseDispatcher(limit, false, groups), limited: true, admin: false };
}

// First line of every route: signed in, and allowed by the admin's list.
async function requireDispatcherAccess(config: ConfigStateless, req: any): Promise<void> {
    const access = await dispatcherAccess(config, req);
    if (!access.allowed) throw new Err(403, null, ACCESS_DENIED);
}
// </access-gate>

// Server-side proxy for the TAK-CAD TAK Server plugin.
//
// The CloudTAK web plugin (api/web/plugins/takcad) runs in the browser and can
// only reach CloudTAK's own /api routes. CloudTAK has no generic passthrough to
// arbitrary /Marti/api/plugins/* endpoints, so this route forwards TAK-CAD calls
// to TAK Server using the caller's client-certificate auth (via TAKAPI.fetch).
//
// Auto-loaded by CloudTAK's schema.load('./routes/'). Installed and kept in
// place across CloudTAK updates by the infra-TAK plugin installer.

// TAK Server's plugin data API (DistributedPluginManager.requestDataFromPlugin)
// looks the plugin up by its fully-qualified class name, NOT a short alias.
// Path segment 'takcad' → "no plugin with class name takcad is currently installed".
const TAKCAD_BASE = '/Marti/api/plugins/tak.server.plugins.TakCadServerPlugin/submit';

// Nominatim (OpenStreetMap) geocoding — no API key required, better US address coverage.
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const NOMINATIM_HEADERS = { 'User-Agent': 'infra-TAK-dispatcher/1.0 (contact@takwerx.com)' };

type NominatimFeature = {
    display_name: string;
    lat: string;
    lon: string;
    address: Record<string, string>;
};

function nominatimToSuggestion(f: NominatimFeature) {
    const a = f.address || {};
    const street = [a.house_number, a.road || a.pedestrian || a.footway || a.path].filter(Boolean).join(' ');
    return {
        label: f.display_name || '',
        lat: parseFloat(f.lat),
        lon: parseFloat(f.lon),
        streetName: street || '',
        city: a.city || a.town || a.village || a.hamlet || a.county || '',
        state: a.state || '',
        zipCode: a.postcode || '',
        country: a.country || '',
    };
}

// The TAK Server client every proxy route below uses. Without ?connection= it acts as the
// caller's own profile certificate. With ?connection= it acts as that connection's certificate,
// so the caller must be allowed to use that connection: Auth.is_connection (the same check
// CloudTAK's own marti.ts proxy makes) lets a system admin, or an agency admin of that
// connection's agency, through and refuses everyone else. Every route must get its client here,
// never straight from config.models.Connection (the proof test in dispatcher.test.mjs checks it).
async function takServerApi(config: ConfigStateless, req: any): Promise<TAKAPI> {
    if (req.query.connection) {
        const { connection } = await Auth.is_connection(config, req, {}, Number(req.query.connection));
        return await TAKAPI.init(new URL(String(config.server.api)), new APIAuthCertificate(connection.auth.cert, connection.auth.key));
    }

    const user = await Auth.as_user(config, req);
    const profile = await config.models.Profile.from(user.email);
    const auth = profile.auth;
    if (!auth) throw new Err(401, null, 'User has been provisioned but has not yet logged in');
    return await TAKAPI.init(new URL(String(config.server.api)), new APIAuthCertificate(auth.cert, auth.key));
}

export default async function router(schema: Schema, config: ConfigStateless) {
    // Forward geocode — CloudTAK's CSP (connect-src 'self') blocks the browser from
    // calling openrouteservice.org directly, so proxy it through the API host.
    await schema.get('/takcad/geocode', {
        name: 'TAK-CAD Geocode',
        group: 'TAKCAD',
        description: 'Proxy an address geocode lookup to Nominatim (OpenStreetMap)',
        query: Type.Object({
            q: Type.String(),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireDispatcherAccess(config, req);
            await Auth.is_auth(config, req);

            const qs = new URLSearchParams({ q: String(req.query.q), format: 'json', addressdetails: '1', limit: '5' });
            const r = await fetch(`${NOMINATIM_BASE}/search?${qs.toString()}`, { headers: NOMINATIM_HEADERS });
            if (!r.ok) {
                res.json({ suggestions: [] });
                return;
            }
            const json = await r.json() as NominatimFeature[];
            res.json({ suggestions: (Array.isArray(json) ? json : []).map(nominatimToSuggestion) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // Reverse geocode — turn a map-clicked lat/lon into an address (for "pick on map").
    await schema.get('/takcad/geocode/reverse', {
        name: 'TAK-CAD Reverse Geocode',
        group: 'TAKCAD',
        description: 'Proxy a reverse geocode (lat/lon → address) to Nominatim (OpenStreetMap)',
        query: Type.Object({
            lat: Type.Number(),
            lon: Type.Number(),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireDispatcherAccess(config, req);
            await Auth.is_auth(config, req);

            const qs = new URLSearchParams({ lat: String(req.query.lat), lon: String(req.query.lon), format: 'json', addressdetails: '1' });
            const r = await fetch(`${NOMINATIM_BASE}/reverse?${qs.toString()}`, { headers: NOMINATIM_HEADERS });
            if (!r.ok) {
                res.json({ suggestion: null });
                return;
            }
            const f = await r.json() as NominatimFeature;
            res.json({ suggestion: f && f.lat ? nominatimToSuggestion(f) : null });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // NOTE: Incident map markers are NOT posted via this server route. TAK Server has
    // no REST CoT-injection endpoint (POST /Marti/api/cot/xml → 404), and a raw CoT
    // does not persist into a DataSync mission. Instead the plugin draws markers
    // browser-side via mapStore.worker.db.add() with a Mission origin (see
    // plugin/lib/map-marker.ts) — the same supported mechanism the ping plugin uses.

    // GET — getIncidents, getIncidentMetadata, getIncident, getVehicles, etc.
    await schema.get('/marti/plugins/takcad/submit', {
        name: 'TAK-CAD GET',
        group: 'TAKCAD',
        description: 'Proxy a TAK-CAD read (fn) to TAK Server using client-cert auth',
        query: Type.Object({
            fn: Type.String(),
            uid: Type.Optional(Type.String()),
            connection: Type.Optional(Type.Integer()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireDispatcherAccess(config, req);
            await Auth.is_auth(config, req);

            const api = await takServerApi(config, req);

            const params = new URLSearchParams();
            params.set('fn', String(req.query.fn));
            if (req.query.uid) params.set('uid', String(req.query.uid));

            // TAK Server's DistributedPluginManager requires a non-null Accept
            // header ("accept must be specified") — node-tak sends none by default.
            const data = await api.fetch(new URL(`${TAKCAD_BASE}?${params.toString()}`, String(config.server.api)), { method: 'GET', headers: { Accept: 'application/json' } });
            res.json(data);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // POST — updateIncident, updateVehicle, updatePerson (JSON body).
    // Updates route through TAK Server's updateInPlugin (onUpdateData), which is
    // POST /submit (NOT /submit/result — that's onSubmitDataWithResult, inserts only)
    // and requires the uid as a query param ("Cannot process request, missing uid").
    await schema.post('/marti/plugins/takcad/submit', {
        name: 'TAK-CAD POST (update)',
        group: 'TAKCAD',
        description: 'Proxy a TAK-CAD update (fn + uid) to TAK Server using client-cert auth',
        query: Type.Object({
            fn: Type.String(),
            uid: Type.String(),
            connection: Type.Optional(Type.Integer()),
        }),
        body: Type.Record(Type.String(), Type.Any()),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireDispatcherAccess(config, req);
            await Auth.is_auth(config, req);

            const api = await takServerApi(config, req);

            const params = new URLSearchParams();
            params.set('fn', String(req.query.fn));
            params.set('uid', String(req.query.uid));

            const data = await api.fetch(new URL(`${TAKCAD_BASE}?${params.toString()}`, String(config.server.api)), {
                method: 'POST',
                headers: { Accept: 'application/json' },
                body: req.body,
            });
            res.json(data);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // PUT — insertIncident, insertVehicle, insertPerson, etc. (JSON body)
    await schema.put('/marti/plugins/takcad/submit/result', {
        name: 'TAK-CAD PUT',
        group: 'TAKCAD',
        description: 'Proxy a TAK-CAD insert (fn) to TAK Server using client-cert auth',
        query: Type.Object({
            fn: Type.String(),
            connection: Type.Optional(Type.Integer()),
        }),
        body: Type.Record(Type.String(), Type.Any()),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireDispatcherAccess(config, req);
            await Auth.is_auth(config, req);

            const api = await takServerApi(config, req);

            const data = await api.fetch(new URL(`${TAKCAD_BASE}/result?fn=${encodeURIComponent(String(req.query.fn))}`, String(config.server.api)), {
                method: 'PUT',
                headers: { Accept: 'application/json' },
                body: req.body,
            });
            res.json(data);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // DELETE — deleteIncident, deleteVehicle, deletePerson, etc.
    await schema.delete('/marti/plugins/takcad/submit', {
        name: 'TAK-CAD DELETE',
        group: 'TAKCAD',
        description: 'Proxy a TAK-CAD delete (fn + uid) to TAK Server using client-cert auth',
        query: Type.Object({
            fn: Type.String(),
            uid: Type.String(),
            connection: Type.Optional(Type.Integer()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireDispatcherAccess(config, req);
            await Auth.is_auth(config, req);

            const api = await takServerApi(config, req);

            const params = new URLSearchParams();
            params.set('fn', String(req.query.fn));
            params.set('uid', String(req.query.uid));

            const data = await api.fetch(new URL(`${TAKCAD_BASE}?${params.toString()}`, String(config.server.api)), { method: 'DELETE', headers: { Accept: 'application/json' } });
            res.json(data ?? { status: 200, message: 'deleted' });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
