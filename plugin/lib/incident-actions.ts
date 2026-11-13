import type { useMapStore } from '../../../src/stores/map.ts';
import { postMissionLog } from './takcad-client.ts';
import { showIncident, closeIncidentInField } from './field-delivery.ts';
import { sendAssignmentMessage, sendUpdateMessage } from './contacts-client.ts';
import { patchIncident, assignUnits, setUnitStatus, removeUnit } from './events-client.ts';
import type { DispatcherEvent, DispatcherIncident, AssignedContact } from './events-client.ts';
import { dispatcherStore } from './dispatcher-store.ts';
import { respondingLine, unitStatus } from './unit-status.ts';
import { dispositionLabel } from './dispositions.ts';

// What each button on an incident does, in one place: the server call, then everything that follows it
// (the shared board, the map marker, the feed log, the messages to the units). The incident's own view
// (IncidentDetail.vue) and the command line (CommandLine.vue) both call these, so a typed command does
// exactly what the button does, for an incident that is on screen or not.
// Each one throws when the server refuses; what follows the save is best-effort, as it always was.

type MapStore = ReturnType<typeof useMapStore>;

export interface ActionContext {
    mapStore: MapStore;
    // The Event an incident belongs to, for its marker and feed log; null when it is not known any more.
    eventFor: (inc: DispatcherIncident) => DispatcherEvent | null;
}

// Build the marker payload for an incident, folding responders + notes into the remarks
// details (same presentation as before, now sourced from server fields).
export function markerFor(inc: DispatcherIncident, ev: DispatcherEvent | null, extraDetail = '') {
    const details = [
        inc.details ?? '',
        respondingLine(inc.assigned),
        ...(inc.notes ?? []).map(n => n.text),
        extraDetail,
    ].filter(Boolean).join('\n');
    return {
        uid:        inc.id,
        number:     inc.number,
        name:       inc.type ?? '',
        type:       inc.type ?? '',
        address:    inc.address ?? '',
        lat:        inc.lat ?? 0,
        lon:        inc.lon ?? 0,
        time:       inc.created_at,
        dispatcher: inc.dispatcher ?? '',
        details,
        // Callers reach the marker only through this list. Off means nothing about callers goes out.
        callers:    dispatcherStore.callerOnMarkers ? (inc.callers ?? []) : [],
        feedGuid:   ev?.feed_guid,
        delivery:    ev?.delivery,
        channel:     ev?.channel,
        coreEventId: inc.core_event_id,
        closedAt:    inc.closed_at,
    };
}

// Merge a server-returned incident back into the shared store (every open copy follows). A reply that lands
// after the dispatcher switched to another Event is not put on that Event's board; the rest of the save (unit
// messages, this incident's marker and feed log, which go to its own Event) still happens.
export function applyIncident(updated: DispatcherIncident): void {
    if (updated.event_id !== dispatcherStore.activeEvent?.id) return;
    const idx = dispatcherStore.incidents.findIndex(i => i.id === updated.id);
    if (idx !== -1) dispatcherStore.incidents[idx] = updated;
    else dispatcherStore.incidents.push(updated);
}

async function resendMarker(ctx: ActionContext, updated: DispatcherIncident): Promise<void> {
    try { await showIncident(ctx.mapStore, markerFor(updated, ctx.eventFor(updated))); }
    catch { /* best-effort */ }
}

async function feedLog(ctx: ActionContext, updated: DispatcherIncident, line: string): Promise<void> {
    const feed = ctx.eventFor(updated);
    if (!feed) return;
    try { await postMissionLog(feed.feed_name, line); }
    catch { /* best-effort */ }
}

// Assign units, ALL in ONE call. The server stamps the time and writes the "assigned" notes.
export async function assignAction(ctx: ActionContext, inc: DispatcherIncident, units: { uid: string; callsign: string }[]): Promise<DispatcherIncident> {
    const updated = await assignUnits(inc.id, units.map(c => ({ uid: c.uid, callsign: c.callsign })));
    applyIncident(updated);

    // One GeoChat per newly-assigned responder
    for (const c of units) {
        try { await sendAssignmentMessage(ctx.mapStore, c, { name: `${updated.number} ${updated.type ?? ''}`, address: updated.address ?? '' }); }
        catch (e) { console.warn('[dispatcher] assignment message failed', e); }
    }
    // Update the marker remarks once with the full responder list
    await resendMarker(ctx, updated);
    for (const c of units) await feedLog(ctx, updated, `ASSIGNED: ${updated.number} → ${c.callsign}`);
    return updated;
}

// On Scene / Clear. The server stamps the time; nothing goes to the unit (it just radioed dispatch).
export async function unitStatusAction(ctx: ActionContext, inc: DispatcherIncident, unit: AssignedContact, to: 'on_scene' | 'cleared'): Promise<DispatcherIncident> {
    const updated = await setUnitStatus(inc.id, unit.uid, to);
    applyIncident(updated);
    await resendMarker(ctx, updated);
    await feedLog(ctx, updated, `${to === 'on_scene' ? 'ON SCENE' : 'CLEARED'}: ${updated.number} → ${unit.callsign}`);
    return updated;
}

// One row (one trip) of the unit leaves the record.
export async function removeUnitAction(ctx: ActionContext, inc: DispatcherIncident, unit: AssignedContact): Promise<DispatcherIncident> {
    const updated = await removeUnit(inc.id, unit.uid, unit.assigned_at);
    applyIncident(updated);
    await feedLog(ctx, updated, `UNASSIGNED: ${updated.number} → ${unit.callsign}`);
    await resendMarker(ctx, updated);
    return updated;
}

// Only the text is sent: the server adds it to the notes the incident has now, so a note another
// dispatcher or a unit button wrote since this browser's last poll is never dropped.
export async function addNoteAction(ctx: ActionContext, inc: DispatcherIncident, text: string): Promise<DispatcherIncident> {
    let updated = await patchIncident(inc.id, { note_add: text });
    // A server from before `note_add` ignores it (the note is not the last one in what comes back): send
    // the whole list, built on the notes it just returned.
    const notes = updated.notes ?? [];
    if (notes[notes.length - 1]?.text !== text.trim()) {
        updated = await patchIncident(inc.id, { notes: [...notes, { text, time: new Date().toISOString() }] });
    }
    applyIncident(updated);

    // Update CoT marker with latest notes appended to details
    await resendMarker(ctx, updated);
    // DataSync log entry
    await feedLog(ctx, updated, `UPDATE ${updated.number}: ${text}`);
    // Push the update to every assigned responder as a direct GeoChat
    for (const c of (updated.assigned ?? []).filter(u => unitStatus(u) !== 'cleared')) {
        try { await sendUpdateMessage(ctx.mapStore, c, { name: `${updated.number} ${updated.type ?? ''}` }, text); }
        catch (e) { console.warn('[dispatcher] update message failed', e); }
    }
    return updated;
}

// Report number: the server logs every change as a timestamped note, so only the
// field itself is sent (no read-modify-write of the notes array from the browser).
export async function reportNumberAction(inc: DispatcherIncident, value: string): Promise<DispatcherIncident> {
    const updated = await patchIncident(inc.id, { report_number: value });
    applyIncident(updated);
    return updated;
}

// Callers: each add / edit / make-primary / remove is one server call (`op`) that locks the incident row.
// The marker is resent so field units see the change (closed incidents have no marker to resend).
export async function callerAction(ctx: ActionContext, op: () => Promise<DispatcherIncident>): Promise<DispatcherIncident> {
    const updated = await op();
    applyIncident(updated);
    if (updated.status === 'active') await resendMarker(ctx, updated);
    return updated;
}

// disposition: one of DISPOSITIONS, or DISPOSITION_OTHER with `note` (the text typed beside it).
// `saved` runs as soon as the board has the closed incident, before the field is told.
export async function closeAction(ctx: ActionContext, inc: DispatcherIncident, disposition: string, note = '', saved?: () => void): Promise<DispatcherIncident> {
    const stillOn = (inc.assigned ?? []).filter(u => unitStatus(u) !== 'cleared');
    // The server stores the disposition, writes the "Closed: …" note and clears every unit
    // still on the incident (stamped with the close time).
    const trimmed = note.trim();
    const updated = await patchIncident(inc.id, {
        status: 'closed',
        disposition,
        ...(trimmed ? { disposition_note: trimmed } : {}),
    });
    applyIncident(updated);
    saved?.();

    // DataSync: remove the marker (record stays server-side). Broadcast: mark it CLOSED;
    // it drops off field devices after the admin-set window (Dispatcher Settings, default 60 min).
    try { await closeIncidentInField(ctx.mapStore, markerFor(updated, ctx.eventFor(updated))); }
    catch { /* best-effort */ }

    // DataSync log entry
    if (ctx.eventFor(updated)) {
        const closedAt = new Date();
        const startMs = new Date(updated.created_at).getTime();
        const durMin = Math.round((closedAt.getTime() - startMs) / 60000);
        const hhmm = `${String(closedAt.getHours()).padStart(2, '0')}:${String(closedAt.getMinutes()).padStart(2, '0')}`;
        // Closing cleared every unit still on the incident (the server stamps the close time).
        for (const u of stillOn) await feedLog(ctx, updated, `CLEARED: ${updated.number} → ${u.callsign}`);
        await feedLog(ctx, updated, `INCIDENT CLOSED: ${updated.number} | ${updated.type ?? ''} | Closed ${hhmm} | ${durMin} min | ${dispositionLabel(updated)}`);
    }
    return updated;
}

// Employee Numbers on: the server requires the reason and writes the "Reopened: …" note. Off, the Reopen
// button asks for none; a reason given anyway (the command line's `R reason`) is kept as the same note.
export async function reopenAction(ctx: ActionContext, inc: DispatcherIncident, reason: string, saved?: () => void): Promise<DispatcherIncident> {
    const why = reason.trim();
    const kept = !why ? {} : dispatcherStore.operatorNumbers ? { reopen_reason: why } : { note_add: `Reopened: ${why}` };
    const updated = await patchIncident(inc.id, { status: 'active', ...kept });
    applyIncident(updated);
    saved?.();

    // Re-drop the CoT marker to the feed (broadcast: reopen the Core Event)
    await resendMarker(ctx, updated);
    await feedLog(ctx, updated, `INCIDENT REOPENED: ${updated.number} | ${updated.type ?? ''}${why ? ` | ${why}` : ''}`);
    return updated;
}

export function flyToIncident(mapStore: MapStore, inc: DispatcherIncident): void {
    mapStore.map?.flyTo({ center: [inc.lon ?? 0, inc.lat ?? 0], zoom: 15 });
}
