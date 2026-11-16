import { defineAsyncComponent, watch } from 'vue';
import { useFloatStore } from '../../../src/stores/float.ts';
import { dispatcherStore } from './dispatcher-store.ts';
import type { WorkspaceCard } from './dispatcher-store.ts';
import {
    UNDOCK_CARD_WIDTH, UNDOCK_CARD_HEIGHT, firstFreeSlot, workspaceTileRect, workspaceSpotOf,
    addUndocked, removeUndocked, restorable, undockStorageKey, parseSavedUndocked,
} from './undock.ts';
import type { Draft } from './undock.ts';
import {
    multiMonitor, workspaceArea, showWorkspace, onWorkspaceClosed, workspaceOpen, dockDispatcher,
    dispatcherPaneRect,
} from './float-pane.ts';

// Where an undocked incident goes depends on the shared Display Mode (display-mode.ts):
//   Single Monitor Mode (default): a CloudTAK float pane over the map (the FloatStore the Dispatcher
//     pop-out uses), one per incident. The pane's config carries the incident id.
//   Multi-Monitor Mode: a card in the Dispatcher workspace window (float-pane.ts, DispatcherWorkspace.vue),
//     the one window the dispatcher keeps on another monitor; Undock opens the workspace if it is closed.
//     On a phone, or when the browser blocks the workspace window, it falls back to a pane.
// Either way the view reads the incident from dispatcherStore.incidents, so the shared poll keeps it current.
const PANE_PREFIX = 'plugin-tak-dispatcher-incident-';

// Async import: IncidentDetail (which triggers undock) and IncidentFloat (which hosts IncidentDetail)
// must not form a static import cycle.
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

// Multi-Monitor: incidents whose windows were in the workspace when it closed (or before a reload). They stay
// in the saved list, so the next press of the Dispatcher's pop-out button brings the workspace back with them.
let parked: string[] = [];

function save(): void {
    const ev = dispatcherStore.activeEvent;
    if (!ev) return;
    const keep = [...dispatcherStore.undocked, ...parked.filter(id => !dispatcherStore.undocked.includes(id))];
    try { localStorage.setItem(undockStorageKey(ev.id), JSON.stringify(keep)); }
    catch { /* private mode / quota */ }
}

// ── Multi-Monitor workspace cards ────────────────────────────────────────────────────────────────────
let topZ = 1;

function findCard(id: string) {
    return dispatcherStore.workspaceCards.find(c => c.id === id);
}

/** Bring a workspace card above the others (on click, or when it is undocked again). */
export function raiseCard(id: string): void {
    const c = findCard(id);
    if (c && c.z !== topZ) c.z = ++topZ;
}

/**
 * The dispatcher dragged or resized a card: from now on it keeps this place and size instead of following
 * the layout (the other cards take back its room).
 */
export function pinCard(id: string, rect: { x: number; y: number; w: number; h: number }): void {
    const c = findCard(id);
    if (!c) return;
    c.auto = false;
    c.x = Math.round(rect.x);
    c.y = Math.round(rect.y);
    c.w = Math.round(rect.w);
    c.h = Math.round(rect.h);
}

/**
 * Put a card the dispatcher moved or resized back into the layout (its button in the title bar): the cards
 * share the workspace again, this one in its original place among them.
 */
export function unpinCard(id: string): void {
    const c = findCard(id);
    if (!c) return;
    c.auto = true;
    raiseCard(id);
}

/**
 * A card's place in the workspace layout: its position among the cards that follow the layout (in the order
 * they were undocked), and how many there are. Cards the dispatcher has moved or resized are not counted.
 */
export function cardLayout(id: string): { index: number; count: number } {
    const auto = layoutCards();
    return { index: Math.max(0, auto.findIndex(c => c.id === id)), count: auto.length };
}

/** The cards that follow the layout, in the order they were undocked. */
export function layoutCards(): WorkspaceCard[] {
    return dispatcherStore.workspaceCards.filter(c => c.auto).sort((a, b) => a.slot - b.slot);
}

/**
 * The cards sharing a spot with `id` (itself included, in undock order): the tabs along the top of that
 * spot. One card when it has the spot to itself.
 */
export function spotMates(id: string, area: { width: number; height: number }): WorkspaceCard[] {
    const auto = layoutCards();
    const i = auto.findIndex(c => c.id === id);
    if (i === -1) return [];
    const spot = workspaceSpotOf(i, auto.length, area);
    return auto.filter((_, k) => workspaceSpotOf(k, auto.length, area) === spot);
}

// A new card joins the layout last; the cards already there make room (workspaceTileRect). Closing one gives
// its room back to the others. An incident that opened as a pane over the map (the browser had blocked the
// workspace) moves into the workspace: one window per incident.
function addCard(id: string): void {
    if (findCard(id)) { raiseCard(id); return; }
    useFloatStore().delete(paneUidFor(id));
    const slot = dispatcherStore.workspaceCards.reduce((m, c) => Math.max(m, c.slot + 1), 0);
    dispatcherStore.workspaceCards.push({ id, slot, auto: true, x: 0, y: 0, w: 0, h: 0, z: ++topZ });
    const { index, count } = cardLayout(id);
    const r = workspaceTileRect(index, count, workspaceArea());
    Object.assign(findCard(id)!, { x: r.x, y: r.y, w: r.w, h: r.h });
}

// The workspace window closed (by the dispatcher, or with this tab): its cards go with it. The saved list
// keeps them, so the pop-out button brings the workspace back with them inside it.
onWorkspaceClosed(() => {
    const ids = dispatcherStore.workspaceCards.map(c => c.id);
    dispatcherStore.workspaceCards = [];
    dispatcherStore.undocked = dispatcherStore.undocked.filter(id => !ids.includes(id));
    parked = [...new Set([...parked, ...ids])];
});

// ── Undock / close ───────────────────────────────────────────────────────────────────────────────────

// Open an incident in its own window, or bring its window to the front if it is already open.
export function undockIncident(incidentId: string): void {
    parked = removeUndocked(parked, incidentId);
    const floats = useFloatStore();
    const uid = paneUidFor(incidentId);
    const open = floats.panes.get(uid);

    if (multiMonitor()) {
        // Into the workspace; this opens it (from this click) if it is closed. A pane this incident got while
        // the workspace was blocked moves in with it (addCard).
        if (showWorkspace()) {
            addCard(incidentId);
            dispatcherStore.undocked = addUndocked(dispatcherStore.undocked, incidentId);
            save();
            return;
        }
        // The browser blocked the workspace window (showWorkspace left the hint): this incident opens as a
        // pane over the map; the Dispatcher itself stays where it is.
    }

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
        // A popped-out Dispatcher opens where the first window would: new windows keep clear of it.
        const dispatcher = dispatcherPaneRect();
        const pos = firstFreeSlot(taken, paneBase(), viewport(),
            { width: UNDOCK_CARD_WIDTH, height: UNDOCK_CARD_HEIGHT }, dispatcher ? [dispatcher] : []);
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

// Close the card or pane. The incident stays on the board; nothing else changes.
export function closeUndocked(incidentId: string): void {
    dispatcherStore.workspaceCards = dispatcherStore.workspaceCards.filter(c => c.id !== incidentId);
    useFloatStore().delete(paneUidFor(incidentId));
    dispatcherStore.undocked = removeUndocked(dispatcherStore.undocked, incidentId);
    parked = removeUndocked(parked, incidentId);
    drafts.delete(incidentId);
    save();
}

// Close every card and pane. `persist` false keeps the Event's saved list (the Event was closed or switched,
// or the plugin was disabled, so they come back with it); the list's Close all saves the empty list.
export function closeAllUndocked(persist = true): void {
    for (const id of [...dispatcherStore.undocked]) useFloatStore().delete(paneUidFor(id));
    dispatcherStore.workspaceCards = [];
    dispatcherStore.undocked = [];
    parked = [];
    drafts.clear();
    dispatcherStore.windowBlocked = false;
    if (persist) save();
}

// A pane was unmounted and is gone without going through closeUndocked (the float store was cleared
// elsewhere): drop it from the open set without touching the saved list. A Map teardown that leaves the
// pane in the float store keeps it open; it re-renders when the map comes back.
export function forgetUndocked(incidentId: string): void {
    if (useFloatStore().panes.has(paneUidFor(incidentId)) || findCard(incidentId)) return;
    dispatcherStore.undocked = removeUndocked(dispatcherStore.undocked, incidentId);
    drafts.delete(incidentId);
}

// Unsaved input travels with the incident when it is undocked (a half-typed note, an open caller
// form, a close or reopen in progress), so pressing Undock never throws work away. The window that opens
// takes it when it mounts. (Undock is grayed out for an incident that already has its window.)
const drafts = new Map<string, Draft>();

export function stashDraft(incidentId: string, draft: Draft): void {
    drafts.set(incidentId, draft);
}

export function takeDraft(incidentId: string): Draft | undefined {
    const d = drafts.get(incidentId);
    drafts.delete(incidentId);
    return d;
}

// ── After a reload, or when the workspace opens ──────────────────────────────────────────────────────
// Bring back what was undocked for this Event, skipping ids no longer on the board. Runs when the
// Dispatcher list mounts (in the panel, a pane, or the workspace).
//   Single Monitor: the panes reopen at once.
//   Multi-Monitor, list inside the open workspace: the cards come back inside it.
//   Multi-Monitor, workspace closed: nothing opens (a browser opens a window only from a click); they wait
//     in the saved list for the next press of the Dispatcher's pop-out button.
export function restoreUndocked(): void {
    const ev = dispatcherStore.activeEvent;
    if (!ev) return;
    let saved: string[];
    try { saved = parseSavedUndocked(localStorage.getItem(undockStorageKey(ev.id))); }
    catch { saved = []; }
    const ids = restorable(saved, dispatcherStore.incidents.map(i => i.id));

    if (multiMonitor()) {
        if (workspaceOpen()) {
            parked = [];
            for (const id of ids) {
                addCard(id);
                dispatcherStore.undocked = addUndocked(dispatcherStore.undocked, id);
            }
        } else {
            parked = ids.filter(id => !dispatcherStore.undocked.includes(id));
        }
        return;
    }
    if (dispatcherStore.undocked.length) return;
    parked = [];
    for (const id of ids) undockIncident(id);
}

// Cards and panes belong to the open Event: closing or switching the Event closes them (the saved list
// for that Event is kept, so reopening the Event brings them back).
watch(() => dispatcherStore.activeEvent?.id, (id, old) => {
    if (id !== old) closeAllUndocked(false);
});

// Changing the Display Mode closes the old mode's windows (the workspace and its cards, or the pop-out and the
// incident panes) and the Dispatcher comes back to the menu. The Event's saved list is kept, so the incidents
// come back the new way: panes at once in Single Monitor Mode, in the workspace on the next Workspace press.
watch(() => dispatcherStore.displayMode, (mode, old) => {
    if (mode === old) return;
    closeAllUndocked(false);
    dockDispatcher();
});
