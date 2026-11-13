// Proof tests for adding a note: the server adds the one note to the notes the incident has NOW, so a
// browser with an older copy of the list cannot drop a note written in between.
// Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The logic sits between `// <notes-pure>` markers in server/plugin-dispatcher.ts. This test cuts that
// block out of the real file and runs it, so it tests the code that ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <notes-pure>'), src.indexOf('// </notes-pure>'));
assert.ok(block.includes('function withAddedNote'), 'could not find the notes logic in the server file');

const dir = mkdtempSync(join(tmpdir(), 'notes-'));
const file = join(dir, 'notes.ts');
writeFileSync(file, `${block}\nexport { withAddedNote };\n`);
const m = await import(pathToFileURL(file).href);

const NOW = '2026-01-02T03:04:05.000Z';

test('the note goes after the notes the incident already has, with the server time', () => {
    const current = [{ text: 'first', time: 't1' }, { text: 'E6 on scene', time: 't2' }];
    assert.deepEqual(m.withAddedNote(current, '  caller called back  ', NOW),
        [...current, { text: 'caller called back', time: NOW }]);
    // The list passed in is not changed.
    assert.equal(current.length, 2);
});

test('no note, a blank one, or something that is not text adds nothing', () => {
    const current = [{ text: 'first', time: 't1' }];
    for (const v of [undefined, null, '', '   ', 42, {}]) assert.equal(m.withAddedNote(current, v, NOW), current);
});

test('the incident PATCH adds the note to the row it has locked, not to a list from the browser', () => {
    assert.match(src, /note_add: Type\.Optional\(Type\.String\(\)\)/);
    assert.match(src, /notes: withAddedNote\(b\.notes \?\? asArray\(cur\.notes\), b\.note_add, now\),/);
});
