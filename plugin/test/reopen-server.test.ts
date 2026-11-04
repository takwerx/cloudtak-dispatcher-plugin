// Proof tests for reopening a closed incident: a reason is required and goes on the record as a note.
// Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The logic sits between `// <disposition-pure>` markers in server/plugin-dispatcher.ts. This test cuts that
// block out of the real file, stubs Err, and runs it, so it tests the code that ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REOPEN_REASON_MAX as CLIENT_MAX } from '../lib/dispositions.ts';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <disposition-pure>'), src.indexOf('// </disposition-pure>'));
assert.ok(block.includes('function normReopenReason') && block.includes('function reopenNote'), 'could not find the reopen logic in the server file');

const dir = mkdtempSync(join(tmpdir(), 'reopen-'));
const file = join(dir, 'reopen.ts');
writeFileSync(file, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${block}
export { normReopenReason, reopenNote, REOPEN_REASON_MAX };
`);
const m = await import(pathToFileURL(file).href);
const refuses = (fn: () => unknown, re: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === 400 && re.test(e.message ?? ''));

test('a reopen needs a reason; blank or missing is refused with a plain message', () => {
    for (const v of [undefined, null, '', '   ', 42]) refuses(() => m.normReopenReason(v), /Enter a reason to reopen/);
});

test('the reason is trimmed, capped, and written as "Reopened: …"', () => {
    assert.equal(m.normReopenReason('  caller called back  '), 'caller called back');
    assert.equal(m.REOPEN_REASON_MAX, 120);
    assert.equal(CLIENT_MAX, m.REOPEN_REASON_MAX, 'the box in the plugin allows what the server accepts');
    assert.equal(m.normReopenReason('x'.repeat(120)).length, 120);
    refuses(() => m.normReopenReason('x'.repeat(121)), /too long/);
    assert.equal(m.reopenNote('caller called back'), 'Reopened: caller called back');
});

test('the route reads the reason only on closed → active, writes the note before the notes are stamped', () => {
    const at = src.indexOf("if (next.status === 'active' && cur.status === 'closed') {");
    const stamp = src.indexOf('if (numbersOn) next.notes = stampNewNotes(');
    assert.ok(at > 0, 'the reopen branch is in the PATCH route');
    assert.match(src.slice(at, at + 200), /reopenNote\(normReopenReason\(b\.reopen_reason\)\)/);
    assert.ok(stamp > at, 'the Reopened note is added before the employee-number stamp, so it says who');
    assert.match(src, /reopen_reason: Type\.Optional\(Type\.String\(\)\)/);
});
