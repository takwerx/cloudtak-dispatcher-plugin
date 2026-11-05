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
    // 'datasync' (default): incidents are markers in feed_guid. 'broadcast': incidents are
    // CloudTAK Core Events shared with `channel`; feed_guid / feed_name are '' (no feed).
    delivery: 'datasync' | 'broadcast';
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
    // Broadcast Events: the CloudTAK Core Event that carries this incident to the field.
    core_event_id: string | null;
    status: string;
    // The units on the incident (see <units-pure>): each has a status and the server's times.
    assigned: unknown;
    notes: unknown;
    created_at: string;
    closed_at: string | null;
    // How the incident ended, set when it is closed (see <disposition-pure>); NULL while active.
    disposition: string | null;
    disposition_note: string | null;
    // Employee numbers (see <operator-pure>), only recorded while the admin switch is on. NULL otherwise.
    created_by_no: string | null;
    initial_dispatcher_no: string | null;
    closed_by_no: string | null;
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

// ── Disposition ─────────────────────────────────────────────────────────────────
// How an incident ended. The dispatcher picks it when closing: one of the plugin's presets
// (plugin/lib/dispositions.ts) or "Other" with the text typed beside it. The server does not keep
// the preset list; it stores the text it is sent, so the list can change without a server change.
// A note only goes with "Other". Pure (no database) so plugin/test/disposition-server.test.ts can run it.
// <disposition-pure>
const DISPOSITION_MAX = 40;
const DISPOSITION_NOTE_MAX = 80;
const DISPOSITION_OTHER = 'Other';

function normDisposition(disposition: string | undefined, note: string | undefined): { disposition: string; disposition_note: string | null } {
    const d = (disposition ?? '').trim();
    if (!d) throw new Err(400, null, 'Pick a disposition to close the incident');
    if (d.length > DISPOSITION_MAX) throw new Err(400, null, `Disposition is too long (${DISPOSITION_MAX} characters max)`);
    const n = (note ?? '').trim();
    if (n.length > DISPOSITION_NOTE_MAX) throw new Err(400, null, `Disposition note is too long (${DISPOSITION_NOTE_MAX} characters max)`);
    if (d !== DISPOSITION_OTHER) return { disposition: d, disposition_note: null };
    if (!n) throw new Err(400, null, 'A disposition note is required with "Other"');
    return { disposition: d, disposition_note: n };
}

// "Closed: Unfounded" / "Closed: Other — lost contact with caller", the note written at close.
function closeNote(disposition: string, note: string | null): string {
    return `Closed: ${note ? `${disposition} — ${note}` : disposition}`;
}

// Reopening a closed incident needs a reason, written as a note ("Reopened: caller called back"), so the
// record says why it came back. With employee numbers on, the note also says who.
const REOPEN_REASON_MAX = 120;

function normReopenReason(v: unknown): string {
    const t = typeof v === 'string' ? v.trim() : '';
    if (!t) throw new Err(400, null, 'Enter a reason to reopen the incident');
    if (t.length > REOPEN_REASON_MAX) throw new Err(400, null, `Reopen reason is too long (${REOPEN_REASON_MAX} characters max)`);
    return t;
}

function reopenNote(reason: string): string {
    return `Reopened: ${reason}`;
}

// The reason belongs to the Employee Numbers feature: asked for only while that admin switch is on, so
// agencies that leave it off (and browsers still running an older bundle) reopen exactly as before.
function reopenNeedsReason(numbersOn: boolean, from: string, to: string): boolean {
    return numbersOn && from === 'closed' && to === 'active';
}
// </disposition-pure>

// ── Employee numbers (who did it) ──────────────────────────────────────────────
// Optional, OFF by default: a CloudTAK system admin turns it on in Manage (setting `operator_numbers`).
// Off, nothing here runs and the Dispatcher behaves as before (the `dispatcher` column is the CloudTAK
// callsign the browser sends at create). On, for desks that share one CloudTAK login: each terminal
// enters an employee number once (plugin/lib/operator.ts) and sends it as `operator` on every write.
// The server records it, next to the unchanged `dispatcher` column:
//   - `created_by_no`: the operator who created the incident, set once at create;
//   - `taken_by` on each caller: who took that call, set once when the caller is added (the New
//     Incident form's first caller takes the form's number);
//   - `initial_dispatcher_no`: the operator of the first unit assignment, set once;
//   - `closed_by_no`: who closed it; reopening clears it, closing again sets it again;
//   - `by` on every note written by that request, so each step on the record shows who did it.
// The number is a record, not a proof, like a signature on a paper log. No number = nothing stamped;
// the Dispatcher never refuses work over it. Pure (no database) so plugin/test/operator-server.test.ts
// can run it.
// <operator-pure>
const OPERATOR_SETTING = 'operator_numbers';
const OPERATOR_MAX = 16;

// The admin switch as read from dispatcher_settings: only true turns it on (missing, an older database,
// anything else = off). A raw read hands jsonb back as a JSON string, sometimes double-encoded (see
// asArray), so `true` arrives as the text 'true': unwrap it first, like the GET settings route does.
// The PUT only ever stores a boolean (normOperatorSetting), so unwrapping cannot turn on a stray string.
function operatorNumbersOn(value: unknown): boolean {
    let x: unknown = value;
    for (let i = 0; i < 4 && typeof x === 'string'; i++) {
        try {
            x = JSON.parse(x);
        } catch {
            return false;
        }
    }
    return x === true;
}

// Value an admin may store under the switch.
function normOperatorSetting(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Err(400, null, `${OPERATOR_SETTING} must be true or false`);
    return value;
}

// An employee number: digits only, trimmed, 1 to OPERATOR_MAX. Absent or empty = none (null).
function normOperator(v: unknown): string | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw new Err(400, null, 'Employee number must be digits only');
    const t = v.trim();
    if (!t) return null;
    if (!/^[0-9]+$/.test(t)) throw new Err(400, null, 'Employee number must be digits only');
    if (t.length > OPERATOR_MAX) throw new Err(400, null, `Employee number is too long (${OPERATOR_MAX} digits max)`);
    return t;
}

// The operator for one request: read only while the switch is on, so with it off a stray number is ignored.
function requestOperator(on: boolean, v: unknown): string | null {
    return on ? normOperator(v) : null;
}

// Notes the server writes for this request, each stamped with the operator (unchanged when none).
function withBy<T extends { text: string; time: string }>(notes: T[], operator: string | null): (T & { by?: string })[] {
    return operator ? notes.map(n => ({ ...n, by: operator })) : notes;
}

// The note list after a PATCH (switch on): notes already on the incident keep their `by`; every note added
// by this request (past the first prevCount) is stamped with the operator, and any `by` the browser sent
// on a new note is dropped, so a new note always says who sent it.
function stampNewNotes(prevCount: number, notes: unknown[], operator: string | null): unknown[] {
    return notes.map((n, i) => {
        if (i < prevCount || !n || typeof n !== 'object') return n;
        const { by: _sent, ...rest } = n as Record<string, unknown>;
        void _sent;
        return operator ? { ...rest, by: operator } : rest;
    });
}

// The dispatcher's number after a unit assignment: set once, by the first assignment that added a unit
// while an operator was set. Never moved afterwards.
function dispatcherAfterAssign(current: string | null, added: number, operator: string | null): string | null {
    return current ?? (added > 0 ? operator : null);
}
// Who closed the incident, after a PATCH: set by the request that closes it, cleared when it is reopened
// (like the disposition), otherwise unchanged. The "Closed: …" note keeps each closer in the log.
function closedByAfter(current: string | null, closing: boolean, active: boolean, operator: string | null): string | null {
    if (closing) return operator;
    return active ? null : current;
}
// </operator-pure>

// Whether the admin switch is on right now (read per write, so turning it off takes effect at once).
async function operatorNumbersEnabled(config: ConfigStateless): Promise<boolean> {
    try {
        const rows = await query<{ value: unknown }>(config, sql`
            SELECT value FROM dispatcher_settings WHERE key = ${OPERATOR_SETTING}
        `);
        return operatorNumbersOn(rows[0]?.value);
    } catch {
        return false;
    }
}

// ── CJIS reminder ───────────────────────────────────────────────────────────────
// A one-line reminder shown at the top of every standalone incident (default on) telling the
// dispatcher not to paste CJIS data into the Dispatcher. Both settings are shared per CloudTAK and
// may only be changed by a CloudTAK system admin (the account CloudTAK creates on first launch);
// every signed-in user still reads them, so the line shows for everyone. The custom call type list
// (incident_types) is admin-only the same way. Pure (no database) so plugin/test/cjis-server.test.ts
// can run it.
// <cjis-pure>
const CJIS_REMINDER_DEFAULT_TEXT = 'Information derived from CJIS sources must not be entered into incident records.';
const CJIS_REMINDER_TEXT_MAX = 300;
const ADMIN_ONLY_KEYS = new Set(['cjis_reminder_enabled', 'cjis_reminder_text', 'incident_types']);

// True for the settings keys only a system admin may write.
function isAdminOnlySetting(key: string): boolean {
    return ADMIN_ONLY_KEYS.has(key);
}

// Value a client may store under one of the CJIS keys: the switch must be a boolean; the text is
// trimmed, capped, and an empty text falls back to the default so the line can never be blank.
function normCjisSetting(key: string, value: unknown): unknown {
    if (key === 'cjis_reminder_enabled') {
        if (typeof value !== 'boolean') throw new Err(400, null, 'cjis_reminder_enabled must be true or false');
        return value;
    }
    if (key === 'cjis_reminder_text') {
        if (value !== null && value !== undefined && typeof value !== 'string') throw new Err(400, null, 'cjis_reminder_text must be text');
        const t = String(value ?? '').trim();
        if (t.length > CJIS_REMINDER_TEXT_MAX) throw new Err(400, null, `Reminder text is too long (${CJIS_REMINDER_TEXT_MAX} characters max)`);
        return t || CJIS_REMINDER_DEFAULT_TEXT;
    }
    return value;
}
// </cjis-pure>

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
    // Employee number of who took this call (employee numbers on; see <operator-pure>). Set once when
    // the caller is added, never by an edit. Absent on callers added without one.
    taken_by?: string;
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
            ...(typeof c.taken_by === 'string' && /^[0-9]{1,16}$/.test(c.taken_by) ? { taken_by: c.taken_by } : {}),
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

// Add a caller (the first one is always primary). A caller needs a name or a phone. takenBy: the
// employee number of who took the call (already checked by normOperator), or null.
function addCallerTo(list: CallerEntry[], b: CallerInput, takenBy: string | null = null): CallerEntry[] {
    const name = normCaller(b.name, CALLER_NAME_MAX, 'Caller name');
    const phone = normCaller(b.phone, CALLER_PHONE_MAX, 'Caller phone');
    const note = normCaller(b.note, CALLER_NOTE_MAX, 'Caller note');
    if (!name && !phone) throw new Err(400, null, 'Enter a caller name or phone number');
    if (list.length >= CALLERS_MAX) throw new Err(400, null, `An incident can have at most ${CALLERS_MAX} callers`);
    const primary = b.primary === true || list.length === 0;
    const entry: CallerEntry = { id: randomUUID(), name, phone, note, time: normCallTime(b.time), primary, ...(takenBy ? { taken_by: takenBy } : {}) };
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
function firstCaller(nameIn: string | undefined, phoneIn: string | undefined, takenBy: string | null = null): CallerEntry[] {
    const name = normCaller(nameIn, CALLER_NAME_MAX, 'Caller name');
    const phone = normCaller(phoneIn, CALLER_PHONE_MAX, 'Caller phone');
    return (name || phone)
        ? [{ id: randomUUID(), name, phone, note: null, time: new Date().toISOString(), primary: true, ...(takenBy ? { taken_by: takenBy } : {}) }]
        : [];
}
// </callers-pure>

// ── Units ───────────────────────────────────────────────────────────────────────
// Each unit on an incident is Assigned, then On Scene, then Cleared, with the time of each step.
// Only the dispatcher presses the buttons, and the SERVER stamps the time, so a browser can't
// back-date one. A Cleared unit stays on the incident (the record shows who worked the call);
// the ✕ (removeUnitFrom) is for a unit assigned by mistake and drops it from the record.
// Older rows hold { uid, callsign } only: they read as Assigned with no time.
// The list logic below is pure (no database) so plugin/test/units-server.test.ts can run it.
// <units-pure>
type UnitStatus = 'assigned' | 'on_scene' | 'cleared';

interface UnitEntry {
    uid: string;
    callsign: string;
    status: UnitStatus;
    assigned_at: string | null;
    on_scene_at: string | null;
    cleared_at: string | null;
}

interface UnitNote { text: string; time: string }

const UNITS_MAX = 100;

function unitTime(v: unknown): string | null {
    return typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) ? v : null;
}

// Normalize a stored list: drop junk and duplicates, give old { uid, callsign } rows a status.
function normalizeUnits(v: unknown): UnitEntry[] {
    const seen = new Set<string>();
    const out: UnitEntry[] = [];
    for (const u of asArray(v)) {
        if (!u || typeof u !== 'object') continue;
        const r = u as Record<string, unknown>;
        if (typeof r.uid !== 'string' || !r.uid || seen.has(r.uid)) continue;
        seen.add(r.uid);
        const status: UnitStatus = r.status === 'on_scene' || r.status === 'cleared' ? r.status : 'assigned';
        out.push({
            uid: r.uid,
            callsign: typeof r.callsign === 'string' ? r.callsign : r.uid,
            status,
            assigned_at: unitTime(r.assigned_at),
            on_scene_at: unitTime(r.on_scene_at),
            cleared_at: unitTime(r.cleared_at),
        });
    }
    return out;
}

// Assign units (skips any already on the incident). Returns the new list and the notes to log.
function assignUnitsTo(list: UnitEntry[], add: { uid?: string; callsign?: string }[], now: string): { list: UnitEntry[]; notes: UnitNote[] } {
    const next = [...list];
    const notes: UnitNote[] = [];
    for (const a of add) {
        const uid = (a.uid ?? '').trim();
        const callsign = (a.callsign ?? '').trim();
        if (!uid || !callsign) throw new Err(400, null, 'A unit needs a uid and a callsign');
        if (callsign.length > 64) throw new Err(400, null, 'Unit callsign is too long (64 characters max)');
        if (next.some(u => u.uid === uid)) continue;
        if (next.length >= UNITS_MAX) throw new Err(400, null, `An incident can have at most ${UNITS_MAX} units`);
        next.push({ uid, callsign, status: 'assigned', assigned_at: now, on_scene_at: null, cleared_at: null });
        notes.push({ text: `${callsign} assigned`, time: now });
    }
    return { list: next, notes };
}

// Move one unit forward: Assigned -> On Scene -> Cleared. Never backwards, never twice.
// A unit that clears without ever being marked On Scene keeps no on-scene time.
function advanceUnit(list: UnitEntry[], uid: string, to: 'on_scene' | 'cleared', now: string): { list: UnitEntry[]; notes: UnitNote[] } {
    const unit = list.find(u => u.uid === uid);
    if (!unit) throw new Err(404, null, 'Unit not found on this incident');
    if (unit.status === 'cleared') throw new Err(400, null, `${unit.callsign} is already cleared`);
    if (to === 'on_scene' && unit.status !== 'assigned') throw new Err(400, null, `${unit.callsign} is already on scene`);
    const stamped: UnitEntry = to === 'on_scene'
        ? { ...unit, status: 'on_scene', on_scene_at: now }
        : { ...unit, status: 'cleared', cleared_at: now };
    return {
        list: list.map(u => (u.uid === uid ? stamped : u)),
        notes: [{ text: `${unit.callsign} ${to === 'on_scene' ? 'on scene' : 'cleared'}`, time: now }],
    };
}

// The ✕: the unit was assigned by mistake, so it leaves the record (no note).
function removeUnitFrom(list: UnitEntry[], uid: string): UnitEntry[] {
    if (!list.some(u => u.uid === uid)) throw new Err(404, null, 'Unit not found on this incident');
    return list.filter(u => u.uid !== uid);
}

// Closing an incident clears every unit still on it, stamped with the close time.
function clearAllUnits(list: UnitEntry[], now: string): { list: UnitEntry[]; notes: UnitNote[] } {
    const notes: UnitNote[] = [];
    const next = list.map((u) => {
        if (u.status === 'cleared') return u;
        notes.push({ text: `${u.callsign} cleared`, time: now });
        return { ...u, status: 'cleared' as const, cleared_at: now };
    });
    return { list: next, notes };
}

// A client that still sends the whole list (older plugin builds): keep what the server already
// knows about each unit, stamp any new one as Assigned now, drop the ones that are gone. Status
// and times in the request are never read, so they can't be forged.
function mergeAssignedFrom(current: UnitEntry[], sent: unknown, now: string): UnitEntry[] {
    const wanted = asArray(sent)
        .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object' && typeof (u as { uid?: unknown }).uid === 'string')
        .map(u => ({ uid: String(u.uid), callsign: typeof u.callsign === 'string' ? u.callsign : String(u.uid) }));
    const kept = current.filter(u => wanted.some(w => w.uid === u.uid));
    return assignUnitsTo(kept, wanted, now).list;
}
// </units-pure>

// Normalize an incident row's jsonb fields to arrays before sending it to the client, and
// derive caller_name / caller_phone from the primary caller.
function mapIncident(row: IncidentRow): IncidentRow {
    const callers = normalizeCallers(row.callers);
    const primary = callers.find(c => c.primary);
    return {
        ...row,
        assigned: normalizeUnits(row.assigned),
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
                      report_number, callers, core_event_id, status, assigned, notes, created_at, closed_at, disposition, disposition_note, created_by_no, initial_dispatcher_no, closed_by_no
        `) as unknown as IncidentRow[];
        return mapIncident(rows[0]);
    });
}

// Lock the incident row, apply `edit` to its units (and the notes it returns) and write both back in
// one transaction, so two dispatchers pressing buttons at the same moment can't overwrite each
// other and the note and the time always agree. Units can't change on a closed incident.
// `operator` (employee numbers switch on) stamps the notes; `assigning` lets the first assignment
// record the dispatcher's number. Both default to off, which is the behaviour from before.
async function editUnits(
    config: ConfigStateless,
    incidentid: string,
    edit: (list: UnitEntry[], now: string) => { list: UnitEntry[]; notes: UnitNote[] },
    operator: string | null = null,
    assigning = false,
): Promise<IncidentRow> {
    return await config.pg.transaction(async (tx) => {
        const locked = await tx.execute(sql`
            SELECT assigned, notes, status, initial_dispatcher_no FROM dispatcher_incidents WHERE id = ${incidentid} FOR UPDATE
        `) as unknown as { assigned: unknown; notes: unknown; status: string; initial_dispatcher_no: string | null }[];
        if (!locked.length) throw new Err(404, null, 'Incident not found');
        if (locked[0].status !== 'active') throw new Err(400, null, 'This incident is closed. Reopen it to change its units.');
        const now = new Date().toISOString();
        const out = edit(normalizeUnits(locked[0].assigned), now);
        const notes = [...asArray(locked[0].notes), ...withBy(out.notes, operator)];
        // An assignment writes one note per unit added, so the note count is the number added.
        const initialDispatcherNo = assigning
            ? dispatcherAfterAssign(locked[0].initial_dispatcher_no, out.notes.length, operator)
            : locked[0].initial_dispatcher_no;
        const rows = await tx.execute(sql`
            UPDATE dispatcher_incidents
            SET assigned = ${JSON.stringify(out.list)}::jsonb, notes = ${JSON.stringify(notes)}::jsonb,
                initial_dispatcher_no = ${initialDispatcherNo}
            WHERE id = ${incidentid}
            RETURNING id, event_id, number, type, address, lat, lon, dispatcher, details,
                      report_number, callers, core_event_id, status, assigned, notes, created_at, closed_at, disposition, disposition_note, created_by_no, initial_dispatcher_no, closed_by_no
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
        SELECT id, name, prefix, delivery, feed_guid, feed_name, channel, status, seq, created_at, created_by
        FROM dispatcher_events WHERE id = ${eventid}
    `);
    return rows[0] ?? null;
}

// Load the event and 403/404 unless the caller's TAK view includes its feed.
// A broadcast Event has no feed, so visibility follows its channel: you can see it iff
// you are a member of that channel (the same audience its Core Events are shared with).
async function canSeeEvent(config: ConfigStateless, email: string, ev: EventRow): Promise<boolean> {
    if (ev.delivery === 'broadcast') {
        return !!ev.channel && (await userChannels(config, email)).has(ev.channel);
    }
    return (await userFeeds(config, email)).has(ev.feed_guid);
}

async function requireEventAccess(config: ConfigStateless, email: string, eventid: string): Promise<EventRow> {
    const ev = await eventById(config, eventid);
    if (!ev) throw new Err(404, null, 'Event not found');
    if (!(await canSeeEvent(config, email, ev))) {
        throw new Err(403, null, ev.delivery === 'broadcast'
            ? 'No access to this event\'s channel'
            : 'No access to this event\'s DataSync feed');
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
        // Delivery mode — existing Events keep DataSync. Broadcast Events store '' as their
        // feed, so feed_guid / feed_name stay NOT NULL and older code paths keep working.
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_events ADD COLUMN IF NOT EXISTS delivery TEXT NOT NULL DEFAULT 'datasync'
        `);
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS core_event_id TEXT
        `);
        // Disposition (standalone mode): how the incident ended, chosen when it is closed.
        // Nullable, so incidents closed before this stay as they are.
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS disposition TEXT
        `);
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS disposition_note TEXT
        `);
        // Employee numbers (standalone, admin switch `operator_numbers`): who created the incident, who
        // assigned its first unit, who closed it. Nullable: empty while the switch is off and on older rows.
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS created_by_no TEXT
        `);
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS initial_dispatcher_no TEXT
        `);
        await config.pg.execute(sql`
            ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS closed_by_no TEXT
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
            let value: unknown = req.body.value;
            if (isAdminOnlySetting(req.params.key) || req.params.key === OPERATOR_SETTING) {
                // Auth.as_user re-reads the profile for session tokens, so this is the live flag.
                const user = await Auth.as_user(config, req);
                if (!user.is_admin()) throw new Err(403, null, 'Only a CloudTAK system admin can change this setting');
                value = req.params.key === OPERATOR_SETTING
                    ? normOperatorSetting(value)
                    : normCjisSetting(req.params.key, value);
            } else {
                await Auth.is_auth(config, req);
            }
            const encoded = JSON.stringify(value ?? null);
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
            if (req.query.fresh) { feedCache.delete(user.email); channelCache.delete(user.email); }
            const feeds = await userFeeds(config, user.email);
            const channels = await userChannels(config, user.email);
            const events = await query<EventRow>(config, sql`
                SELECT id, name, prefix, delivery, feed_guid, feed_name, channel, status, seq, created_at, created_by
                FROM dispatcher_events ORDER BY created_at DESC
            `);
            res.json({
                events: events
                    .filter(e => (e.delivery === 'broadcast'
                        ? !!e.channel && channels.has(e.channel)
                        : feeds.has(e.feed_guid)))
                    // feed_channels = the feed's LIVE channels (badges render from this;
                    // stored channel label is only a fallback for older responses). A
                    // broadcast Event's audience is its one channel.
                    .map(e => ({ ...e, feed_channels: e.delivery === 'broadcast'
                        ? [e.channel as string]
                        : feeds.get(e.feed_guid) ?? [] })),
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/dispatcher/events', {
        name: 'Create Event',
        group: 'Dispatcher',
        description: 'Create a dispatcher event tied to a DataSync feed, or broadcast to a channel',
        body: Type.Object({
            name: Type.String(),
            prefix: Type.String(),
            // 'datasync' (default) needs feed_guid + feed_name; 'broadcast' needs channel.
            delivery: Type.Optional(Type.Union([Type.Literal('datasync'), Type.Literal('broadcast')])),
            feed_guid: Type.Optional(Type.String()),
            feed_name: Type.Optional(Type.String()),
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
            const delivery = req.body.delivery ?? 'datasync';
            const feedGuid = delivery === 'broadcast' ? '' : (req.body.feed_guid ?? '').trim();
            const feedName = delivery === 'broadcast' ? '' : (req.body.feed_name ?? '').trim();
            if (delivery === 'broadcast' && !channel) {
                throw new Err(400, null, 'A broadcast event needs a channel to broadcast to');
            }
            if (delivery === 'datasync' && (!feedGuid || !feedName)) {
                throw new Err(400, null, 'A DataSync event needs a feed');
            }
            const id = randomUUID();
            const prefix = (req.body.prefix || 'INC').replace(/[^A-Z0-9-]/gi, '').toUpperCase().slice(0, 12) || 'INC';
            const events = await query<EventRow>(config, sql`
                INSERT INTO dispatcher_events (id, name, prefix, delivery, feed_guid, feed_name, channel, created_by)
                VALUES (${id}, ${req.body.name}, ${prefix}, ${delivery}, ${feedGuid}, ${feedName}, ${channel}, ${user.email})
                RETURNING id, name, prefix, delivery, feed_guid, feed_name, channel, status, seq, created_at, created_by
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
            // Its incidents' Core Events are already shared with this channel; moving the
            // Event would leave them broadcasting to the old one.
            if (ev.delivery === 'broadcast' && nextChannel !== ev.channel) {
                throw new Err(400, null, 'A broadcast event\'s channel can\'t be changed');
            }
            if (nextChannel && nextChannel !== ev.channel
                && !(await userChannels(config, user.email)).has(nextChannel)) {
                throw new Err(403, null, `You are not a member of channel "${nextChannel}"`);
            }
            const events = await query<EventRow>(config, sql`
                UPDATE dispatcher_events
                SET status = ${req.body.status ?? ev.status}, channel = ${nextChannel}
                WHERE id = ${req.params.eventid}
                RETURNING id, name, prefix, delivery, feed_guid, feed_name, channel, status, seq, created_at, created_by
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
                       report_number, callers, core_event_id, status, assigned, notes, created_at, closed_at, disposition, disposition_note, created_by_no, initial_dispatcher_no, closed_by_no
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
            // Employee number of the person creating it (digits); stored as `created_by_no` while the
            // employee numbers switch is on, ignored while it is off.
            operator: Type.Optional(Type.String()),
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
            const operator = requestOperator(await operatorNumbersEnabled(config), req.body.operator);
            // The New Incident form records the first caller; more are added from the incident.
            const callers = firstCaller(req.body.caller_name, req.body.caller_phone, operator);

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
                    (id, event_id, number, type, address, lat, lon, dispatcher, created_by_no, details, report_number, callers, notes)
                VALUES
                    (${id}, ${req.params.eventid}, ${number}, ${req.body.type ?? null},
                     ${req.body.address ?? null}, ${req.body.lat}, ${req.body.lon},
                     ${req.body.dispatcher ?? null}, ${operator}, ${req.body.details ?? null}, ${reportNumber},
                     ${JSON.stringify(callers)}::jsonb,
                     ${JSON.stringify(withBy(seedNotes, operator))}::jsonb)
                RETURNING id, event_id, number, type, address, lat, lon, dispatcher, details,
                          report_number, callers, core_event_id, status, assigned, notes, created_at, closed_at, disposition, disposition_note, created_by_no, initial_dispatcher_no, closed_by_no
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
            // Employee number of the person making this change (switch on only); stamps every note it adds.
            operator: Type.Optional(Type.String()),
            details: Type.Optional(Type.String()),
            report_number: Type.Optional(Type.String()),
            core_event_id: Type.Optional(Type.String()),
            status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('closed')])),
            // Read only when status goes active → closed (required then); see <disposition-pure>.
            disposition: Type.Optional(Type.String()),
            disposition_note: Type.Optional(Type.String()),
            // Read only when status goes closed → active (required then); written as a "Reopened: …" note.
            reopen_reason: Type.Optional(Type.String()),
            assigned: Type.Optional(Type.Array(Type.Any())),
            notes: Type.Optional(Type.Array(Type.Any())),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            // Checked before the lock: it asks TAK Server, which must not be waited on with the row held.
            await requireIncidentAccess(config, user.email, req.params.incidentid);
            const numbersOn = await operatorNumbersEnabled(config);
            const operator = requestOperator(numbersOn, req.body.operator);

            // Read-modify-write under a row lock: merge the patch over the current row, then write
            // all columns. The lock keeps a unit button pressed at the same moment from being lost.
            const incident = await config.pg.transaction(async (tx) => {
                const current = await tx.execute(sql`
                    SELECT id, event_id, number, type, address, lat, lon, dispatcher, details,
                           report_number, callers, core_event_id, status, assigned, notes, created_at, closed_at, disposition, disposition_note, created_by_no, initial_dispatcher_no, closed_by_no
                    FROM dispatcher_incidents WHERE id = ${req.params.incidentid} FOR UPDATE
                `) as unknown as IncidentRow[];
                if (!current.length) throw new Err(404, null, 'Incident not found');
                const cur = current[0];
                const b = req.body;
                const now = new Date().toISOString();

                const next = {
                    type: b.type ?? cur.type,
                    address: b.address ?? cur.address,
                    lat: b.lat ?? cur.lat,
                    lon: b.lon ?? cur.lon,
                    dispatcher: b.dispatcher ?? cur.dispatcher,
                    details: b.details ?? cur.details,
                    status: b.status ?? cur.status,
                    assigned: b.assigned !== undefined
                        ? mergeAssignedFrom(normalizeUnits(cur.assigned), b.assigned, now)
                        : normalizeUnits(cur.assigned),
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
                        time: now,
                    }];
                }

                // Core Event link: undefined = leave as is; '' = clear.
                const coreEventId = b.core_event_id !== undefined
                    ? ((b.core_event_id || '').trim() || null)
                    : cur.core_event_id;

                // Closing stamps closed_at and clears every unit still on the incident with that
                // same time; reopening clears closed_at (cleared units stay cleared).
                const closing = next.status === 'closed' && cur.status !== 'closed';
                const closedAt = next.status === 'closed'
                    ? (cur.closed_at ?? now)
                    : null;
                // Closing needs a disposition (how the call ended) and writes it as a note; the
                // columns hold the current value. Reopening clears the columns, the note stays in the
                // log, and closing again asks again. A closed incident keeps its disposition through
                // other patches (a note, a report number), and it cannot be edited without reopening.
                let disposition = cur.disposition;
                let dispositionNote = cur.disposition_note;
                if (closing) {
                    const d = normDisposition(b.disposition, b.disposition_note);
                    disposition = d.disposition;
                    dispositionNote = d.disposition_note;
                    next.notes = [...next.notes, { text: closeNote(disposition, dispositionNote), time: closedAt }];
                } else if (next.status === 'active') {
                    disposition = null;
                    dispositionNote = null;
                }
                const closedByNo = closedByAfter(cur.closed_by_no, closing, next.status === 'active', operator);
                // Reopening with employee numbers on: the reason is required and goes on the record as a
                // note. Off, reopen works as it always did (no reason asked, none written).
                if (reopenNeedsReason(numbersOn, cur.status, next.status)) {
                    next.notes = [...next.notes, { text: reopenNote(normReopenReason(b.reopen_reason)), time: now }];
                }
                if (closing) {
                    const cleared = clearAllUnits(next.assigned, closedAt as string);
                    next.assigned = cleared.list;
                    next.notes = [...next.notes, ...cleared.notes];
                }
                // Employee numbers on: every note this request added says who.
                if (numbersOn) next.notes = stampNewNotes(asArray(cur.notes).length, next.notes, operator);

                const incidents = await tx.execute(sql`
                    UPDATE dispatcher_incidents SET
                        type       = ${next.type},
                        address    = ${next.address},
                        lat        = ${next.lat},
                        lon        = ${next.lon},
                        dispatcher = ${next.dispatcher},
                        details    = ${next.details},
                        report_number = ${reportNumber},
                        core_event_id = ${coreEventId},
                        status     = ${next.status},
                        assigned   = ${JSON.stringify(next.assigned)}::jsonb,
                        notes      = ${JSON.stringify(next.notes)}::jsonb,
                        closed_at  = ${closedAt},
                        disposition = ${disposition},
                        disposition_note = ${dispositionNote},
                        closed_by_no = ${closedByNo}
                    WHERE id = ${req.params.incidentid}
                    RETURNING id, event_id, number, type, address, lat, lon, dispatcher, details,
                              report_number, callers, core_event_id, status, assigned, notes, created_at, closed_at, disposition, disposition_note, created_by_no, initial_dispatcher_no, closed_by_no
                `) as unknown as IncidentRow[];
                return mapIncident(incidents[0]);
            });
            res.json({ incident });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // ── Units ───────────────────────────────────────────────────────────────────
    // Assigned -> On Scene -> Cleared. Each press goes through editUnits (row lock, server time,
    // and the note written in the same step). The browser never sends a time.

    await schema.post('/dispatcher/incidents/:incidentid/units', {
        name: 'Assign Units',
        group: 'Dispatcher',
        description: 'Assign one or more units to an incident (each starts as Assigned, stamped now)',
        params: Type.Object({ incidentid: Type.String() }),
        body: Type.Object({
            units: Type.Array(Type.Object({ uid: Type.String(), callsign: Type.String() })),
            operator: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireIncidentAccess(config, user.email, req.params.incidentid);
            const numbersOn = await operatorNumbersEnabled(config);
            const operator = requestOperator(numbersOn, req.body.operator);
            const incident = await editUnits(config, req.params.incidentid, (list, now) => assignUnitsTo(list, req.body.units, now), operator, numbersOn);
            res.json({ incident });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/dispatcher/incidents/:incidentid/units/:uid', {
        name: 'Update Unit Status',
        group: 'Dispatcher',
        description: 'Mark a unit On Scene or Cleared (the server stamps the time)',
        params: Type.Object({ incidentid: Type.String(), uid: Type.String() }),
        body: Type.Object({
            status: Type.Union([Type.Literal('on_scene'), Type.Literal('cleared')]),
            operator: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireIncidentAccess(config, user.email, req.params.incidentid);
            const operator = requestOperator(await operatorNumbersEnabled(config), req.body.operator);
            const incident = await editUnits(config, req.params.incidentid, (list, now) => advanceUnit(list, req.params.uid, req.body.status, now), operator);
            res.json({ incident });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/dispatcher/incidents/:incidentid/units/:uid', {
        name: 'Remove Unit',
        group: 'Dispatcher',
        description: 'Take a unit off the incident record (for a unit assigned by mistake)',
        params: Type.Object({ incidentid: Type.String(), uid: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireIncidentAccess(config, user.email, req.params.incidentid);
            const incident = await editUnits(config, req.params.incidentid, list => ({ list: removeUnitFrom(list, req.params.uid), notes: [] }));
            res.json({ incident });
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
            // Employee number of who took this call (employee numbers on); stored as `taken_by`.
            operator: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            await requireIncidentAccess(config, user.email, req.params.incidentid);
            const takenBy = requestOperator(await operatorNumbersEnabled(config), req.body.operator);
            const incident = await editCallers(config, req.params.incidentid, list => addCallerTo(list, req.body, takenBy));
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
