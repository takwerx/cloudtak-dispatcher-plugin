import { reactive } from 'vue';
import type { DispatcherEvent, DispatcherIncident } from './events-client.ts';
import type { CjisReminder } from './cjis-reminder.ts';
import { CJIS_REMINDER_DEFAULT_TEXT } from './cjis-reminder.ts';
import { loadOperator, saveOperator } from './operator.ts';
import { loadDisplayMode } from './display-mode.ts';
import { loadForcedMode } from './panel-state.ts';
import type { DisplayMode } from './display-mode.ts';

export type ServerMode = 'detecting' | 'takcad' | 'standalone';

// One undocked incident inside the Multi-Monitor workspace window (position relative to its card area).
// While `auto`, it shares the workspace with the other auto cards (undock.ts workspaceTileRect), in the order
// of `slot` (the order they were undocked); once the dispatcher drags or resizes it, it keeps the
// x / y / w / h they gave it.
export interface WorkspaceCard {
    id:   string;
    slot: number;
    auto: boolean;
    x:    number;
    y:    number;
    w:    number;
    h:    number;
    z:    number;
}

interface DispatcherState {
    serverMode:     ServerMode;
    forcedMode:     'standalone' | null;
    dispatcherName: string;
    // Shared admin switch 'Employee numbers' (Dispatcher Settings; default off). Off = none of the operator UI shows.
    operatorNumbers: boolean;
    // Employee number of the person at this terminal (standalone mode; see operator.ts). null = not set.
    operator:       string | null;
    // True while the Dispatcher is detached into a floating pane over the map; the
    // anchored menu view collapses to a dock-back placeholder so the board isn't
    // mounted (and polling) twice.
    floating:       boolean;
    // Multi-Monitor Mode: the detached Dispatcher is in the workspace window rather than a pane.
    floatingWindow: boolean;
    // Incident ids currently undocked into their own window (opening order): a pane over the map in
    // Single Monitor Mode, a browser window in Multi-Monitor Mode.
    undocked:       string[];
    // This computer's Display Mode (Dispatcher Settings; remembered in this browser): 'single' (default) or 'multi'.
    displayMode:    DisplayMode;
    // Multi-Monitor Mode: the browser refused a new window, so the last undock fell back to a pane.
    windowBlocked:  boolean;
    // Multi-Monitor Mode: incident cards open in the workspace window, with their place and size there.
    workspaceCards: WorkspaceCard[];
    // Standalone Event→Incident model (server-backed; shared across dispatchers on this CloudTAK).
    events:         DispatcherEvent[];
    activeEvent:    DispatcherEvent | null;
    incidents:      DispatcherIncident[];
    // Shared 'Caller details on map markers' setting (Dispatcher Settings); markers read it synchronously.
    callerOnMarkers: boolean;
    // Shared CJIS reminder line on every standalone incident (Dispatcher Settings; admin-only to change).
    cjisReminder:   CjisReminder;
}

export const dispatcherStore = reactive<DispatcherState>({
    serverMode:     'detecting',
    forcedMode:     loadForcedMode(),
    dispatcherName: '',
    operatorNumbers: false,
    operator:       loadOperator(),
    floating:       false,
    floatingWindow: false,
    undocked:       [],
    displayMode:    loadDisplayMode(),
    windowBlocked:  false,
    workspaceCards: [],
    events:         [],
    activeEvent:    null,
    incidents:      [],
    callerOnMarkers: true,
    cjisReminder:   { enabled: true, text: CJIS_REMINDER_DEFAULT_TEXT },
});

// The board itself is now server-backed (CloudTAK Postgres via the dispatcher route), so it
// no longer persists in the browser. We keep ONE tiny key — the last opened Event id —
// purely as a convenience so a reload reselects it. Everything else (the event list and
// incidents) is re-fetched from the server on mount. Stored in localStorage, the same store
// CloudTAK uses for its own auth token; CloudTAK's web build has no Capacitor runtime, so
// the Capacitor Preferences API is unavailable here.
const LAST_EVENT_KEY = 'tak-dispatcher-last-event-v1';

export async function loadLastEventId(): Promise<string | null> {
    try {
        return localStorage.getItem(LAST_EVENT_KEY) || null;
    } catch {
        return null;
    }
}

export function saveLastEventId(id: string | null): void {
    try {
        if (id) localStorage.setItem(LAST_EVENT_KEY, id);
        else localStorage.removeItem(LAST_EVENT_KEY);
    } catch {
        // ignore storage failures (private mode / quota)
    }
}

// Apply the shared Employee Numbers switch. Turning it off also forgets this terminal's number, so
// nothing is sent and the header asks again if an admin turns it back on.
export function applyOperatorNumbers(on: boolean): void {
    dispatcherStore.operatorNumbers = on;
    if (!on && dispatcherStore.operator) {
        dispatcherStore.operator = null;
        saveOperator(null);
    }
}
