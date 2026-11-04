import { defineAsyncComponent, watch } from 'vue';
import { useFloatStore } from '../../../src/stores/float.ts';
import { dispatcherStore } from './dispatcher-store.ts';
import {
    UNDOCK_CARD_WIDTH, UNDOCK_CARD_HEIGHT, firstFreeSlot,
    addUndocked, removeUndocked, restorable, undockStorageKey, parseSavedUndocked,
} from './undock.ts';

// One CloudTAK float pane per undocked incident (same FloatStore the Dispatcher pop-out uses).
// The pane's config carries the incident id; the card itself reads the incident from
// dispatcherStore.incidents, so the shared poll keeps every card current.
const PANE_PREFIX = 'plugin-tak-dispatcher-incident-';

// Async import: IncidentDetail (which triggers undock) and IncidentFloat (which hosts
// IncidentDetail) must not form a static import cycle.
const IncidentFloat = defineAsyncComponent(() => import('../components/IncidentFloat.vue'));

export function paneUidFor(incidentId: string): string {
    return PANE_PREFIX + incidentId;
}

function paneBase(): { x: number; y: number } {
    // Same gutters as CloudTAK's own panes: clear of the left control column and the top bar.
    return { x: 56, y: 76 };
}

function viewport(): { width: number; height: number } {
    if (typeof window === 'undefined') return { width: 1920, height: 1080 };
    // Keep cards left of the menu panel when it is open.
    const menu = document.querySelector('.cloudtak-main-menu');
    const right = menu ? menu.getBoundingClientRect().left : window.innerWidth;
    return { width: right, height: window.innerHeight };
}

function save(): void {
    const ev = dispatcherStore.activeEvent;
    if (!ev) return;
    try { localStorage.setItem(undockStorageKey(ev.id), JSON.stringify(dispatcherStore.undocked)); }
    catch { /* private mode / quota */ }
}

// Open the floating card for an incident, or bring its card to the front if it is already open.
export function undockIncident(incidentId: string): void {
    const floats = useFloatStore();
    const uid = paneUidFor(incidentId);
    const open = floats.panes.get(uid);
    if (open) {
        // Panes render in insertion order, so re-inserting the same pane object puts it on top
        // (Vue moves the keyed element; the card is not remounted and keeps its size and place).
        floats.panes.delete(uid);
        floats.panes.set(uid, open);
    } else {
        const taken = dispatcherStore.undocked
            .map(id => floats.panes.get(paneUidFor(id)))
            .filter((p): p is NonNullable<typeof p> => !!p)
            .map(p => ({ x: p.x, y: p.y }));
        const pos = firstFreeSlot(taken, paneBase(), viewport());
        floats.add({
            uid,
            name:      'Incident',
            component: IncidentFloat,
            config:    { incidentId },
            width:     UNDOCK_CARD_WIDTH,
            height:    UNDOCK_CARD_HEIGHT,
            x:         pos.x,
            y:         pos.y,
        });
    }
    dispatcherStore.undocked = addUndocked(dispatcherStore.undocked, incidentId);
    save();
}

// Close the card. The incident stays on the board; nothing else changes.
export function closeUndocked(incidentId: string): void {
    useFloatStore().delete(paneUidFor(incidentId));
    dispatcherStore.undocked = removeUndocked(dispatcherStore.undocked, incidentId);
    save();
}

// Close every card. `persist` false keeps the Event's saved list (the Event was closed or switched,
// or the plugin was disabled, so the cards come back with it); the list's Close all saves the empty list.
export function closeAllUndocked(persist = true): void {
    for (const id of [...dispatcherStore.undocked]) useFloatStore().delete(paneUidFor(id));
    dispatcherStore.undocked = [];
    if (persist) save();
}

// A card was unmounted and its pane is gone without going through closeUndocked (the float store was
// cleared elsewhere): drop it from the open set without touching the saved list. A Map teardown that
// leaves the pane in the float store keeps the card open; it re-renders when the map comes back.
export function forgetUndocked(incidentId: string): void {
    if (useFloatStore().panes.has(paneUidFor(incidentId))) return;
    dispatcherStore.undocked = removeUndocked(dispatcherStore.undocked, incidentId);
}

// Unsaved input travels with the incident when it is undocked (a half-typed note, an open caller
// form, a close or reopen in progress), so pressing Undock never throws work away.
const drafts = new Map<string, Record<string, unknown>>();

export function stashDraft(incidentId: string, draft: Record<string, unknown>): void {
    drafts.set(incidentId, draft);
}

export function takeDraft(incidentId: string): Record<string, unknown> | undefined {
    const d = drafts.get(incidentId);
    drafts.delete(incidentId);
    return d;
}

// After a reload (the float store starts empty), reopen the cards that were open for this
// Event, skipping ids that no longer exist on the board.
export function restoreUndocked(): void {
    const ev = dispatcherStore.activeEvent;
    if (!ev || dispatcherStore.undocked.length) return;
    let saved: string[];
    try { saved = parseSavedUndocked(localStorage.getItem(undockStorageKey(ev.id))); }
    catch { saved = []; }
    for (const id of restorable(saved, dispatcherStore.incidents.map(i => i.id))) undockIncident(id);
}

// Cards belong to the open Event: closing or switching the Event closes them (the saved list
// for that Event is kept, so reopening the Event brings them back).
watch(() => dispatcherStore.activeEvent?.id, (id, old) => {
    if (id !== old) closeAllUndocked(false);
});
