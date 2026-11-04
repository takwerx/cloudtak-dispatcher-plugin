import { std } from '../../../src/std.ts';
import type { useMapStore } from '../../../src/stores/map.ts';
import { dropIncidentMarker, removeIncidentMarker, buildRemarks, INCIDENT_ICON } from './map-marker.ts';
import type { MarkerIncident } from './map-marker.ts';
import { patchIncident } from './events-client.ts';
import { closedMarkerEndMs, closedMarkerMinutes, endedMsFrom, shouldWithdraw, WITHDRAW_MS } from './closed-window.ts';

// How an incident reaches field devices depends on its Event's delivery mode:
//
//  • DataSync (default) — a marker in the Event's DataSync feed (map-marker.ts). Field users
//    see it once they are subscribed to the feed.
//
//  • Broadcast — one CloudTAK Core Event per incident, shared with the Event's channel. The
//    CloudTAK server (Admin Connection) sends Core Events as CoT to that channel and re-sends
//    every active one every 10 s, so anyone in the channel sees it with nothing to subscribe
//    to, including people who connect late. Markers are machine generated (how="m-g"), so
//    field users can't edit them: one way only. A Core Event's `ended` time caps the CoT
//    stale time, so a closed incident is given ended = closed + the admin-set window (Manage
//    panel, default 60 min; closed-window.ts) and drops off devices then. No plugin marker is
//    drawn for these incidents — the Core Event IS the marker.
//
// Each function takes the same MarkerIncident the plugin already builds, plus the delivery
// fields (delivery / channel / coreEventId / closedAt), so call sites only swap the function.

type MapStore = ReturnType<typeof useMapStore>;

// CloudTAK limits a Core Event name to 64 characters.
const NAME_MAX = 64;

// incident id → Core Event id, for incidents whose new id hasn't come back from the board
// poll yet (prevents a second Core Event being created by an update right after create).
const coreIds = new Map<string, string>();

// channel name → TAK channel bitpos (Core Events are shared by bitpos).
let bitposCache: Map<string, number> | null = null;

/** True when this CloudTAK has the Core Events API (broadcast mode needs it). */
export async function coreEventsAvailable(): Promise<boolean> {
    try {
        await std('/api/core/event?limit=1', { method: 'GET' });
        return true;
    } catch {
        return false;
    }
}

async function channelBitpos(name: string): Promise<number> {
    if (!bitposCache) {
        const resp = await std('/api/marti/group?useCache=true', { method: 'GET' }) as
            { data?: { name: string; bitpos?: number }[] } | null;
        bitposCache = new Map((resp?.data ?? [])
            .filter(g => typeof g.bitpos === 'number')
            .map(g => [g.name, g.bitpos as number]));
    }
    const bitpos = bitposCache.get(name);
    if (bitpos === undefined) {
        bitposCache = null;  // channels may have changed — re-read next time
        throw new Error(`Channel "${name}" not found among your channels`);
    }
    return bitpos;
}

// `ended` for a closed incident: the close time plus the shared window (closed-window.ts holds the
// value the board last read from the settings; the default applies until then).
function endedFor(m: MarkerIncident): string | null {
    if (!m.closedAt) return null;
    return new Date(closedMarkerEndMs(new Date(m.closedAt).getTime(), closedMarkerMinutes())).toISOString();
}

// Create or update this incident's Core Event.
async function upsertCoreEvent(m: MarkerIncident): Promise<void> {
    if (!m.channel) throw new Error('This broadcast event has no channel');
    const closed = !!m.closedAt;
    const body = {
        name: `${closed ? 'CLOSED ' : ''}${m.number} ${m.name}`.trim().slice(0, NAME_MAX),
        type: 'a-n-G',
        geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
        location: m.address,
        remarks: buildRemarks(m),
        // CloudTAK wants an RFC 3339 date-time; normalize whatever the board returned.
        started: new Date(m.time).toISOString(),
        ended: endedFor(m),
        metadata: { source: 'tak-dispatcher', incident: m.uid },
        style: { icon: INCIDENT_ICON },
    };

    const known = m.coreEventId || coreIds.get(m.uid);
    if (known) {
        // Only the Core Event's creator may send `channels` or `editable` (CloudTAK answers 403
        // otherwise), and another dispatcher is often the one updating. Neither changes after
        // create, so updates leave them out.
        await std(`/api/core/event/${encodeURIComponent(known)}`, { method: 'PATCH', body });
        return;
    }

    const created = await std('/api/core/event', {
        method: 'POST',
        body: {
            ...body,
            // Other dispatchers in the channel update it too.
            editable: true,
            channels: [await channelBitpos(m.channel)],
        },
    }) as { id: string };
    coreIds.set(m.uid, created.id);
    await patchIncident(m.uid, { core_event_id: created.id });
}

/** Put the incident in front of field users, or refresh it after a change. */
export async function showIncident(mapStore: MapStore, m: MarkerIncident): Promise<void> {
    if (m.delivery === 'broadcast') {
        await upsertCoreEvent(m);
    } else {
        await dropIncidentMarker(mapStore, m);
    }
}

/**
 * Incident closed. DataSync: remove the marker now (as before). Broadcast: mark it CLOSED and
 * let it drop off field devices after the admin-set window (default 60 minutes).
 */
export async function closeIncidentInField(mapStore: MapStore, m: MarkerIncident): Promise<void> {
    if (m.delivery === 'broadcast') {
        await upsertCoreEvent({ ...m, closedAt: m.closedAt ?? new Date().toISOString() });
    } else {
        await removeIncidentMarker(mapStore, m);
    }
}

/**
 * Event archived or nuked: take the incident off field devices. Broadcast Core Events are ended
 * a minute out (not deleted) so devices drop the marker within about a minute; they remain in
 * CloudTAK's Core Events list as ended Events.
 */
export async function withdrawIncident(mapStore: MapStore, m: MarkerIncident): Promise<void> {
    if (m.delivery === 'broadcast') {
        const known = m.coreEventId || coreIds.get(m.uid);
        if (!known) return;
        // A closed incident already ending (or ended) sooner must not be pushed back out —
        // moving `ended` later would put an expired marker back on devices. Go by the end time
        // the Core Event really has: the admin may have changed the window since it was closed.
        // If it can't be read, fall back to the end time the current window would give.
        if (m.closedAt) {
            let ending: number | null = null;
            try { ending = endedMsFrom(await std(`/api/core/event/${encodeURIComponent(known)}`, { method: 'GET' })); }
            catch { /* use the computed time */ }
            if (ending === null) {
                const computed = endedFor(m);
                ending = computed ? new Date(computed).getTime() : null;
            }
            if (!shouldWithdraw(ending)) return;
        }
        await std(`/api/core/event/${encodeURIComponent(known)}`, {
            method: 'PATCH',
            body: { ended: new Date(Date.now() + WITHDRAW_MS).toISOString() },
        });
    } else {
        await removeIncidentMarker(mapStore, m);
    }
}
