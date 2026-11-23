// Proof tests for units that are not on TAK on the server (ops 1068, item 5). Plain node, no CloudTAK and no
// database:
//   node --test plugin/test/*.test.ts
// The pure unit logic between `// <units-pure>` markers in server/plugin-dispatcher.ts is cut out of the real
// file and run, as in units-server.test.ts. The plugin's own rules (lib/off-tak.ts) are imported to prove both
// sides agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from '../lib/off-tak.ts';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <units-pure>'), src.indexOf('// </units-pure>'));
const asArray = src.slice(src.indexOf('function asArray'), src.indexOf('\n}\n', src.indexOf('function asArray')) + 3);
assert.ok(block.includes('function offTakCallsignOf'), 'could not find the off-TAK rules in the server file');

const dir = mkdtempSync(join(tmpdir(), 'off-tak-'));
const file = join(dir, 'units.ts');
writeFileSync(file, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${asArray}
${block}
export { normalizeUnits, assignUnitsTo, advanceUnit, removeUnitFrom, clearAllUnits, mergeAssignedFrom, addedUnits, heldElsewhere, OFF_TAK_PREFIX, OFF_TAK_CALLSIGN_MAX };
`);
const m = await import(pathToFileURL(file).href);

const T1 = '2026-11-22T20:00:00.000Z', T2 = '2026-11-22T20:10:00.000Z', T3 = '2026-11-22T20:30:00.000Z';
const refuses = (fn: () => unknown, status: number, re?: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === status && (!re || re.test(e.message ?? '')));

test('server and plugin agree on the id prefix and the callsign length', () => {
    assert.equal(m.OFF_TAK_PREFIX, lib.OFF_TAK_PREFIX);
    assert.equal(m.OFF_TAK_CALLSIGN_MAX, lib.OFF_TAK_CALLSIGN_MAX);
});

test('a unit not on TAK is assigned by callsign: the server makes the id and keeps the flag, with a note', () => {
    const { list, notes } = m.assignUnitsTo([], [{ uid: 'whatever-the-client-said', callsign: '  e99 ', off_tak: true }], T1);
    assert.deepEqual(list, [{ uid: 'offtak:E99', callsign: 'e99', status: 'assigned', assigned_at: T1, on_scene_at: null, cleared_at: null, off_tak: true }]);
    assert.deepEqual(notes, [{ text: 'e99 assigned', time: T1 }]);
    // the plugin builds the same id
    assert.equal(list[0].uid, lib.offTakUid('e99'));
    // a TAK unit beside it is as before: no flag at all
    const both = m.assignUnitsTo(list, [{ uid: 'ANDROID-1', callsign: 'E12' }], T2).list;
    assert.equal('off_tak' in both[1], false);
});

test('the same callsign is one unit: typed again in another case it is not added twice, on this or (by id) another incident', () => {
    const once = m.assignUnitsTo([], [{ uid: 'x', callsign: 'E99', off_tak: true }], T1).list;
    const again = m.assignUnitsTo(once, [{ uid: 'y', callsign: 'e99', off_tak: true }], T2);
    assert.deepEqual(again.list, once);
    assert.deepEqual(again.notes, []);
    // one incident per unit: a unit working another active incident of the Event is refused for this one
    const other = [{ number: '26-014', assigned: once }];
    const added = m.addedUnits([], m.assignUnitsTo([], [{ uid: 'z', callsign: 'E99', off_tak: true }], T2).list);
    assert.deepEqual(added, ['offtak:E99']);
    assert.deepEqual(m.heldElsewhere(other, added), [{ callsign: 'E99', number: '26-014' }]);
});

test('On Scene, Clear and the trash can work on it by its id, and the flag stays on every step', () => {
    let list = m.assignUnitsTo([], [{ uid: 'x', callsign: 'E99', off_tak: true }], T1).list;
    list = m.advanceUnit(list, 'offtak:E99', 'on_scene', T2).list;
    assert.deepEqual([list[0].status, list[0].on_scene_at, list[0].off_tak], ['on_scene', T2, true]);
    list = m.advanceUnit(list, 'offtak:E99', 'cleared', T3).list;
    assert.deepEqual([list[0].status, list[0].cleared_at, list[0].off_tak], ['cleared', T3, true]);
    // closing an incident clears it with the rest and keeps the flag
    const open = m.assignUnitsTo([], [{ uid: 'x', callsign: 'E99', off_tak: true }, { uid: 'ANDROID-1', callsign: 'E12' }], T1).list;
    assert.deepEqual(m.clearAllUnits(open, T3).list.map((u: { off_tak?: boolean }) => u.off_tak), [true, undefined]);
    assert.deepEqual(m.removeUnitFrom(open, 'offtak:E99'), [open[1]]);
});

test('what is stored reads back with the flag, and an older row without it is a TAK unit as before', () => {
    const stored = m.assignUnitsTo([], [{ uid: 'x', callsign: 'E99', off_tak: true }, { uid: 'u1', callsign: 'E12' }], T1).list;
    assert.deepEqual(m.normalizeUnits(JSON.parse(JSON.stringify(stored))), stored);
    assert.deepEqual(m.normalizeUnits([{ uid: 'u1', callsign: 'E12' }]), [{ uid: 'u1', callsign: 'E12', status: 'assigned', assigned_at: null, on_scene_at: null, cleared_at: null }]);
    // the flag is only kept with the id the server makes: a forged one on a TAK id is dropped
    assert.equal('off_tak' in m.normalizeUnits([{ uid: 'ANDROID-9', callsign: 'E12', off_tak: true }])[0], false);
    assert.equal('off_tak' in m.normalizeUnits([{ uid: 'offtak:E99', callsign: 'E99' }])[0], false);
});

test('a bad callsign for a unit not on TAK is refused, one bad unit refusing the whole request', () => {
    for (const callsign of ['', '   ', '-E99', '<img src=x>', 'E9"9', 'E99;X', 'É9', 'x'.repeat(m.OFF_TAK_CALLSIGN_MAX + 1)]) {
        refuses(() => m.assignUnitsTo([], [{ uid: 'ok', callsign: 'E1' }, { uid: 'x', callsign, off_tak: true }], T1), 400);
        assert.notEqual(lib.offTakCallsignProblem(callsign), '', `the plugin refuses ${JSON.stringify(callsign)} too`);
    }
    for (const callsign of ['E99', 'Medic 5', 'M4/E12', 'ENG.9', 'x'.repeat(m.OFF_TAK_CALLSIGN_MAX)]) {
        assert.equal(m.assignUnitsTo([], [{ uid: 'x', callsign, off_tak: true }], T1).list.length, 1, callsign);
        assert.equal(lib.offTakCallsignProblem(callsign), '');
    }
});

test('a TAK unit cannot use an id that belongs to the units not on TAK', () => {
    refuses(() => m.assignUnitsTo([], [{ uid: 'offtak:E99', callsign: 'E99' }], T1), 400, /not on TAK/);
    refuses(() => m.assignUnitsTo([], [{ uid: 'offtak:E99', callsign: 'E99', off_tak: false }], T1), 400, /not on TAK/);
    // an older client that sends the whole list cannot add one either
    refuses(() => m.mergeAssignedFrom([], [{ uid: 'offtak:E99', callsign: 'E99' }], T1), 400, /not on TAK/);
});

test('the older client that sends the whole list keeps a unit not on TAK that is already on the incident', () => {
    const current = m.assignUnitsTo([], [{ uid: 'x', callsign: 'E99', off_tak: true }, { uid: 'u1', callsign: 'E12' }], T1).list;
    const kept = m.mergeAssignedFrom(current, [{ uid: 'offtak:E99', callsign: 'E99' }, { uid: 'u1', callsign: 'E12' }], T2);
    assert.deepEqual(kept, current);
});

test('the assign route takes the flag, and the units limit still holds', () => {
    assert.match(src, /units: Type\.Array\(Type\.Object\(\{ uid: Type\.String\(\), callsign: Type\.String\(\), off_tak: Type\.Optional\(Type\.Boolean\(\)\) \}\)\),/);
    const many = Array.from({ length: 100 }, (_, i) => ({ uid: `u${i}`, callsign: `U${i}` }));
    const full = m.assignUnitsTo([], many, T1).list;
    refuses(() => m.assignUnitsTo(full, [{ uid: 'x', callsign: 'E99', off_tak: true }], T2), 400, /at most 100/);
});
