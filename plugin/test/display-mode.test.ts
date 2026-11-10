// Proof tests for Display Mode (Single Monitor / Multi-Monitor), a per-computer choice remembered in the
// browser. Plain node: lib/display-mode.ts has no imports, so it is loaded as it ships, with a small
// in-memory stand-in for the browser's localStorage.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from '../lib/display-mode.ts';

function memStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem:    (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem:    (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
    };
}

test('default is Single Monitor Mode, so a computer that never chooses behaves as before', () => {
    assert.equal(m.DISPLAY_MODE_DEFAULT, 'single');
    assert.equal(m.loadDisplayMode(memStorage()), 'single');
});

test('only exactly "multi" reads as Multi-Monitor Mode', () => {
    assert.equal(m.parseDisplayMode('multi'), 'multi');
    for (const bad of ['MULTI', 'Multi', ' multi', 'multiple', '', 'single', null, undefined]) {
        assert.equal(m.parseDisplayMode(bad as string | null | undefined), 'single', String(bad));
    }
});

test('the choice is remembered and read back (it stays across sessions on this computer)', () => {
    const s = memStorage();
    assert.equal(m.saveDisplayMode('multi', s), 'multi');
    assert.equal(s.map.get(m.DISPLAY_MODE_KEY), 'multi');
    assert.equal(m.loadDisplayMode(s), 'multi');
    // Back to the default stores nothing at all.
    assert.equal(m.saveDisplayMode('single', s), 'single');
    assert.equal(s.map.has(m.DISPLAY_MODE_KEY), false);
    assert.equal(m.loadDisplayMode(s), 'single');
});

test('a bad value saves as the default', () => {
    const s = memStorage();
    m.saveDisplayMode('multi', s);
    assert.equal(m.saveDisplayMode('dual', s), 'single');
    assert.equal(m.loadDisplayMode(s), 'single');
});

test('storage that throws (private window, blocked site data) never breaks the Dispatcher', () => {
    const broken = {
        getItem:    () => { throw new Error('denied'); },
        setItem:    () => { throw new Error('denied'); },
        removeItem: () => { throw new Error('denied'); },
    };
    assert.equal(m.loadDisplayMode(broken), 'single');
    assert.equal(m.saveDisplayMode('multi', broken), 'multi');
});

test('it is not a server setting: the server file does not know it', () => {
    const server = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
    assert.ok(!server.includes('display_mode'), 'display_mode must not be a server setting');
});

