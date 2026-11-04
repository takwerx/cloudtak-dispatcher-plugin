// Proof tests for the disposition on the server. Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The pure logic sits between `// <disposition-pure>` markers in server/plugin-dispatcher.ts. This test
// cuts that block out of the real file, stubs Err and runs it, so it tests the code that ships, not a
// copy. Same shape as units-server.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <disposition-pure>'), src.indexOf('// </disposition-pure>'));
assert.ok(block.includes('function normDisposition'), 'could not find the disposition block in the server file');

const dir = mkdtempSync(join(tmpdir(), 'disposition-'));
const file = join(dir, 'disposition.ts');
writeFileSync(file, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${block}
export { normDisposition, closeNote, DISPOSITION_MAX, DISPOSITION_NOTE_MAX, DISPOSITION_OTHER };
`);
const m = await import(pathToFileURL(file).href);

const refuses = (fn: () => unknown, status: number, re?: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === status && (!re || re.test(e.message ?? '')));

test('a preset is stored as sent, trimmed, with no note', () => {
    assert.deepEqual(m.normDisposition('Unfounded', undefined), { disposition: 'Unfounded', disposition_note: null });
    assert.deepEqual(m.normDisposition('  Gone on Arrival ', ''), { disposition: 'Gone on Arrival', disposition_note: null });
});

test('closing without a disposition is refused with a plain message', () => {
    refuses(() => m.normDisposition(undefined, undefined), 400, /Pick a disposition/);
    refuses(() => m.normDisposition('   ', undefined), 400, /Pick a disposition/);
});

test('a note only goes with Other: on a preset it is dropped', () => {
    assert.deepEqual(m.normDisposition('Canceled', 'by caller'), { disposition: 'Canceled', disposition_note: null });
});

test('Other needs a few words, trimmed and kept', () => {
    assert.deepEqual(m.normDisposition('Other', '  lost contact with caller '), { disposition: 'Other', disposition_note: 'lost contact with caller' });
    refuses(() => m.normDisposition('Other', undefined), 400, /Other/);
    refuses(() => m.normDisposition('Other', '   '), 400, /Other/);
    assert.equal(m.DISPOSITION_OTHER, 'Other');
});

test('the caps: disposition 40, note 80', () => {
    assert.equal(m.DISPOSITION_MAX, 40);
    assert.equal(m.DISPOSITION_NOTE_MAX, 80);
    assert.equal(m.normDisposition('x'.repeat(40), undefined).disposition.length, 40);
    refuses(() => m.normDisposition('x'.repeat(41), undefined), 400, /too long/);
    assert.equal(m.normDisposition('Other', 'y'.repeat(80)).disposition_note.length, 80);
    refuses(() => m.normDisposition('Other', 'y'.repeat(81)), 400, /too long/);
});

test('the note written at close', () => {
    assert.equal(m.closeNote('Unfounded', null), 'Closed: Unfounded');
    assert.equal(m.closeNote('Other', 'lost contact with caller'), 'Closed: Other — lost contact with caller');
});

test('the incident PATCH reads the disposition only when the incident goes active → closed, and clears it on reopen', () => {
    // The route body is not runnable without CloudTAK; check the shape of the code that ships.
    const route = src.slice(src.indexOf("schema.patch('/dispatcher/incidents/:incidentid'"), src.indexOf('// ── Callers ─', src.indexOf("schema.patch('/dispatcher/incidents/:incidentid'")));
    assert.match(route, /const closing = next\.status === 'closed' && cur\.status !== 'closed';/);
    assert.match(route, /if \(closing\) \{\s*const d = normDisposition\(b\.disposition, b\.disposition_note\);/);
    assert.match(route, /\} else if \(next\.status === 'active'\) \{\s*disposition = null;\s*dispositionNote = null;/);
    assert.match(route, /text: closeNote\(disposition, dispositionNote\), time: closedAt/);
    assert.match(route, /disposition = \$\{disposition\},\s*disposition_note = \$\{dispositionNote\}/);
    assert.match(src, /ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS disposition TEXT/);
    assert.match(src, /ALTER TABLE dispatcher_incidents ADD COLUMN IF NOT EXISTS disposition_note TEXT/);
});
