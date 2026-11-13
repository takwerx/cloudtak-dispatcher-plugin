// Proof tests for a change of an incident's location on the server. Plain node, no CloudTAK and no
// database:
//   node --test plugin/test/*.test.ts
// The pure logic sits between `// <location-pure>` markers in server/plugin-dispatcher.ts. This test
// cuts that block out of the real file and runs it, so it tests the code that ships, not a copy.
// Same shape as disposition-server.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <location-pure>'), src.indexOf('// </location-pure>'));
assert.ok(block.includes('function locationNote'), 'could not find the location block in the server file');

const dir = mkdtempSync(join(tmpdir(), 'location-'));
const file = join(dir, 'location.ts');
writeFileSync(file, `${block}\nexport { placeText, locationNote };\n`);
const m = await import(pathToFileURL(file).href);

const main = { address: '100 MAIN ST, Springfield, OR', lat: 44.5, lon: -123.2 };
const oak = { address: '400 OAK AVE #4, Springfield, OR', lat: 44.5012, lon: -123.2034 };

test('a move is one note with where it was and where it is now', () => {
    assert.equal(m.locationNote(main, oak),
        'Location changed: 100 MAIN ST, Springfield, OR (44.500000, -123.200000) → 400 OAK AVE #4, Springfield, OR (44.501200, -123.203400)');
});

test('nothing changed: no note', () => {
    assert.equal(m.locationNote(main, { ...main }), null);
    assert.equal(m.locationNote(main, { ...main, address: ' 100 MAIN ST, Springfield, OR ' }), null, 'spaces at the ends are not a change');
    assert.equal(m.locationNote(main, { ...main, lat: 44.50000001 }), null, 'the same point to six decimals');
    assert.equal(m.locationNote({ address: null, lat: null, lon: null }, { address: '', lat: null, lon: null }), null);
});

test('only the point moved, or only the address was corrected: still a note', () => {
    assert.equal(m.locationNote(main, { ...main, lat: 44.5003 }),
        'Location changed: 100 MAIN ST, Springfield, OR (44.500000, -123.200000) → 100 MAIN ST, Springfield, OR (44.500300, -123.200000)');
    assert.match(m.locationNote(main, { ...main, address: '100 MAIN ST #2, Springfield, OR' }), /→ 100 MAIN ST #2, Springfield, OR \(44\.500000, -123\.200000\)$/);
});

test('placeText: the address, the point, or both, never blank', () => {
    assert.equal(m.placeText({ address: '', lat: 44.5, lon: -123.2 }), '44.500000, -123.200000');
    assert.equal(m.placeText({ address: '100 MAIN ST', lat: null, lon: null }), '100 MAIN ST');
    assert.equal(m.placeText({ address: null, lat: null, lon: null }), 'no location');
    assert.equal(m.placeText({ address: 'Mile 12', lat: 0, lon: 0 }), 'Mile 12 (0.000000, 0.000000)', 'zero is a coordinate');
});

test('the update route writes the note from the row as it was and as it will be', () => {
    assert.match(src, /const moved = locationNote\(cur, next\);\s+if \(moved\) next\.notes = \[\.\.\.next\.notes, \{ text: moved, time: now \}\];/);
    // Before the notes are stamped with who did it, so the move carries the employee number too.
    assert.ok(src.indexOf('const moved = locationNote(cur, next);') < src.indexOf('next.notes = stampNewNotes('));
});
