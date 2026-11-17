import { reactive } from 'vue';
import { loadCommandLine, saveCommandLine } from './command-line.ts';
import type { IncidentQueue } from './unit-status.ts';

// What the command line (CommandLine.vue) needs to know about the rest of the Dispatcher: whether it is
// shown on this computer, which incident the dispatcher is working, and how to reach the incident list.
// The views tell it; it never reaches into them.

export const commandState = reactive({
    // Shown on this computer (the Command line button, or F2). Remembered like Display Mode.
    shown:   loadCommandLine(),
    // The incident the dispatcher last opened, clicked in or typed in, while it is still on screen.
    current: null as string | null,
});

export function setCommandLineShown(shown: boolean): void {
    commandState.shown = shown;
    saveCommandLine(shown);
}

// ── Incident views on screen (the panel's detail and every undocked card) ────────────────────────────
// The incident being worked is the one the dispatcher last opened, clicked in, typed in or brought to the
// front. A window that comes back by itself (after a reload) does not take that over, and when the
// incident being worked leaves the screen there is none until the dispatcher goes to another.

export interface IncidentViewApi {
    // The panel's Undock button, which takes what is being typed along. Cards have none.
    undock?: () => void;
}

// An incident can be on screen twice (in the panel and in its own window), so each id keeps a list.
const views = new Map<string, IncidentViewApi[]>();
// The incident the dispatcher just asked to see in its own window, until that window is up.
let awaited: string | null = null;

/**
 * An incident view came on screen. `opened` is true for the panel, which only ever shows an incident the
 * dispatcher just opened; a window is the one being worked only when the dispatcher asked for it (workOn).
 */
export function registerIncidentView(id: string, api: IncidentViewApi, opened: boolean): () => void {
    views.set(id, [...(views.get(id) ?? []), api]);
    if (opened || awaited === id) commandState.current = id;
    if (awaited === id) awaited = null;
    return () => {
        const left = (views.get(id) ?? []).filter(a => a !== api);
        if (left.length) { views.set(id, left); return; }
        views.delete(id);
        if (commandState.current === id) commandState.current = null;
    };
}

/** The dispatcher clicked or typed in this incident's view, or brought its window to the front. */
export function touchIncidentView(id: string): void {
    if (views.has(id)) commandState.current = id;
}

/**
 * The dispatcher asked for this incident (Undock, or a command): it is the one being worked now if it is on
 * screen, and it stays so in the window that is about to show it (Undock closes the panel's view first).
 */
export function workOn(id: string): void {
    if (views.has(id)) commandState.current = id;
    awaited = id;
}

/** The panel's Undock for this incident, when the panel is showing it. */
export function panelUndock(id: string): (() => void) | undefined {
    return (views.get(id) ?? []).find(a => a.undock)?.undock;
}

// ── The incident list in the Dispatcher (IncidentListView.vue) ───────────────────────────────────────

export interface NewIncidentPrefill {
    type?:    string;   // the type's name, exactly as the list has it
    address?: string;   // text for the address search
}

export interface ListApi {
    view:        () => 'list' | 'detail' | 'form';
    detailId:    () => string | null;
    open:        (id: string) => void;
    list:        (tab?: IncidentQueue) => void;
    newIncident: (prefill: NewIncidentPrefill) => void;
}

let listApi: ListApi | null = null;

export function registerList(api: ListApi): () => void {
    listApi = api;
    return () => { if (listApi === api) listApi = null; };
}

export function incidentList(): ListApi | null {
    return listApi;
}

// ── The Dispatcher frame (CadMain.vue) ───────────────────────────────────────────────────────────────

// Its own buttons, handed to the command line as they are.
export interface CommandActions {
    signIn:      (text: string) => string;   // the error to show, or '' when signed in
    signOut:     () => void;
    switchEvent: () => void;
    report:      () => void;
    settings:    () => void;
    // Back to the incidents, closing Settings or the Event report if one is showing.
    board:       () => void;
}
