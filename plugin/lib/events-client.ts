import { std } from '../../../src/std.ts';

// Typed client for the dispatcher server route (server/plugin-dispatcher.ts), which stores
// Events and Incidents in CloudTAK's own Postgres so every dispatcher on this CloudTAK shares
// the same board. All calls go through std() so they carry the user's bearer token.

export interface DispatcherEvent {
    id: string;
    name: string;
    prefix: string;
    // How incidents reach field devices: 'datasync' = markers in the feed below;
    // 'broadcast' = CloudTAK Core Events shared with `channel` (feed_guid / feed_name are '').
    delivery: 'datasync' | 'broadcast';
    feed_guid: string;
    feed_name: string;
    // Channel label captured from the feed at creation — fallback display only.
    // For a broadcast Event this IS the audience: the channel its incidents are sent to.
    channel: string | null;
    // The feed's LIVE channels, resolved by the server per request. Badges render
    // from this; visibility itself is feed-driven (you see the event iff TAK shows
    // you its feed). Feeds always live in channels — an empty list = public feed.
    feed_channels?: string[];
    status: 'active' | 'archived';
    seq: number;
    created_at: string;
    created_by: string | null;
}

export interface AssignedContact {
    uid: string;
    callsign: string;
    // Assigned -> On Scene -> Cleared. The server stamps each time when the dispatcher presses the
    // button. Rows from before this existed have no status (read as Assigned) and no times.
    status?: 'assigned' | 'on_scene' | 'cleared';
    assigned_at?: string | null;
    on_scene_at?: string | null;
    cleared_at?: string | null;
}

export interface IncidentNote {
    text: string;
    time: string;
}

export interface DispatcherIncident {
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
    // Every caller on the incident, in the order received; exactly one is primary (none when empty).
    callers: IncidentCaller[];
    // The PRIMARY caller's name / phone, derived by the server (read-only shortcuts).
    caller_name: string | null;
    caller_phone: string | null;
    // Broadcast Events: the CloudTAK Core Event carrying this incident to the field.
    core_event_id: string | null;
    status: 'active' | 'closed';
    assigned: AssignedContact[];
    notes: IncidentNote[];
    created_at: string;
    closed_at: string | null;
    // How the incident ended, chosen when it was closed (plugin/lib/dispositions.ts); null while
    // active, and on incidents closed before dispositions existed. The note only comes with 'Other'.
    disposition: string | null;
    disposition_note: string | null;
}

export interface IncidentCaller {
    id: string;
    name: string | null;
    phone: string | null;
    note: string | null;
    time: string;       // when the call was received
    primary: boolean;   // its phone is the tap-to-call number on the incident marker
}

export interface CreateEventBody {
    name: string;
    prefix: string;
    delivery?: 'datasync' | 'broadcast';
    // Required for DataSync Events; omitted for broadcast Events.
    feed_guid?: string;
    feed_name?: string;
    channel?: string;
}

export interface CreateIncidentBody {
    type?: string;
    address?: string;
    lat: number;
    lon: number;
    dispatcher?: string;
    details?: string;
    report_number?: string;
    // The first caller (becomes the primary caller). More are added with addCaller().
    caller_name?: string;
    caller_phone?: string;
}

// report_number: send '' to clear. Callers are changed with addCaller / updateCaller / removeCaller.
// Closing (status: 'closed') needs a disposition (disposition_note only with 'Other'); reopening
// clears the disposition. Both are ignored on any other patch.
export type IncidentPatch = Partial<Pick<DispatcherIncident,
    'type' | 'address' | 'lat' | 'lon' | 'dispatcher' | 'details' | 'status' | 'notes'>>
    & { report_number?: string; core_event_id?: string; disposition?: string; disposition_note?: string };

// For addCaller / updateCaller. updateCaller: undefined = leave as is, '' = clear.
// time: ISO date of the call (default now). primary: true makes this caller the primary.
export interface CallerInput {
    name?: string;
    phone?: string;
    note?: string;
    time?: string;
    primary?: boolean;
}

// fresh=true bypasses the server's 60s channel-visibility cache (manual refresh).
export async function listEvents(fresh = false): Promise<DispatcherEvent[]> {
    const r = await std(`/api/dispatcher/events${fresh ? '?fresh=1' : ''}`, { method: 'GET' }) as { events?: DispatcherEvent[] };
    return Array.isArray(r?.events) ? r.events : [];
}

export async function createEvent(body: CreateEventBody): Promise<DispatcherEvent> {
    const r = await std('/api/dispatcher/events', { method: 'POST', body }) as { event: DispatcherEvent };
    return r.event;
}

export async function setEventStatus(id: string, status: 'active' | 'archived'): Promise<DispatcherEvent> {
    const r = await std(`/api/dispatcher/events/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { status },
    }) as { event: DispatcherEvent };
    return r.event;
}

export async function deleteEvent(id: string): Promise<void> {
    await std(`/api/dispatcher/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listIncidents(eventId: string): Promise<DispatcherIncident[]> {
    const r = await std(`/api/dispatcher/events/${encodeURIComponent(eventId)}/incidents`, {
        method: 'GET',
    }) as { incidents?: DispatcherIncident[] };
    return Array.isArray(r?.incidents) ? r.incidents : [];
}

export async function createIncident(eventId: string, body: CreateIncidentBody): Promise<DispatcherIncident> {
    const r = await std(`/api/dispatcher/events/${encodeURIComponent(eventId)}/incidents`, {
        method: 'POST',
        body,
    }) as { incident: DispatcherIncident };
    return r.incident;
}

export async function patchIncident(id: string, patch: IncidentPatch): Promise<DispatcherIncident> {
    const r = await std(`/api/dispatcher/incidents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
    }) as { incident: DispatcherIncident };
    return r.incident;
}

// ── Callers (the server applies each change under a row lock) ─────────────────────

export async function addCaller(incidentId: string, body: CallerInput): Promise<DispatcherIncident> {
    const r = await std(`/api/dispatcher/incidents/${encodeURIComponent(incidentId)}/callers`, {
        method: 'POST',
        body,
    }) as { incident: DispatcherIncident };
    return r.incident;
}

export async function updateCaller(incidentId: string, callerId: string, body: CallerInput): Promise<DispatcherIncident> {
    const { primary, ...rest } = body;
    const r = await std(`/api/dispatcher/incidents/${encodeURIComponent(incidentId)}/callers/${encodeURIComponent(callerId)}`, {
        method: 'PATCH',
        body: primary ? { ...rest, primary: true } : rest,
    }) as { incident: DispatcherIncident };
    return r.incident;
}

export async function removeCaller(incidentId: string, callerId: string): Promise<DispatcherIncident> {
    const r = await std(`/api/dispatcher/incidents/${encodeURIComponent(incidentId)}/callers/${encodeURIComponent(callerId)}`, {
        method: 'DELETE',
    }) as { incident: DispatcherIncident };
    return r.incident;
}

// ── Units (the server stamps every time and writes the note) ─────────────────────

export async function assignUnits(incidentId: string, units: { uid: string; callsign: string }[]): Promise<DispatcherIncident> {
    const r = await std(`/api/dispatcher/incidents/${encodeURIComponent(incidentId)}/units`, {
        method: 'POST',
        body: { units },
    }) as { incident: DispatcherIncident };
    return r.incident;
}

export async function setUnitStatus(incidentId: string, uid: string, status: 'on_scene' | 'cleared'): Promise<DispatcherIncident> {
    const r = await std(`/api/dispatcher/incidents/${encodeURIComponent(incidentId)}/units/${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        body: { status },
    }) as { incident: DispatcherIncident };
    return r.incident;
}

// The ✕: a unit assigned by mistake leaves the record.
export async function removeUnit(incidentId: string, uid: string): Promise<DispatcherIncident> {
    const r = await std(`/api/dispatcher/incidents/${encodeURIComponent(incidentId)}/units/${encodeURIComponent(uid)}`, {
        method: 'DELETE',
    }) as { incident: DispatcherIncident };
    return r.incident;
}

// ── Shared settings (per-CloudTAK key/value; agency identity on reports) ──────

export interface AgencySettings {
    name: string;
    id: string;
    logo: string | null;   // downscaled data:image/* URI, or null
}

export async function getDispatcherSettings(): Promise<Record<string, unknown>> {
    const r = await std('/api/dispatcher/settings', { method: 'GET' }) as { settings?: Record<string, unknown> };
    return r?.settings ?? {};
}

// Shared setting: put caller name / phone on the CoT incident marker (default on).
// Stored as dispatcher_settings key 'caller_on_markers'; anything but false means on.
export async function getCallerOnMarkers(): Promise<boolean> {
    try {
        const s = await getDispatcherSettings();
        return s.caller_on_markers !== false;
    } catch {
        return true;
    }
}

export async function putDispatcherSetting(key: string, value: unknown): Promise<void> {
    await std(`/api/dispatcher/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { value },
    });
}
