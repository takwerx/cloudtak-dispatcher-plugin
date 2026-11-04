// Unit status as the dispatcher sees it (ops #450): board label, marker line, report and CSV.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_LABEL, boardState, firstOnScene, respondingLine, unitTimesLine } from '../lib/unit-status.ts';
import { buildCsv, buildReportHtml, buildStats, unitLine } from '../lib/report.ts';

const T1 = '2026-11-02T17:15:00.000Z', T2 = '2026-11-02T17:22:00.000Z', T3 = '2026-11-02T17:39:00.000Z', T4 = '2026-11-02T17:52:00.000Z';
const assignedU = { uid: 'a', callsign: 'M4', status: 'assigned' as const, assigned_at: T1, on_scene_at: null, cleared_at: null };
const onSceneU = { uid: 'b', callsign: 'E12', status: 'on_scene' as const, assigned_at: T1, on_scene_at: T4, cleared_at: null };
const clearedU = { uid: 'c', callsign: 'L1', status: 'cleared' as const, assigned_at: T1, on_scene_at: T2, cleared_at: T3 };

test('the board reads Unassigned, Dispatched or On Scene from the units', () => {
    assert.equal(BOARD_LABEL[boardState([])], 'Unassigned');
    assert.equal(BOARD_LABEL[boardState(undefined)], 'Unassigned');
    assert.equal(BOARD_LABEL[boardState([assignedU])], 'Dispatched');
    assert.equal(BOARD_LABEL[boardState([assignedU, onSceneU])], 'On Scene');
});

test('cleared units no longer count: only-cleared reads Unassigned, a cleared one beside an assigned one reads Dispatched', () => {
    assert.equal(boardState([clearedU]), 'unassigned');
    assert.equal(boardState([clearedU, assignedU]), 'dispatched');
    assert.equal(boardState([clearedU, onSceneU]), 'on_scene');
});

test('an older unit with no status reads as Assigned', () => {
    assert.equal(boardState([{ uid: 'x', callsign: 'E7' }]), 'dispatched');
});

test('the marker remarks line marks On Scene units and drops cleared ones', () => {
    assert.equal(respondingLine([onSceneU, assignedU]), 'Responding: E12 (on scene), M4');
    assert.equal(respondingLine([onSceneU, clearedU, assignedU]), 'Responding: E12 (on scene), M4');
    assert.equal(respondingLine([clearedU]), '', 'no line once everyone has cleared');
    assert.equal(respondingLine([]), '');
});

test('first on scene is the earliest on-scene time over all units, cleared ones included', () => {
    assert.equal(firstOnScene([onSceneU, clearedU, assignedU]), T2);
    assert.equal(firstOnScene([assignedU]), null);
    assert.equal(firstOnScene(undefined), null);
});

test('a unit line lists only the steps that have a time', () => {
    const f = (t: string) => `<${t.slice(11, 16)}>`;
    assert.equal(unitTimesLine(clearedU, f), 'assigned <17:15> · on scene <17:22> · cleared <17:39>');
    assert.equal(unitTimesLine(assignedU, f), 'assigned <17:15>');
    assert.equal(unitTimesLine({ uid: 'x', callsign: 'E7' }, f), '');
    assert.equal(unitLine(clearedU, f), 'L1 (cleared) assigned <17:15> · on scene <17:22> · cleared <17:39>');
    assert.equal(unitLine({ uid: 'x', callsign: 'E7' }, f), 'E7');
});

const incident = {
    id: 'i1', event_id: 'e1', number: '26-001', type: 'Fire', address: '1 Main St', lat: 1, lon: 2, dispatcher: 'D',
    details: null, report_number: null, callers: [], caller_name: null, caller_phone: null, status: 'closed',
    assigned: [clearedU, onSceneU, assignedU], notes: [], created_at: T1, closed_at: T4,
};

test('the CSV keeps its old columns and adds first_on_scene and every unit with its three times', () => {
    const rows = buildCsv([incident as never]).split('\r\n');
    const header = rows[0].split(',');
    assert.deepEqual(header.slice(-2), ['first_on_scene', 'unit_times']);
    assert.ok(header.includes('assigned_units'), 'the old column stays');
    assert.match(rows[1], /"L1; E12; M4"/);
    assert.ok(rows[1].includes(`"${T2}","L1 (cleared) assigned [${T1}] · on scene [${T2}] · cleared [${T3}] | E12 (on scene) assigned [${T1}] · on scene [${T4}] | M4 assigned [${T1}]"`));
});

test('the report lists each unit with its times, and the first on-scene time', () => {
    const range = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') };
    const list = [{ ...incident, assigned: [{ ...clearedU, callsign: '<i>L1</i>' }, onSceneU] }] as never[];
    const html = buildReportHtml({ name: 'E', prefix: '26', feed_name: 'feed', channel: null, status: 'active' } as never, list, buildStats(list, range), [], range, 'me');
    assert.match(html, /<td>First on scene<\/td>/);
    assert.match(html, /&lt;i&gt;L1&lt;\/i&gt; \(cleared\) assigned .* on scene .* cleared /);
    assert.doesNotMatch(html, /<i>L1<\/i>/);
    assert.match(html, /E12 \(on scene\) assigned /);
});

test('an incident whose units have no times (older data) reports with no First on scene row', () => {
    const range = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') };
    const list = [{ ...incident, assigned: [{ uid: 'x', callsign: 'E7' }] }] as never[];
    const html = buildReportHtml({ name: 'E', prefix: '26', feed_name: 'feed', channel: null, status: 'active' } as never, list, buildStats(list, range), [], range, 'me');
    assert.doesNotMatch(html, /First on scene/);
    assert.match(html, /<td>Units<\/td><td>E7<\/td>/);
});
