// Tests for the Local Address Data sources list (#108, items 3 to 5): the Name box follows the picked
// file, renaming a source, and the short list. Plain node: lib/address-sources.ts has no imports.
// The page wiring is checked in the component's source, the way it ships.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from '../lib/address-sources.ts';

const vue = readFileSync(new URL('../components/AddressSources.vue', import.meta.url), 'utf8');

test('file name to source name: extension and folders dropped, kept to the server limit', () => {
    assert.equal(m.fileBaseName('Lane County.csv'), 'Lane County');
    assert.equal(m.fileBaseName('points.v2.geojson'), 'points.v2');
    assert.equal(m.fileBaseName('C:\\fakepath\\North.csv'), 'North');
    assert.equal(m.fileBaseName('noext'), 'noext');
    assert.equal(m.fileBaseName('x'.repeat(200) + '.csv').length, m.NAME_MAX);
});

test('Name box: a second file picked after a finished load gets its own name, not the last source\'s (the reported case)', () => {
    // The reporter: load North.csv, then pick South.csv in the same open form.
    let box = { name: '', typed: false, replacing: false };
    box.name = m.nameAfterPick(box, 'North');
    assert.equal(box.name, 'North');
    // The page sets typed back to false when a load finishes.
    box = { ...box, typed: false };
    box.name = m.nameAfterPick(box, 'South');
    assert.equal(box.name, 'South');
});

test('Name box: a name the admin typed is kept when they pick (or change) the file', () => {
    assert.equal(m.nameAfterPick({ name: 'Statewide points', typed: true, replacing: false }, 'export_0412'), 'Statewide points');
    // A typed name they then cleared is not a name: the file's name goes in.
    assert.equal(m.nameAfterPick({ name: '   ', typed: true, replacing: false }, 'export_0412'), 'export_0412');
});

test('Name box: picking a different file before uploading follows the new file', () => {
    assert.equal(m.nameAfterPick({ name: 'North', typed: false, replacing: false }, 'South'), 'South');
});

test('Name box: Replace file never changes the source\'s name', () => {
    assert.equal(m.nameAfterPick({ name: 'North', typed: false, replacing: true }, 'north_2026_11'), 'North');
});

test('rename: a usable new name passes; blank, unchanged or too long is refused in plain words', () => {
    assert.equal(m.renameProblem('North region', 'North'), '');
    assert.equal(m.renameProblem('  North region  ', 'North'), '');
    assert.equal(m.renameProblem('', 'North'), 'Type a name');
    assert.equal(m.renameProblem('   ', 'North'), 'Type a name');
    assert.equal(m.renameProblem('North', 'North'), 'That is already its name');
    assert.equal(m.renameProblem(' North ', 'North'), 'That is already its name');
    assert.match(m.renameProblem('x'.repeat(m.NAME_MAX + 1), 'North'), /at most 120/);
    assert.equal(m.renameProblem('x'.repeat(m.NAME_MAX), 'North'), '');
});

test('rename: not while data is being loaded into that source', () => {
    assert.equal(m.canRename({ id: 'a', status: 'ok' }, []), true);
    assert.equal(m.canRename({ id: 'a', status: 'failed' }, []), true);
    assert.equal(m.canRename({ id: 'a', status: 'loading' }, []), false);
    assert.equal(m.canRename({ id: 'a', status: 'ok' }, ['a']), false, 'a web source pulling a fresh copy');
    assert.equal(m.canRename({ id: 'a', status: 'ok' }, ['b']), true);
});

test('short list: starts short from 4 sources (the reporter has 9), full below that', () => {
    assert.equal(m.startCompact(0), false);
    assert.equal(m.startCompact(3), false);
    assert.equal(m.startCompact(4), true);
    assert.equal(m.startCompact(9), true);
});

test('short list: a source whose last load failed or left a message shows its details', () => {
    assert.equal(m.needsAttention({ status: 'ok', last_error: null }), false);
    assert.equal(m.needsAttention({ status: 'failed', last_error: 'bad file' }), true);
    assert.equal(m.needsAttention({ status: 'ok', last_error: 'Upload cancelled' }), true);
    assert.equal(m.needsAttention({ status: 'loading', last_error: null }), false);
});

test('page wiring: the Name box follows the file, typing marks it, a finished load resets it', () => {
    assert.doesNotMatch(vue, /if \(!add\.name\) add\.name = /, 'the old "only when empty" rule is gone');
    assert.match(vue, /add\.name = nameAfterPick\(\{ name: add\.name, typed: add\.nameTyped, replacing: !!add\.replace \}, fileBaseName\(f\.name\)\)/);
    assert.match(vue, /@input='add\.nameTyped = add\.name\.trim\(\) !== ""'/);
    // After the load succeeds (before the catch), typed goes back to false and the picker empties.
    const load = vue.slice(vue.indexOf('async function load()'), vue.indexOf('} catch (e) {', vue.indexOf('async function load()')));
    assert.match(load, /add\.nameTyped = false;/);
    assert.match(load, /add\.fileKey\+\+;/);
    assert.match(vue, /:key='add\.fileKey'\s+type='file'/);
});

test('page wiring: Rename sends only the new name, and the list has its fold and short view', () => {
    assert.match(vue, /await patchAddressSource\(s\.id, \{ name: rename\.name\.trim\(\) \}\)/);
    assert.match(vue, /data-test='addr-rename'/);
    assert.match(vue, /!canRename\(s, refreshing\)/);
    assert.match(vue, /data-test='addr-fold'/);
    assert.match(vue, /data-test='addr-compact'/);
    assert.match(vue, /if \(!compactChosen\) compact\.value = startCompact\(r\.sources\.length\);/);
});
