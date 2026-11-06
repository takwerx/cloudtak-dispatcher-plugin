// Display Mode: how the Dispatcher uses the screens of THIS computer. Each dispatcher picks it in
// Dispatcher Settings → Display Mode; it is remembered in this browser (localStorage), so it stays across
// sessions and reloads on this computer and never affects anyone else. It is per computer, not per login,
// because it describes the desk (one monitor or several), and dispatch desks often share a CloudTAK login.
// No imports on purpose: plugin/test/display-mode.test.ts loads this file as it ships.
//
//   single  Single Monitor Mode (default). Undock opens an incident in a window over the map, inside the
//           CloudTAK page; the Dispatcher's pop-out button floats it over the map.
//   multi   Multi-Monitor Mode. The Dispatcher's pop-out button opens the Dispatcher workspace, one browser
//           window to drag onto another monitor and maximize: the Dispatcher pinned to its right edge,
//           undocked incidents as cards beside it, the map staying on the first monitor.

export type DisplayMode = 'single' | 'multi';

export const DISPLAY_MODE_KEY = 'tak-dispatcher-display-mode-v1';
export const DISPLAY_MODE_DEFAULT: DisplayMode = 'single';
export const DISPLAY_MODES: readonly DisplayMode[] = ['single', 'multi'];

/** True for a stored value that names a mode. */
export function isDisplayMode(value: unknown): value is DisplayMode {
    return value === 'single' || value === 'multi';
}

/** What is stored, as a mode: anything but exactly 'multi' (nothing stored, a bad value) is single. */
export function parseDisplayMode(raw: string | null | undefined): DisplayMode {
    return isDisplayMode(raw) ? raw : DISPLAY_MODE_DEFAULT;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(s?: Storage): Storage | undefined {
    if (s) return s;
    try { return globalThis.localStorage ?? undefined; } catch { return undefined; }
}

/** This computer's mode. No storage (private window, blocked site data) reads as the default. */
export function loadDisplayMode(s?: Storage): DisplayMode {
    try { return parseDisplayMode(storage(s)?.getItem(DISPLAY_MODE_KEY)); }
    catch { return DISPLAY_MODE_DEFAULT; }
}

/** Remember this computer's mode. The default is stored as "nothing stored". Returns the mode in force. */
export function saveDisplayMode(mode: unknown, s?: Storage): DisplayMode {
    const m = isDisplayMode(mode) ? mode : DISPLAY_MODE_DEFAULT;
    try {
        const st = storage(s);
        if (m === DISPLAY_MODE_DEFAULT) st?.removeItem(DISPLAY_MODE_KEY);
        else st?.setItem(DISPLAY_MODE_KEY, m);
    } catch { /* storage unavailable: it lasts for this page only */ }
    return m;
}
