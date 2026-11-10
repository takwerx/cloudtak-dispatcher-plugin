// Proof tests for "a reload keeps the Dispatcher where it was": the panel reopens, and TAK-CAD stays switched off.
// Plain node: lib/panel-state.ts has no imports, so it is loaded as it ships, with a small in-memory stand-in
// for the browser's localStorage. The wiring (CadMain, store, index) is checked in the shipped source.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as p from '../lib/panel-state.ts';

function memStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem:    (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem:    (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
    };
}
const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('a computer that never opened the panel starts closed and looks for TAK-CAD', () => {
    const s = memStorage();
    assert.equal(p.loadPanelOpen(s), false);
    assert.equal(p.loadForcedMode(s), null);
});

test('open is remembered, and closing forgets it', () => {
    const s = memStorage();
    p.savePanelOpen(true, s);
    assert.equal(p.loadPanelOpen(s), true);
    p.savePanelOpen(false, s);
    assert.equal(s.map.has(p.PANEL_OPEN_KEY), false);
    assert.equal(p.loadPanelOpen(s), false);
});

test('only the exact stored value counts as open', () => {
    for (const bad of ['0', 'true', '', ' 1', 'yes']) {
        const s = memStorage();
        s.setItem(p.PANEL_OPEN_KEY, bad);
        assert.equal(p.loadPanelOpen(s), false, bad);
    }
});

test('switching TAK-CAD off is remembered across a reload; switching it on clears it', () => {
    const s = memStorage();
    p.saveForcedMode('standalone', s);
    assert.equal(p.loadForcedMode(s), 'standalone');
    p.saveForcedMode(null, s);
    assert.equal(s.map.has(p.FORCED_MODE_KEY), false);
    assert.equal(p.loadForcedMode(s), null);
});

test('a bad stored mode is ignored, so TAK-CAD detection runs as usual', () => {
    for (const bad of ['takcad', 'STANDALONE', '', '1']) {
        const s = memStorage();
        s.setItem(p.FORCED_MODE_KEY, bad);
        assert.equal(p.loadForcedMode(s), null, bad);
    }
});

test('no storage at all (private window) reads as closed and not forced, and saving does not throw', () => {
    const broken = {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
        removeItem: () => { throw new Error('blocked'); },
    };
    assert.equal(p.loadPanelOpen(broken), false);
    assert.equal(p.loadForcedMode(broken), null);
    assert.doesNotThrow(() => { p.savePanelOpen(true, broken); p.saveForcedMode('standalone', broken); });
});

test('reopen only when it was open and the page is not already showing it', () => {
    const R = 'home-menu-tak-dispatcher';
    assert.equal(p.shouldReopenPanel(true, 'home', R), true);
    assert.equal(p.shouldReopenPanel(true, undefined, R), true);
    assert.equal(p.shouldReopenPanel(true, R, R), false);
    assert.equal(p.shouldReopenPanel(false, 'home', R), false);
});

test('wiring: the store starts from the remembered TAK-CAD choice, not always null', () => {
    const store = src('lib/dispatcher-store.ts');
    assert.match(store, /forcedMode:\s+loadForcedMode\(\)/);
    assert.doesNotMatch(store, /forcedMode:\s+null,/);
});

test('wiring: the header pill saves the choice both ways', () => {
    const main = src('components/CadMain.vue');
    assert.match(main, /store\.forcedMode = 'standalone';\s*saveForcedMode\('standalone'\)/);
    assert.match(main, /store\.forcedMode = null;\s*saveForcedMode\(null\)/);
});

test('wiring: only the menu copy of the panel (not the floating one) marks itself open and closed', () => {
    const main = src('components/CadMain.vue');
    assert.match(main, /onMounted\(\(\) => \{ if \(!props\.floating\) savePanelOpen\(true\); \}\)/);
    assert.match(main, /onBeforeUnmount\(\(\) => \{ if \(!props\.floating\) savePanelOpen\(false\); \}\)/);
});

test('wiring: enabling the plugin reopens the panel through the router', () => {
    const idx = src('index.ts');
    assert.match(idx, /shouldReopenPanel\(loadPanelOpen\(\), router\.currentRoute\.value\.name, ROUTE_NAME\)/);
    assert.match(idx, /router\.push\(\{ name: ROUTE_NAME \}\)/);
});
