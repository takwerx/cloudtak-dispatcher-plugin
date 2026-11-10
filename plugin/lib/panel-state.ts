// What the Dispatcher panel was doing when the page last closed, so a reload picks up where the dispatcher was:
//   open        the Dispatcher panel was open (its menu page was showing). CloudTAK adds plugin pages only after
//               the page has loaded, so a reload of that page lands on the map; the plugin uses this to open it again.
//   standalone  the dispatcher switched TAK-CAD off ("TAK-CAD ●" pill). Stays off until they switch it on again.
// Both are remembered in this browser (localStorage), like Display Mode, because they describe this desk.
// No imports on purpose: plugin/test/panel-state.test.ts loads this file as it ships.

export const PANEL_OPEN_KEY  = 'tak-dispatcher-panel-open-v1';
export const FORCED_MODE_KEY = 'tak-dispatcher-forced-mode-v1';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(s?: Storage): Storage | undefined {
    if (s) return s;
    try { return globalThis.localStorage ?? undefined; } catch { return undefined; }
}

/** True only when the panel was left open ("1" stored). Nothing stored, a bad value or no storage is closed. */
export function loadPanelOpen(s?: Storage): boolean {
    try { return storage(s)?.getItem(PANEL_OPEN_KEY) === '1'; }
    catch { return false; }
}

/** Remember whether the panel is open. Closed is stored as "nothing stored". */
export function savePanelOpen(open: boolean, s?: Storage): void {
    try {
        const st = storage(s);
        if (open) st?.setItem(PANEL_OPEN_KEY, '1');
        else st?.removeItem(PANEL_OPEN_KEY);
    } catch { /* storage unavailable: it lasts for this page only */ }
}

/** 'standalone' when TAK-CAD was switched off here, else null (look for TAK-CAD as usual). */
export function loadForcedMode(s?: Storage): 'standalone' | null {
    try { return storage(s)?.getItem(FORCED_MODE_KEY) === 'standalone' ? 'standalone' : null; }
    catch { return null; }
}

/** Remember that TAK-CAD is switched off ('standalone'), or clear it (null) when the dispatcher switches it on. */
export function saveForcedMode(mode: 'standalone' | null, s?: Storage): void {
    try {
        const st = storage(s);
        if (mode === 'standalone') st?.setItem(FORCED_MODE_KEY, 'standalone');
        else st?.removeItem(FORCED_MODE_KEY);
    } catch { /* storage unavailable: it lasts for this page only */ }
}

/** What the plugin should do when it is enabled after a page load: open the panel again only if it was open
 *  and the page is not already showing it. `routeName` is the current route's name. */
export function shouldReopenPanel(wasOpen: boolean, routeName: unknown, panelRoute: string): boolean {
    return wasOpen && routeName !== panelRoute;
}
