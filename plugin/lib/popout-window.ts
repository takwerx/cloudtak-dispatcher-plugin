import { createApp } from 'vue';
import type { App, Component } from 'vue';

// Multi-Monitor Mode: show a plugin view in its own browser window, which the dispatcher can drag onto
// any monitor. The window is opened empty (window.open with no URL, so no second CloudTAK loads) and
// the view is mounted into it from THIS tab as a second Vue app. It runs in this tab's JavaScript, so it
// shares the live dispatcher store and CloudTAK's stores (Pinia falls back to the active store when the
// app does not provide one), with no second sign-in and no polling lag. The tab owns the windows: when it
// is closed or reloaded every window it opened is closed too, since nothing can drive them after that.
//
// Browsers only let a click open a window, and block it otherwise (or when pop-ups are disallowed for
// the site): openPopout returns null then and the caller falls back to a pane over the map.

interface Popout {
    win:     Window;
    app:     App;
    timer:   ReturnType<typeof setInterval>;
    closed:  boolean;
    onClose: (byUser: boolean) => void;
}

const popouts = new Map<string, Popout>();
let mainUnloading = false;

// `only`: finish just this window, not a newer one opened since under the same key.
function finish(key: string, byUser: boolean, only?: Popout): void {
    const p = popouts.get(key);
    if (!p || p.closed || (only && p !== only)) return;
    p.closed = true;
    popouts.delete(key);
    clearInterval(p.timer);
    try { p.app.unmount(); } catch { /* window already gone */ }
    if (!p.win.closed) {
        try { p.win.close(); } catch { /* ignore */ }
    }
    p.onClose(byUser);
}

if (typeof window !== 'undefined') {
    // The CloudTAK tab is going away: close its windows. onClose(false) tells the owners this was not
    // the dispatcher closing them, so the list of open windows is kept for after the reload.
    window.addEventListener('pagehide', () => {
        mainUnloading = true;
        for (const key of [...popouts.keys()]) finish(key, false);
    });
}

// Copy CloudTAK's stylesheets (Bootstrap / Tabler, the plugin's scoped styles) into a window, so the view
// looks the same there. Links get absolute URLs: the empty window has no base of its own.
function cloneStyle(node: Element, doc: Document): Element | null {
    if (node instanceof HTMLLinkElement && node.rel === 'stylesheet') {
        const l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = node.href;
        return l;
    }
    if (node instanceof HTMLStyleElement) {
        const s = doc.createElement('style');
        s.textContent = node.textContent;
        return s;
    }
    return null;
}

// Styles CloudTAK loads later (a lazily loaded part of the app) are copied into every open window too.
let observer: MutationObserver | undefined;
function watchStyles(): void {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver((records) => {
        for (const r of records) {
            for (const n of r.addedNodes) {
                if (!(n instanceof Element)) continue;
                for (const p of popouts.values()) {
                    const c = cloneStyle(n, p.win.document);
                    if (c) p.win.document.head.appendChild(c);
                }
            }
        }
    });
    observer.observe(document.head, { childList: true });
}

function prepare(win: Window, title: string): HTMLElement {
    const doc = win.document;
    // Start clean: a window left over under the same name (it should have been closed with its tab).
    doc.head.replaceChildren();
    doc.body.replaceChildren();
    doc.title = title;
    // Theme: Bootstrap / Tabler read data-bs-theme and classes from <html> and <body>.
    for (const attr of ['data-bs-theme', 'class', 'lang']) {
        const h = document.documentElement.getAttribute(attr);
        if (h !== null) doc.documentElement.setAttribute(attr, h);
        const b = document.body.getAttribute(attr);
        if (b !== null) doc.body.setAttribute(attr, b);
    }
    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    doc.head.appendChild(meta);
    for (const n of document.querySelectorAll('link[rel="stylesheet"], style')) {
        const c = cloneStyle(n, doc);
        if (c) doc.head.appendChild(c);
    }
    doc.body.style.margin = '0';
    doc.documentElement.style.height = '100%';
    doc.body.style.height = '100%';
    const root = doc.createElement('div');
    root.style.height = '100%';
    doc.body.appendChild(root);
    return root;
}

// The window the dispatcher just clicked in: the main tab, or one of its windows (Undock pressed inside
// the popped-out Dispatcher). A browser lets a click open a window only from the window that was clicked.
function clickedWindow(): Window {
    const all: Window[] = [window, ...[...popouts.values()].filter(p => !p.closed && !p.win.closed).map(p => p.win)];
    const active = all.find(w => (w.navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive);
    if (active) return active;
    return all.find(w => { try { return w.document.hasFocus(); } catch { return false; } }) ?? window;
}

/** The window for `key` while it is open. */
export function popoutWindow(key: string): Window | null {
    const p = popouts.get(key);
    return p && !p.closed && !p.win.closed ? p.win : null;
}

/** True while the window for `key` is open. */
export function popoutOpen(key: string): boolean {
    const p = popouts.get(key);
    return !!p && !p.closed && !p.win.closed;
}

/** Bring the window for `key` to the front. False if there is none. */
export function focusPopout(key: string): boolean {
    if (!popoutOpen(key)) return false;
    try { popouts.get(key)!.win.focus(); } catch { /* ignore */ }
    return true;
}

/** Close the window for `key` from this tab (the dispatcher's X in the list, Close all, Event change). */
export function closePopout(key: string): void {
    finish(key, false);
}

/** True once this tab has started to unload (a reload or close): windows closing now were not closed by the dispatcher. */
export function isMainUnloading(): boolean {
    return mainUnloading;
}

/**
 * Open `component` in its own browser window. Must run from a click. Returns null when the browser
 * blocks the window; the caller then falls back to a pane over the map.
 * `onClose(byUser)` runs once when the window goes: byUser is true when the dispatcher closed the window
 * itself, false when this tab closed it (closePopout, or the tab unloading).
 */
export function openPopout(opts: {
    key:       string;
    title:     string;
    component: Component;
    props?:    Record<string, unknown>;
    width:     number;
    height:    number;
    left:      number;
    top:       number;
    onClose:   (byUser: boolean) => void;
}): Window | null {
    if (focusPopout(opts.key)) return popouts.get(opts.key)!.win;
    // A window that closed without telling us yet (no pagehide, the 1 s check not run): finish it first, so its
    // owners clean up and its check cannot later close the window opened now.
    finish(opts.key, !mainUnloading);
    const features = `popup,width=${Math.round(opts.width)},height=${Math.round(opts.height)},left=${Math.round(opts.left)},top=${Math.round(opts.top)}`;
    let win: Window | null = null;
    try { win = clickedWindow().open('', `tak-dispatcher-${opts.key}`, features); } catch { win = null; }
    if (!win) return null;

    const root = prepare(win, opts.title);
    const app = createApp(opts.component, opts.props ?? {});
    const entry: Popout = {
        win,
        app,
        closed:  false,
        onClose: opts.onClose,
        // pagehide is the normal signal that the dispatcher closed the window; the check covers a
        // browser that does not fire it for an empty window.
        timer:   setInterval(() => { if (win!.closed) finish(opts.key, !mainUnloading, entry); }, 1000),
    };
    popouts.set(opts.key, entry);
    win.addEventListener('pagehide', () => finish(opts.key, !mainUnloading, entry));
    // Watch for late styles BEFORE mounting: mounting starts loading the view's own code, and its
    // stylesheet is added to this tab's <head> right then. Started after mount, that sheet was missed.
    watchStyles();
    app.mount(root);
    return win;
}
