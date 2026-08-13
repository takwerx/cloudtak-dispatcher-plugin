import { std } from '../../../src/std.ts';

// Typed client for the dispatcher server route (server/plugin-dispatcher.ts), which stores
// Events and Incidents in CloudTAK's own Postgres so every dispatcher on this CloudTAK shares
// the same board. All calls go through std() so they carry the user's bearer token.

export interface DispatcherEvent {
    id: string;
    name: string;
    prefix: string;
    feed_guid: string;
    feed_name: string;
    // Channel label inherited from the event's feed at creation (display only).
    // Visibility is feed-driven: the server shows an event iff TAK shows you its feed.
    channel: string | null;
    status: 'active' | 'archived';
    seq: number;
    created_at: string;
    created_by: string | null;
}

export interface AssignedContact {
    uid: string;
    callsign: string;
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
    status: 'active' | 'closed';
    assigned: AssignedContact[];
    notes: IncidentNote[];
    created_at: string;
    closed_at: string | null;
}

export interface CreateEventBody {
    name: string;
    prefix: string;
    feed_guid: string;
    feed_name: string;
    channel?: string;
}

export interface CreateIncidentBody {
    type?: string;
    address?: string;
    lat: number;
    lon: number;
    dispatcher?: string;
    details?: string;
}

export type IncidentPatch = Partial<Pick<DispatcherIncident,
    'type' | 'address' | 'lat' | 'lon' | 'dispatcher' | 'details' | 'status' | 'assigned' | 'notes'>>;

export async function listEvents(): Promise<DispatcherEvent[]> {
    const r = await std('/api/dispatcher/events', { method: 'GET' }) as { events?: DispatcherEvent[] };
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

export async function putDispatcherSetting(key: string, value: unknown): Promise<void> {
    await std(`/api/dispatcher/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { value },
    });
}
