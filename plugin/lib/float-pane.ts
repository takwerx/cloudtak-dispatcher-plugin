import { defineAsyncComponent } from 'vue';
import { useFloatStore } from '../../../src/stores/float.ts';
import { useAppStore } from '../../../src/stores/app.ts';
import { dispatcherStore } from './dispatcher-store.ts';
import { openPopout, closePopout, focusPopout, popoutWindow } from './popout-window.ts';
import { WORKSPACE_PANEL_WIDTH } from './undock.ts';

// Detach/re-attach the whole Dispatcher.
//   Single Monitor Mode (default): a draggable, resizable pane over the map using CloudTAK's own
//     FloatStore (generic add() exists since 13.45, which this plugin already requires for its server
//     routes); the pane is a singleton keyed by this uid.
//   Multi-Monitor Mode: the Dispatcher workspace, one browser window of its own (popout-window.ts) that
//     the dispatcher drags onto another monitor and maximizes. The Dispatcher panel is pinned to its right
//     edge and undocked incidents open as cards in the space to its left (undock-panes.ts), like
//     CloudTAK's video wall: one window that things are sent into. A phone, or a browser that blocks the
//     window, gets the pane instead.
const PANE_UID = 'plugin-tak-dispatcher-float';
const WORKSPACE_KEY = 'workspace';

// Async imports so CadMain (which triggers pop-out) and its hosts don't form a static import cycle.
const DispatcherFloat     = defineAsyncComponent(() => import('../components/DispatcherFloat.vue'));
const DispatcherWorkspace = defineAsyncComponent(() => import('../components/DispatcherWorkspace.vue'));

/** Multi-Monitor Mode on a screen that can show a separate window. */
export function multiMonitor(): boolean {
    if (dispatcherStore.displayMode !== 'multi') return false;
    try { return !useAppStore().isMobileDetected; } catch { return true; }
}

/** True while the Multi-Monitor workspace window is open. */
export function workspaceOpen(): boolean {
    return !!popoutWindow(WORKSPACE_KEY);
}

/** Bring the workspace window to the front. */
export function focusWorkspace(): void {
    focusPopout(WORKSPACE_KEY);
}

/** Size of the card area in the workspace (the window minus the Dispatcher panel), or a fallback. */
export function workspaceArea(): { width: number; height: number } {
    const win = popoutWindow(WORKSPACE_KEY);
    const w = win?.innerWidth || 1600;
    const h = win?.innerHeight || 900;
    return { width: Math.max(0, w - WORKSPACE_PANEL_WIDTH), height: h };
}

// Run when the workspace closes, by the dispatcher or with this tab (undock-panes.ts clears its cards).
const closedHandlers: (() => void)[] = [];
export function onWorkspaceClosed(fn: () => void): void {
    closedHandlers.push(fn);
}

function openWorkspace(): boolean {
    const avail = typeof screen !== 'undefined' ? screen : undefined;
    const win = openPopout({
        key:       WORKSPACE_KEY,
        title:     'Dispatcher',
        component: DispatcherWorkspace,
        // Opens large near this window; the dispatcher drags it to another monitor and maximizes it.
        width:     Math.min(avail?.availWidth || 1600, 1600),
        height:    avail?.availHeight || 900,
        left:      (window.screenX || 0) + 40,
        top:       (window.screenY || 0) + 20,
        onClose:   () => {
            dispatcherStore.floating = false;
            dispatcherStore.floatingWindow = false;
            for (const fn of closedHandlers) fn();
        },
    });
    if (!win) return false;
    dispatcherStore.floating = true;
    dispatcherStore.floatingWindow = true;
    dispatcherStore.windowBlocked = false;
    return true;
}

/**
 * Multi-Monitor Mode: bring the workspace window up (opening it from this click if it is closed). False,
 * with the blocked-window hint shown, when the browser refused it.
 */
export function showWorkspace(): boolean {
    if (workspaceOpen()) { focusWorkspace(); return true; }
    if (openWorkspace()) return true;
    dispatcherStore.windowBlocked = true;
    return false;
}

/** Pop the Dispatcher out: the Multi-Monitor workspace window, or else a pane over the map. */
export function popOutDispatcher(): void {
    if (multiMonitor() && showWorkspace()) return;
    useFloatStore().add({
        uid:       PANE_UID,
        name:      'Dispatcher',
        component: DispatcherFloat,
        width:     420,
        height:    640,
    });
    dispatcherStore.floating = true;
    dispatcherStore.floatingWindow = false;
}

export function dockDispatcher(): void {
    closePopout(WORKSPACE_KEY);
    useFloatStore().delete(PANE_UID);
    dispatcherStore.floating = false;
    dispatcherStore.floatingWindow = false;
}
