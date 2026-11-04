// Proof tests for the callers list on the server (ops #403). Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The pure list logic sits between `// <callers-pure>` markers in server/plugin-dispatcher.ts. This test
// cuts that block (and asArray) out of the real file, stubs the three things it needs (Err, randomUUID,
// asArray's home) and runs it, so it tests the code that ships, not a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <callers-pure>'), src.indexOf('// </callers-pure>'));
const asArray = src.slice(src.indexOf('function asArray'), src.indexOf('\n}\n', src.indexOf('function asArray')) + 3);
assert.ok(block.includes('function addCallerTo') && asArray.includes('Array.isArray'), 'could not find the callers block in the server file');

const dir = mkdtempSync(join(tmpdir(), 'callers-'));
const file = join(dir, 'callers.ts');
writeFileSync(file, `
import { randomUUID } from 'node:crypto';
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${asArray}
${block}
export { normalizeCallers, addCallerTo, updateCallerIn, removeCallerFrom, firstCaller, CALLERS_MAX };
`);
const m = await import(pathToFileURL(file).href);

type C = { id: string; name: string | null; phone: string | null; note: string | null; time: string; primary: boolean };
const primaries = (l: C[]) => l.filter(c => c.primary);
const refuses = (fn: () => unknown, status: number, re?: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === status && (!re || re.test(e.message ?? '')));

test('the first caller added is the primary; a later one is not', () => {
    let l: C[] = m.addCallerTo([], { name: 'Jane', phone: '555-0123' });
    l = m.addCallerTo(l, { name: 'Bob', phone: '555-0199' });
    assert.equal(l.length, 2);
    assert.deepEqual(l.map(c => c.primary), [true, false]);
});

test('adding a caller as primary demotes the old primary: exactly one primary', () => {
    let l: C[] = m.addCallerTo([], { name: 'Jane' });
    l = m.addCallerTo(l, { name: 'Bob', primary: true });
    assert.equal(primaries(l).length, 1);
    assert.equal(primaries(l)[0].name, 'Bob');
});

test('make primary on another caller moves it, never leaves two or none', () => {
    let l: C[] = m.addCallerTo([], { name: 'Jane' });
    l = m.addCallerTo(l, { name: 'Bob' });
    l = m.addCallerTo(l, { name: 'Cy' });
    l = m.updateCallerIn(l, l[2].id, { primary: true });
    assert.deepEqual(l.map(c => c.primary), [false, false, true]);
});

test('removing the primary promotes the first caller left; removing the last leaves an empty list', () => {
    let l: C[] = m.addCallerTo([], { name: 'Jane' });
    l = m.addCallerTo(l, { name: 'Bob' });
    l = m.normalizeCallers(m.removeCallerFrom(l, l[0].id));
    assert.equal(l.length, 1);
    assert.equal(l[0].name, 'Bob');
    assert.equal(l[0].primary, true);
    assert.deepEqual(m.normalizeCallers(m.removeCallerFrom(l, l[0].id)), []);
});

test('a caller needs a name or a phone; clearing the last of both is refused', () => {
    refuses(() => m.addCallerTo([], {}), 400, /name or phone/);
    refuses(() => m.addCallerTo([], { name: '  ', phone: '', note: 'only a note' }), 400);
    const l: C[] = m.addCallerTo([], { name: 'Jane', phone: '555' });
    const n1 = m.updateCallerIn(l, l[0].id, { name: '' });
    assert.equal(n1[0].name, null);
    assert.equal(n1[0].phone, '555');
    refuses(() => m.updateCallerIn(n1, n1[0].id, { phone: '' }), 400);
});

test('edit: undefined leaves a field, empty string clears it', () => {
    const l: C[] = m.addCallerTo([], { name: 'Jane', phone: '555', note: 'saw the crash' });
    const e = m.updateCallerIn(l, l[0].id, { note: '' });
    assert.equal(e[0].note, null);
    assert.equal(e[0].name, 'Jane');
    assert.equal(e[0].phone, '555');
});

test('unknown caller is a 404; limits are enforced with a 400', () => {
    refuses(() => m.updateCallerIn([], 'nope', { name: 'x' }), 404);
    refuses(() => m.removeCallerFrom([], 'nope'), 404);
    refuses(() => m.addCallerTo([], { name: 'x'.repeat(121) }), 400, /too long/);
    refuses(() => m.addCallerTo([], { name: 'x', phone: '5'.repeat(41) }), 400, /too long/);
    refuses(() => m.addCallerTo([], { name: 'x', note: 'n'.repeat(201) }), 400, /too long/);
    let l: C[] = [];
    for (let i = 0; i < m.CALLERS_MAX; i++) l = m.addCallerTo(l, { name: `c${i}` });
    refuses(() => m.addCallerTo(l, { name: 'one too many' }), 400, /at most/);
});

test('each caller carries the time of the call: given, or now', () => {
    const when = '2026-11-02T07:15:00.000Z';
    const l: C[] = m.addCallerTo([], { name: 'Jane', time: when });
    assert.equal(l[0].time, when);
    const now = Date.now();
    const l2: C[] = m.addCallerTo([], { name: 'Bob' });
    assert.ok(Math.abs(new Date(l2[0].time).getTime() - now) < 5000);
    refuses(() => m.addCallerTo([], { name: 'x', time: 'not a date' }), 400, /valid date/);
});

test('callers come back in the order the calls were received, whatever order they were added', () => {
    let l: C[] = m.addCallerTo([], { name: 'late', time: '2026-11-02T09:00:00.000Z' });
    l = m.addCallerTo(l, { name: 'early', time: '2026-11-02T07:00:00.000Z' });
    l = m.normalizeCallers(l);
    assert.deepEqual(l.map(c => c.name), ['early', 'late']);
    assert.equal(primaries(l).length, 1);
});

test('normalizeCallers repairs a stored list: junk dropped, one primary, string-encoded jsonb unwrapped', () => {
    assert.deepEqual(m.normalizeCallers(null), []);
    assert.deepEqual(m.normalizeCallers('not json'), []);
    const raw = JSON.stringify([
        { id: 'a', name: 'A', primary: false, time: '2026-11-02T07:00:00.000Z' },
        { id: 'b', name: 'B', primary: true, time: '2026-11-02T08:00:00.000Z' },
        { id: 'c', name: 'C', primary: true, time: '2026-11-02T09:00:00.000Z' },
        'junk', null,
    ]);
    const l: C[] = m.normalizeCallers(raw);
    assert.equal(l.length, 3);
    assert.equal(primaries(l).length, 1);
    assert.equal(primaries(l)[0].id, 'b');
    assert.equal(m.normalizeCallers([{ id: 'x', name: 'X' }])[0].primary, true);
});

test('the New Incident form and the old caller_name / caller_phone fields make one primary caller', () => {
    assert.deepEqual(m.firstCaller(undefined, undefined), []);
    assert.deepEqual(m.firstCaller('  ', ''), []);
    const l: C[] = m.firstCaller('Pat', '555-010-2000');
    assert.equal(l.length, 1);
    assert.equal(l[0].primary, true);
    assert.equal(l[0].phone, '555-010-2000');
});

// Source checks for the parts that need a database (run for real on a Postgres engine and on the box):
test('only the caller routes write the callers column; the incident PATCH leaves it alone', () => {
    const writes = src.match(/\bcallers\s*=\s*\$\{/g) ?? [];  // the one-time upgrade assigns from SQL, not from a value
    assert.equal(writes.length, 1, 'callers is written in one place: editCallers, under a row lock');
    assert.match(src, /SELECT callers FROM dispatcher_incidents WHERE id = \$\{incidentid\} FOR UPDATE/);
    const patch = src.slice(src.indexOf("name: 'Update Incident'"), src.indexOf("name: 'Add Caller'"));
    assert.ok(patch.length > 500 && !/callers\s*=/.test(patch), 'the incident PATCH must not write callers');
});

test('the upgrade moves the old single caller into the list once and empties the old columns', () => {
    assert.match(src, /ADD COLUMN IF NOT EXISTS callers JSONB NOT NULL DEFAULT '\[\]'/);
    assert.match(src, /WHERE callers = '\[\]'::jsonb AND \(caller_name IS NOT NULL OR caller_phone IS NOT NULL\)/);
    assert.match(src, /caller_name = NULL, caller_phone = NULL/);
    assert.doesNotMatch(src, /ADD COLUMN IF NOT EXISTS caller_name/, 'a fresh install must not create the old columns');
});
