// Proof tests for employee numbers on the server (admin switch `operator_numbers`, default off): the number
// of whoever is at the keyboard, stamped as who created the incident, who took each call (`taken_by` on the
// caller), the initial dispatcher (first unit assignment), who closed it, and `by` on every note. With the
// switch off nothing is read or stamped.
// Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The pure logic sits between `// <operator-pure>` markers in server/plugin-dispatcher.ts (and the callers
// list between `// <callers-pure>`). This test cuts those blocks out of the real file, stubs Err, and runs
// them, so it tests the code that ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <operator-pure>'), src.indexOf('// </operator-pure>'));
const callers = src.slice(src.indexOf('// <callers-pure>'), src.indexOf('// </callers-pure>'));
const asArray = src.slice(src.indexOf('function asArray'), src.indexOf('\n}\n', src.indexOf('function asArray')) + 3);
assert.ok(block.includes('function normOperator') && block.includes('function closedByAfter'), 'could not find the operator block in the server file');
assert.ok(callers.includes('function addCallerTo') && asArray.includes('Array.isArray'), 'could not find the callers block in the server file');

const dir = mkdtempSync(join(tmpdir(), 'operator-'));
const file = join(dir, 'operator.ts');
writeFileSync(file, `
import { randomUUID } from 'node:crypto';
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${asArray}
${block}
${callers}
export { normOperator, withBy, stampNewNotes, dispatcherAfterAssign, closedByAfter, operatorNumbersOn, normOperatorSetting, requestOperator, OPERATOR_MAX, OPERATOR_SETTING };
export { addCallerTo, updateCallerIn, firstCaller, normalizeCallers };
`);
const m = await import(pathToFileURL(file).href);

const T1 = '2026-11-03T14:01:40.000Z', T2 = '2026-11-03T14:03:10.000Z';
const refuses = (fn: () => unknown, re: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === 400 && re.test(e.message ?? ''));

test('an employee number is digits only, trimmed; absent or empty means none', () => {
    assert.equal(m.normOperator('4471'), '4471');
    assert.equal(m.normOperator('  0042 '), '0042');
    assert.equal(m.normOperator(undefined), null);
    assert.equal(m.normOperator(null), null);
    assert.equal(m.normOperator(''), null);
    assert.equal(m.normOperator('   '), null);
});

test('anything but digits is refused with a plain 400, so a typo never lands on the record', () => {
    refuses(() => m.normOperator('44a1'), /digits only/);
    refuses(() => m.normOperator('-4471'), /digits only/);
    refuses(() => m.normOperator('44 71'), /digits only/);
    refuses(() => m.normOperator(4471), /digits only/);
    assert.equal(m.OPERATOR_MAX, 16);
    assert.equal(m.normOperator('1'.repeat(16)), '1'.repeat(16));
    refuses(() => m.normOperator('1'.repeat(17)), /too long/);
});

test('server-written notes carry the operator; without one they stay as they were', () => {
    const notes = [{ text: 'E12 assigned', time: T1 }, { text: 'M4 assigned', time: T1 }];
    assert.deepEqual(m.withBy(notes, '2308'), [
        { text: 'E12 assigned', time: T1, by: '2308' },
        { text: 'M4 assigned', time: T1, by: '2308' },
    ]);
    assert.deepEqual(m.withBy(notes, null), notes);
    assert.deepEqual(m.withBy([], '2308'), []);
});

test('a PATCH stamps only the notes it added; notes already on the incident keep who wrote them', () => {
    const before = [{ text: 'Chest pain', time: T1, by: '4471' }, { text: 'E12 assigned', time: T1 }];
    const sent = [...before, { text: 'Caller called back', time: T2 }];
    assert.deepEqual(m.stampNewNotes(before.length, sent, '2308'), [
        { text: 'Chest pain', time: T1, by: '4471' },
        { text: 'E12 assigned', time: T1 },
        { text: 'Caller called back', time: T2, by: '2308' },
    ]);
});

test('a browser cannot sign a new note with someone else\'s number', () => {
    const sent = [{ text: 'Note', time: T2, by: '9999' }];
    assert.deepEqual(m.stampNewNotes(0, sent, '2308'), [{ text: 'Note', time: T2, by: '2308' }]);
    assert.deepEqual(m.stampNewNotes(0, sent, null), [{ text: 'Note', time: T2 }]);
});

test('the switch is on only for true, also when the database hands it back as JSON text', () => {
    assert.equal(m.OPERATOR_SETTING, 'operator_numbers');
    assert.equal(m.operatorNumbersOn(true), true);
    // A raw read of the jsonb column returns text, sometimes double-encoded; the live test found this.
    assert.equal(m.operatorNumbersOn('true'), true);
    assert.equal(m.operatorNumbersOn(JSON.stringify('true')), true);
    for (const v of [undefined, null, false, 'false', JSON.stringify('false'), 'yes', '', 1, '1', {}]) {
        assert.equal(m.operatorNumbersOn(v), false, String(v));
    }
    assert.equal(m.normOperatorSetting(true), true);
    assert.equal(m.normOperatorSetting(false), false);
    refuses(() => m.normOperatorSetting('on'), /true or false/);
});

test('with the switch off a number in the request is ignored, even a bad one', () => {
    assert.equal(m.requestOperator(false, '4471'), null);
    assert.equal(m.requestOperator(false, 'not a number'), null);
    assert.equal(m.requestOperator(true, '4471'), '4471');
    refuses(() => m.requestOperator(true, '44a1'), /digits only/);
});

test('who closed it: set by the request that closes it, cleared on reopen, kept through other edits', () => {
    assert.equal(m.closedByAfter(null, true, false, '3333'), '3333', 'closing records the closer');
    assert.equal(m.closedByAfter('3333', false, false, '5150'), '3333', 'a note or report number on a closed incident keeps it');
    assert.equal(m.closedByAfter('3333', false, true, '5150'), null, 'reopening clears it, like the disposition');
    assert.equal(m.closedByAfter(null, true, false, null), null, 'closed with no number entered: empty');
});

test('each caller records who took the call, once; an edit never changes it', () => {
    const first = m.firstCaller('Caller One', '555-0100', '1111');
    assert.equal(first[0].taken_by, '1111');
    const two = m.addCallerTo(first, { name: 'Caller Two' }, '2222');
    assert.deepEqual(two.map((c: { taken_by?: string }) => c.taken_by), ['1111', '2222']);
    const edited = m.updateCallerIn(two, two[1].id, { name: 'Caller Two B', primary: true });
    assert.equal(edited[1].taken_by, '2222', 'editing or making primary keeps who took it');
    assert.equal(edited[1].name, 'Caller Two B');
});

test('a caller added with no number has no taken_by, so older callers and switch-off look as before', () => {
    const c = m.addCallerTo([], { name: 'Caller' });
    assert.ok(!('taken_by' in c[0]));
    assert.ok(!('taken_by' in m.firstCaller('Caller', undefined)[0]));
    // A stored list keeps a valid number and drops anything else.
    const stored = m.normalizeCallers([
        { id: 'a', name: 'A', time: '2026-11-03T14:00:00.000Z', taken_by: '1111' },
        { id: 'b', name: 'B', time: '2026-11-03T14:01:00.000Z', taken_by: 'x1' },
    ]);
    assert.equal(stored[0].taken_by, '1111');
    assert.ok(!('taken_by' in stored[1]));
});

test('the dispatcher number is set once, by the first assignment that added a unit with an operator set', () => {
    assert.equal(m.dispatcherAfterAssign(null, 1, '2308'), '2308');
    assert.equal(m.dispatcherAfterAssign('2308', 2, '5150'), '2308', 'a later assignment by someone else does not move it');
    assert.equal(m.dispatcherAfterAssign(null, 0, '2308'), null, 'assigning a unit already on the incident adds nothing');
    assert.equal(m.dispatcherAfterAssign(null, 1, null), null, 'no operator: stays empty, the next one with a number sets it');
});

test('the route file wires it in behind the switch and leaves the dispatcher field as it was', () => {
    for (const col of ['created_by_no', 'initial_dispatcher_no', 'closed_by_no']) {
        assert.match(src, new RegExp(`ADD COLUMN IF NOT EXISTS ${col} TEXT`));
    }
    // The old dispatcher field: still the browser's value at create, still patchable, never an employee number.
    assert.match(src, /\$\{req\.body\.dispatcher \?\? null\}, \$\{operator\}, \$\{req\.body\.details/);
    assert.match(src, /dispatcher: b\.dispatcher \?\? cur\.dispatcher,/);
    assert.doesNotMatch(src, /SET[^`]*\bdispatcher = \$\{initialDispatcherNo\}/);
    // Every write reads the switch; with it off the operator is null and nothing is stamped.
    assert.equal((src.match(/requestOperator\((await operatorNumbersEnabled\(config\)|numbersOn), req\.body\.operator\)/g) ?? []).length, 5, 'create, patch, assign, unit status, add caller');
    assert.match(src, /if \(numbersOn\) next\.notes = stampNewNotes\(asArray\(cur\.notes\)\.length, next\.notes, operator\);/);
    assert.match(src, /assignUnitsTo\(list, req\.body\.units, now\), operator, numbersOn\)/);
    assert.match(src, /SELECT assigned, notes, status, initial_dispatcher_no FROM dispatcher_incidents WHERE id = \$\{incidentid\} FOR UPDATE/);
    // Only a system admin may flip the switch.
    assert.match(src, /isAdminOnlySetting\(req\.params\.key\) \|\| req\.params\.key === OPERATOR_SETTING/);
    // Callers: the form's first caller and every added caller take the request's number.
    assert.match(src, /firstCaller\(req\.body\.caller_name, req\.body\.caller_phone, operator\)/);
    assert.match(src, /const takenBy = requestOperator\(await operatorNumbersEnabled\(config\), req\.body\.operator\);/);
    assert.match(src, /addCallerTo\(list, req\.body, takenBy\)/);
    // Closing: stored in the same UPDATE as the disposition.
    assert.match(src, /closed_by_no = \$\{closedByNo\}/);
    const lists = src.match(/closed_at, disposition, disposition_note(, created_by_no, initial_dispatcher_no, closed_by_no)?\n/g) ?? [];
    assert.ok(lists.length >= 6 && lists.every(l => l.includes('closed_by_no')), 'every SELECT / RETURNING list returns all three numbers');
});
