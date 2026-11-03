// Proof tests for unit status on the server. Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The pure unit logic sits between `// <units-pure>` markers in server/plugin-dispatcher.ts. This test
// cuts that block (and asArray) out of the real file, stubs Err and runs it, so it tests the code that
// ships, not a copy. Same shape as callers-server.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <units-pure>'), src.indexOf('// </units-pure>'));
const asArray = src.slice(src.indexOf('function asArray'), src.indexOf('\n}\n', src.indexOf('function asArray')) + 3);
assert.ok(block.includes('function assignUnitsTo') && asArray.includes('Array.isArray'), 'could not find the units block in the server file');

const dir = mkdtempSync(join(tmpdir(), 'units-'));
const file = join(dir, 'units.ts');
writeFileSync(file, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${asArray}
${block}
export { normalizeUnits, assignUnitsTo, setUnitStatusIn, removeUnitFrom, clearAllUnits, unitNote, UNITS_MAX };
`);
const m = await import(pathToFileURL(file).href);

type U = { uid: string; callsign: string; status: string; assigned_at: string | null; onscene_at: string | null; cleared_at: string | null };
const T1 = '2026-11-02T14:02:00.000Z';
const T2 = '2026-11-02T14:09:00.000Z';
const T3 = '2026-11-02T14:40:00.000Z';
const refuses = (fn: () => unknown, status: number, re?: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === status && (!re || re.test(e.message ?? '')));

test('an entry from before unit status existed reads as Assigned with no times', () => {
    const l: U[] = m.normalizeUnits([{ uid: 'u1', callsign: 'E12' }]);
    assert.deepEqual(l, [{ uid: 'u1', callsign: 'E12', status: 'assigned', assigned_at: null, onscene_at: null, cleared_at: null }]);
});

test('normalize drops junk, keeps one entry per uid and a double-encoded column', () => {
    const l: U[] = m.normalizeUnits(JSON.stringify([
        null, 'x', { callsign: 'no uid' }, { uid: 'u1', callsign: 'E12', status: 'bogus', onscene_at: 'not a date' },
        { uid: 'u1', callsign: 'E12', status: 'onscene', assigned_at: T1, onscene_at: T2 },
    ]));
    assert.equal(l.length, 1);
    assert.equal(l[0].status, 'onscene');
    assert.equal(l[0].onscene_at, T2);
    assert.deepEqual(m.normalizeUnits('not json'), []);
});

test('assigning stamps assigned_at and makes a note; a unit already on the call is skipped', () => {
    const { list, added } = m.assignUnitsTo([], [{ uid: 'u1', callsign: 'E12' }, { uid: 'u2', callsign: 'M4' }], T1);
    assert.deepEqual(list.map((u: U) => [u.uid, u.status, u.assigned_at]), [['u1', 'assigned', T1], ['u2', 'assigned', T1]]);
    assert.deepEqual(added.map((u: U) => m.unitNote(u, 'assigned')), ['E12 assigned', 'M4 assigned']);
    const again = m.assignUnitsTo(list, [{ uid: 'u1', callsign: 'E12' }], T2);
    assert.equal(again.added.length, 0, 'no second entry and no note for a unit already assigned');
    assert.equal(again.list[0].assigned_at, T1, 'its time is untouched');
});

test('a unit needs a uid and a callsign', () => {
    refuses(() => m.assignUnitsTo([], [{ uid: '', callsign: 'E12' }], T1), 400);
    refuses(() => m.assignUnitsTo([], [{ uid: 'u1', callsign: '  ' }], T1), 400);
    refuses(() => m.assignUnitsTo([], [{ uid: 'u1', callsign: 'x'.repeat(65) }], T1), 400, /too long/);
});

test('Assigned → On Scene → Cleared, each stamped with the time given', () => {
    let l: U[] = m.assignUnitsTo([], [{ uid: 'u1', callsign: 'E12' }], T1).list;
    let r = m.setUnitStatusIn(l, 'u1', 'onscene', T2);
    l = r.list;
    assert.equal(r.unit.status, 'onscene');
    assert.equal(m.unitNote(r.unit, 'onscene'), 'E12 on scene');
    r = m.setUnitStatusIn(l, 'u1', 'cleared', T3);
    l = r.list;
    assert.deepEqual(l[0], { uid: 'u1', callsign: 'E12', status: 'cleared', assigned_at: T1, onscene_at: T2, cleared_at: T3 });
    assert.equal(m.unitNote(r.unit, 'cleared'), 'E12 cleared');
});

test('a unit can clear straight from Assigned (cancelled on the way), with no on-scene time', () => {
    const l: U[] = m.assignUnitsTo([], [{ uid: 'u1', callsign: 'E12' }], T1).list;
    const { list } = m.setUnitStatusIn(l, 'u1', 'cleared', T2);
    assert.deepEqual([list[0].status, list[0].onscene_at, list[0].cleared_at], ['cleared', null, T2]);
});

test('the only moves are to On Scene from Assigned, and to Cleared; a cleared unit is done', () => {
    const l: U[] = m.assignUnitsTo([], [{ uid: 'u1', callsign: 'E12' }], T1).list;
    const on = m.setUnitStatusIn(l, 'u1', 'onscene', T2).list;
    refuses(() => m.setUnitStatusIn(on, 'u1', 'onscene', T3), 400, /already on scene/);
    const off = m.setUnitStatusIn(on, 'u1', 'cleared', T3).list;
    refuses(() => m.setUnitStatusIn(off, 'u1', 'onscene', T3), 400, /already cleared/);
    refuses(() => m.setUnitStatusIn(off, 'u1', 'cleared', T3), 400, /already cleared/);
    refuses(() => m.setUnitStatusIn(l, 'nobody', 'onscene', T2), 404);
});

test('a cleared unit can be sent again: its times start over, the list still has one entry for it', () => {
    let l: U[] = m.assignUnitsTo([], [{ uid: 'u1', callsign: 'E12' }], T1).list;
    l = m.setUnitStatusIn(l, 'u1', 'cleared', T2).list;
    const { list, added } = m.assignUnitsTo(l, [{ uid: 'u1', callsign: 'E12' }], T3);
    assert.equal(list.length, 1);
    assert.equal(added.length, 1);
    assert.deepEqual(list[0], { uid: 'u1', callsign: 'E12', status: 'assigned', assigned_at: T3, onscene_at: null, cleared_at: null });
});

test('remove (the ✕) takes the unit off the record and says so', () => {
    const l: U[] = m.assignUnitsTo([], [{ uid: 'u1', callsign: 'E12' }, { uid: 'u2', callsign: 'M4' }], T1).list;
    const { list, unit } = m.removeUnitFrom(l, 'u1');
    assert.deepEqual(list.map((u: U) => u.uid), ['u2']);
    assert.equal(m.unitNote(unit, 'removed'), 'E12 removed (assigned in error)');
    refuses(() => m.removeUnitFrom(list, 'u1'), 404);
});

test('closing the incident clears every unit still on it; already-cleared units are untouched', () => {
    let l: U[] = m.assignUnitsTo([], [{ uid: 'u1', callsign: 'E12' }, { uid: 'u2', callsign: 'M4' }, { uid: 'u3', callsign: 'L1' }], T1).list;
    l = m.setUnitStatusIn(l, 'u1', 'onscene', T2).list;
    l = m.setUnitStatusIn(l, 'u2', 'cleared', T2).list;
    const { list, cleared } = m.clearAllUnits(l, T3);
    assert.deepEqual(list.map((u: U) => [u.uid, u.status, u.cleared_at]), [['u1', 'cleared', T3], ['u2', 'cleared', T2], ['u3', 'cleared', T3]]);
    assert.deepEqual(cleared.map((u: U) => m.unitNote(u, 'closed')), ['E12 cleared (incident closed)', 'L1 cleared (incident closed)']);
    assert.equal(list[0].onscene_at, T2, 'the on-scene time is kept');
});

test('an incident holds at most UNITS_MAX units', () => {
    const many = Array.from({ length: m.UNITS_MAX }, (_, i) => ({ uid: `u${i}`, callsign: `U${i}` }));
    const l: U[] = m.assignUnitsTo([], many, T1).list;
    assert.equal(l.length, m.UNITS_MAX);
    refuses(() => m.assignUnitsTo(l, [{ uid: 'one-more', callsign: 'X' }], T1), 400, /at most/);
});
