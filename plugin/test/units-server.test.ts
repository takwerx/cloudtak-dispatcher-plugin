// Proof tests for unit status on the server (ops #450): Assigned -> On Scene -> Cleared with server times.
// Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The pure list logic sits between `// <units-pure>` markers in server/plugin-dispatcher.ts. This test cuts
// that block (and asArray) out of the real file, stubs Err, and runs it, so it tests the code that ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <units-pure>'), src.indexOf('// </units-pure>'));
const asArray = src.slice(src.indexOf('function asArray'), src.indexOf('\n}\n', src.indexOf('function asArray')) + 3);
assert.ok(block.includes('function advanceUnit') && asArray.includes('Array.isArray'), 'could not find the units block in the server file');

const dir = mkdtempSync(join(tmpdir(), 'units-'));
const file = join(dir, 'units.ts');
writeFileSync(file, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${asArray}
${block}
export { normalizeUnits, assignUnitsTo, advanceUnit, removeUnitFrom, clearAllUnits, mergeAssignedFrom, addedUnits, heldElsewhere, shortNumber, busyRefusal, UNITS_MAX };
`);
const m = await import(pathToFileURL(file).href);

type U = { uid: string; callsign: string; status: string; assigned_at: string | null; on_scene_at: string | null; cleared_at: string | null };
const T1 = '2026-11-02T17:15:00.000Z', T2 = '2026-11-02T17:22:00.000Z', T3 = '2026-11-02T17:39:00.000Z', T4 = '2026-11-02T18:05:00.000Z';
const refuses = (fn: () => unknown, status: number, re?: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === status && (!re || re.test(e.message ?? '')));
const assigned = (): U[] => m.assignUnitsTo([], [{ uid: 'u1', callsign: 'E12' }, { uid: 'u2', callsign: 'M4' }], T1).list;

test('a new unit starts Assigned with the server time and no other times', () => {
    const { list, notes } = m.assignUnitsTo([], [{ uid: 'u1', callsign: 'E12' }], T1);
    assert.deepEqual(list, [{ uid: 'u1', callsign: 'E12', status: 'assigned', assigned_at: T1, on_scene_at: null, cleared_at: null }]);
    assert.deepEqual(notes, [{ text: 'E12 assigned', time: T1 }]);
});

test('assigning a unit already on the incident changes nothing and adds no note', () => {
    const once = assigned();
    const again = m.assignUnitsTo(once, [{ uid: 'u1', callsign: 'E12' }], T2);
    assert.deepEqual(again.list, once);
    assert.deepEqual(again.notes, []);
});

test('On Scene stamps the on-scene time and leaves the others; a note says so', () => {
    const { list, notes } = m.advanceUnit(assigned(), 'u1', 'on_scene', T2);
    assert.equal(list[0].status, 'on_scene');
    assert.equal(list[0].assigned_at, T1);
    assert.equal(list[0].on_scene_at, T2);
    assert.equal(list[0].cleared_at, null);
    assert.equal(list[1].status, 'assigned', 'the other unit is untouched');
    assert.deepEqual(notes, [{ text: 'E12 on scene', time: T2 }]);
});

test('Clear stamps the cleared time and keeps the unit on the incident', () => {
    let l: U[] = m.advanceUnit(assigned(), 'u1', 'on_scene', T2).list;
    const out = m.advanceUnit(l, 'u1', 'cleared', T3);
    l = out.list;
    assert.equal(l.length, 2, 'a cleared unit stays in the record');
    assert.deepEqual([l[0].assigned_at, l[0].on_scene_at, l[0].cleared_at], [T1, T2, T3]);
    assert.deepEqual(out.notes, [{ text: 'E12 cleared', time: T3 }]);
});

test('an Assigned unit can be cleared without ever being On Scene (no on-scene time is invented)', () => {
    const l: U[] = m.advanceUnit(assigned(), 'u2', 'cleared', T3).list;
    assert.equal(l[1].status, 'cleared');
    assert.equal(l[1].on_scene_at, null);
});

test('steps only go forward: no On Scene twice, no On Scene after Cleared, no Clear twice', () => {
    const onScene = m.advanceUnit(assigned(), 'u1', 'on_scene', T2).list;
    refuses(() => m.advanceUnit(onScene, 'u1', 'on_scene', T3), 400, /already on scene/);
    const cleared = m.advanceUnit(onScene, 'u1', 'cleared', T3).list;
    refuses(() => m.advanceUnit(cleared, 'u1', 'on_scene', T3), 400, /already cleared/);
    refuses(() => m.advanceUnit(cleared, 'u1', 'cleared', T3), 400, /already cleared/);
});

test('a unit that is not on the incident is a 404', () => {
    refuses(() => m.advanceUnit(assigned(), 'nope', 'on_scene', T2), 404);
    refuses(() => m.removeUnitFrom(assigned(), 'nope'), 404);
});

test('the ✕ takes a unit off the record entirely and writes no note', () => {
    const l: U[] = m.removeUnitFrom(assigned(), 'u1');
    assert.deepEqual(l.map(u => u.uid), ['u2']);
});

test('closing clears every unit still on the incident with the close time, one note each, cleared ones untouched', () => {
    let l: U[] = m.advanceUnit(assigned(), 'u1', 'on_scene', T2).list;
    l = m.advanceUnit(l, 'u2', 'cleared', T2).list;
    l = m.assignUnitsTo(l, [{ uid: 'u3', callsign: 'L1' }], T2).list;
    const out = m.clearAllUnits(l, T3);
    assert.deepEqual(out.list.map((u: U) => [u.callsign, u.status, u.cleared_at]), [['E12', 'cleared', T3], ['M4', 'cleared', T2], ['L1', 'cleared', T3]]);
    assert.deepEqual(out.notes.map((n: { text: string }) => n.text), ['E12 cleared', 'L1 cleared'], 'M4 was already cleared');
    assert.ok(out.notes.every((n: { time: string }) => n.time === T3));
});

test('an old row with only uid and callsign reads as Assigned with no times', () => {
    const l: U[] = m.normalizeUnits([{ uid: 'a', callsign: 'E7' }]);
    assert.deepEqual(l, [{ uid: 'a', callsign: 'E7', status: 'assigned', assigned_at: null, on_scene_at: null, cleared_at: null }]);
    // and it can still move forward
    assert.equal(m.advanceUnit(l, 'a', 'on_scene', T2).list[0].status, 'on_scene');
});

test('a stored list that came back as a JSON string, or has junk in it, is cleaned up', () => {
    const raw = JSON.stringify([{ uid: 'a', callsign: 'E7', status: 'bogus' }, null, 'x', { callsign: 'no uid' }, { uid: 'a', callsign: 'dup' }]);
    const l: U[] = m.normalizeUnits(raw);
    assert.deepEqual(l.map(u => [u.uid, u.status]), [['a', 'assigned']]);
});

test('an older client sending the whole list cannot forge a status or a time', () => {
    const current: U[] = m.advanceUnit(assigned(), 'u1', 'on_scene', T2).list;
    const sent = [
        { uid: 'u1', callsign: 'E12', status: 'cleared', on_scene_at: '2000-01-01T00:00:00.000Z', cleared_at: '2000-01-01T00:00:00.000Z' },
        { uid: 'u9', callsign: 'L9', status: 'on_scene', assigned_at: '2000-01-01T00:00:00.000Z', on_scene_at: '2000-01-01T00:00:00.000Z' },
    ];
    const l: U[] = m.mergeAssignedFrom(current, sent, T3);
    assert.deepEqual(l.map(u => u.uid), ['u1', 'u9'], 'u2 is gone because the client dropped it');
    assert.deepEqual([l[0].status, l[0].on_scene_at, l[0].cleared_at], ['on_scene', T2, null], 'a known unit keeps what the server stamped');
    assert.deepEqual([l[1].status, l[1].assigned_at, l[1].on_scene_at], ['assigned', T3, null], 'a new unit is Assigned now');
});

test('a unit needs a uid and a callsign, and an incident holds a limited number', () => {
    refuses(() => m.assignUnitsTo([], [{ uid: 'u1', callsign: '  ' }], T1), 400);
    refuses(() => m.assignUnitsTo([], [{ uid: '', callsign: 'E1' }], T1), 400);
    refuses(() => m.assignUnitsTo([], [{ uid: 'u1', callsign: 'x'.repeat(65) }], T1), 400, /too long/);
    const full = m.assignUnitsTo([], Array.from({ length: m.UNITS_MAX }, (_, i) => ({ uid: `u${i}`, callsign: `C${i}` })), T1).list;
    refuses(() => m.assignUnitsTo(full, [{ uid: 'extra', callsign: 'X' }], T1), 400, /at most/);
});

// One incident per unit. The database half (the Event lock and the query for units still working
// another incident) needs Postgres; these cover what decides and words the refusal.
test('only the units a request adds are checked against other incidents', () => {
    const before = assigned();
    const after = m.assignUnitsTo(before, [{ uid: 'u1', callsign: 'E12' }, { uid: 'u3', callsign: 'L1' }], T2).list;
    assert.deepEqual(m.addedUnits(before, after), ['u3'], 'u1 was already here');
    assert.deepEqual(m.addedUnits(before, before), []);
    assert.deepEqual(m.addedUnits(before, m.mergeAssignedFrom(before, [{ uid: 'u2', callsign: 'M4' }, { uid: 'u7', callsign: 'E7' }], T2)), ['u7'], 'an older client\'s whole list');
});

test('the refusal names the incident by its number without the Event prefix', () => {
    assert.equal(m.shortNumber('26-014'), '014');
    assert.equal(m.shortNumber('AB-26-1002'), '1002');
    assert.equal(m.shortNumber('014'), '014', 'no prefix: the number as it is');
    assert.equal(m.busyRefusal([], 1), null, 'nothing busy: no refusal');
    assert.equal(m.busyRefusal([{ callsign: 'E12', number: '26-014' }], 1), 'E12 is on 014. Clear it there first.');
    assert.equal(
        m.busyRefusal([{ callsign: 'E12', number: '26-014' }, { callsign: 'M4', number: '26-011' }, { callsign: 'E12', number: '26-014' }], 2),
        'E12 is on 014, M4 is on 011. Clear them there first. Nothing was assigned.',
    );
    // A free unit picked beside a busy one was not assigned either: the message says so.
    assert.equal(m.busyRefusal([{ callsign: 'E12', number: '26-014' }], 2), 'E12 is on 014. Clear it there first. Nothing was assigned.');
});

test('the route file takes the Event lock before the incident row on both paths that can add a unit', () => {
    const editUnits = src.slice(src.indexOf('async function editUnits'), src.indexOf('// ── Feed-driven visibility'));
    assert.ok(editUnits.indexOf('if (checkBusy) await lockEventOf(tx, incidentid);') < editUnits.indexOf('FOR UPDATE'), 'assign route: Event first');
    assert.match(editUnits, /if \(checkBusy\) await refuseBusyUnits\(tx, incidentid, addedUnits\(before, out\.list\)\);/);
    assert.match(src, /assignUnitsTo\(list, req\.body\.units, now\),\s+\{ operator, stampDispatcher: numbersOn, checkBusy: true \}\)/, 'the assign route asks for the check');
    assert.equal((src.match(/checkBusy: true/g) ?? []).length, 1, 'only the assign route');
    const from = src.indexOf("description: 'Update an incident (assign / note / close / reopen)'");
    const patch = src.slice(from, src.indexOf('// ── Units', from));
    assert.ok(patch.indexOf('if (req.body.assigned !== undefined) await lockEventOf(tx, req.params.incidentid);') < patch.indexOf('FOR UPDATE'), 'older whole-list path: Event first');
    assert.match(patch, /await refuseBusyUnits\(tx, req\.params\.incidentid, addedUnits\(normalizeUnits\(cur\.assigned\), next\.assigned\)\);/);
    // The other active incidents of the Event; which units they hold is decided in heldElsewhere (tested below).
    assert.match(src, /AND id <> \$\{incidentid\}\s+AND status = 'active'/);
    assert.match(src, /busyRefusal\(heldElsewhere\(others, uids\), uids\.length\)/);
});

// A second trip: a unit sent back to an incident it cleared from gets a new row; the first keeps its times.
const firstTrip = (): U[] => m.advanceUnit(m.advanceUnit(assigned(), 'u1', 'on_scene', T2).list, 'u1', 'cleared', T3).list;

test('a unit that cleared from the incident can be assigned again: a second row, the first trip kept', () => {
    const before = firstTrip();
    const { list, notes } = m.assignUnitsTo(before, [{ uid: 'u1', callsign: 'E12' }], T4);
    assert.equal(list.length, 3);
    assert.deepEqual(list[0], before[0], 'the first trip keeps its times');
    assert.deepEqual(list[2], { uid: 'u1', callsign: 'E12', status: 'assigned', assigned_at: T4, on_scene_at: null, cleared_at: null });
    assert.deepEqual(notes, [{ text: 'E12 assigned', time: T4 }]);
    assert.deepEqual(m.addedUnits(before, list), ['u1'], 'a second trip is checked against other incidents too');
    assert.deepEqual(m.assignUnitsTo(list, [{ uid: 'u1', callsign: 'E12' }], T4).list, list, 'still working: nothing added');
});

test('On Scene and Clear act on the trip still working, never on a cleared one', () => {
    const two: U[] = m.assignUnitsTo(firstTrip(), [{ uid: 'u1', callsign: 'E12' }], T4).list;
    const onScene: U[] = m.advanceUnit(two, 'u1', 'on_scene', T4).list;
    assert.deepEqual([onScene[0].status, onScene[0].on_scene_at, onScene[0].cleared_at], ['cleared', T2, T3]);
    assert.deepEqual([onScene[2].status, onScene[2].on_scene_at], ['on_scene', T4]);
    refuses(() => m.advanceUnit(firstTrip(), 'u1', 'cleared', T4), 400, /already cleared/);
    refuses(() => m.advanceUnit(firstTrip(), 'nope', 'cleared', T4), 404);
});

test('the ✕ removes one trip, picked by its assigned time; without one (older builds) the trip still working', () => {
    const two: U[] = m.assignUnitsTo(firstTrip(), [{ uid: 'u1', callsign: 'E12' }], T4).list;
    assert.deepEqual(m.removeUnitFrom(two, 'u1', T4).map((u: U) => [u.uid, u.assigned_at]), [['u1', T1], ['u2', T1]]);
    assert.deepEqual(m.removeUnitFrom(two, 'u1', T1).map((u: U) => [u.uid, u.assigned_at]), [['u2', T1], ['u1', T4]]);
    assert.deepEqual(m.removeUnitFrom(two, 'u1').map((u: U) => [u.uid, u.assigned_at]), [['u1', T1], ['u2', T1]], 'the cleared first trip keeps its times');
    assert.deepEqual(m.removeUnitFrom(firstTrip(), 'u1').map((u: U) => u.uid), ['u2'], 'no trip working: its rows go, as before');
    const old: U[] = m.normalizeUnits([{ uid: 'a', callsign: 'E7' }]);
    assert.deepEqual(m.removeUnitFrom(old, 'a', ''), [], "'' picks an old row with no time");
    refuses(() => m.removeUnitFrom(two, 'u1', T2), 404);
});

test('a stored list keeps both trips but never two rows still working for one unit', () => {
    const two: U[] = m.assignUnitsTo(firstTrip(), [{ uid: 'u1', callsign: 'E12' }], T4).list;
    assert.deepEqual(m.normalizeUnits(two), two);
    assert.deepEqual(m.normalizeUnits([...two, { uid: 'u1', callsign: 'E12', status: 'on_scene' }, two[0]]), two);
});

test('an older client sending its whole list back never starts a second trip', () => {
    const cur = firstTrip();
    const l: U[] = m.mergeAssignedFrom(cur, [{ uid: 'u1', callsign: 'E12' }, { uid: 'u2', callsign: 'M4' }], T4);
    assert.deepEqual(l, cur);
});

test('a unit is held elsewhere while Assigned or On Scene there, however the list was stored', () => {
    const rows = [
        { uid: 'u1', callsign: 'E12', status: 'cleared', assigned_at: T1, cleared_at: T3 },
        { uid: 'u1', callsign: 'E12', status: 'assigned', assigned_at: T4 },
        { uid: 'u2', callsign: 'M4', status: 'cleared', assigned_at: T1, cleared_at: T3 },
    ];
    const others = [
        { number: '26-014', assigned: rows },
        { number: '26-011', assigned: JSON.stringify(JSON.stringify([{ uid: 'u3', callsign: 'L1', status: 'on_scene' }])) },
        { number: '26-009', assigned: [{ uid: 'u4', callsign: 'E7' }] },
        { number: '26-008', assigned: JSON.stringify(rows) },
    ];
    assert.deepEqual(m.heldElsewhere(others, ['u1', 'u2', 'u3', 'u4', 'u9']), [
        { callsign: 'E12', number: '26-014' },
        { callsign: 'L1', number: '26-011' },
        { callsign: 'E7', number: '26-009' },
        { callsign: 'E12', number: '26-008' },
    ], 'a second trip, a double-encoded list, an old row with no status; a cleared unit is free');
    assert.deepEqual(m.heldElsewhere(others, ['u2']), []);
    assert.equal(m.busyRefusal(m.heldElsewhere(others, ['u1']), 1), 'E12 is on 014, E12 is on 008. Clear them there first.');
});
