// Unit status reaches the board's stage word, the marker remarks, the after-action report and the CSV.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incidentStage, unitStatus, respondingRemark, unitTimeline, unitLine, firstOnScene } from '../lib/units.ts';
import { buildCsv, buildReportHtml, buildStats } from '../lib/report.ts';

const T1 = '2026-11-02T14:02:00.000Z';
const T2 = '2026-11-02T14:09:00.000Z';
const T3 = '2026-11-02T14:40:00.000Z';
const unit = (over: object) => ({ uid: 'u', callsign: 'E12', status: 'assigned', assigned_at: T1, onscene_at: null, cleared_at: null, ...over });
const e12 = unit({ uid: 'u1', callsign: 'E12', status: 'onscene', onscene_at: T2 });
const m4  = unit({ uid: 'u2', callsign: 'M4' });
const l1  = unit({ uid: 'u3', callsign: 'L1', status: 'cleared', onscene_at: T1, cleared_at: T3 });
const incident = {
    id: 'i1', event_id: 'e1', number: '26-001', type: 'Fire', address: '1 Main St', lat: 1, lon: 2, dispatcher: 'D',
    details: null, report_number: null, callers: [], caller_name: null, caller_phone: null, core_event_id: null, status: 'active',
    assigned: [e12, m4, l1], notes: [], created_at: '2026-11-02T14:00:00.000Z', closed_at: null,
};

test('an old entry with no status reads as Assigned', () => {
    assert.equal(unitStatus({ uid: 'u', callsign: 'E12' } as never), 'assigned');
    assert.equal(unitStatus({ status: 'cleared' } as never), 'cleared');
});

test('the stage word: Unassigned with no live unit, Dispatched, On Scene; cleared units do not count', () => {
    assert.equal(incidentStage([]), 'unassigned');
    assert.equal(incidentStage(undefined), 'unassigned');
    assert.equal(incidentStage([l1] as never), 'unassigned');
    assert.equal(incidentStage([m4, l1] as never), 'dispatched');
    assert.equal(incidentStage([m4, e12] as never), 'onscene');
    assert.equal(incidentStage([{ uid: 'u', callsign: 'old' }] as never), 'dispatched');
});

test('the marker remarks list responding units, mark the ones on scene and leave cleared units out', () => {
    assert.equal(respondingRemark([e12, m4, l1] as never), 'Responding: E12 (on scene), M4');
    assert.equal(respondingRemark([l1] as never), '');
    assert.equal(respondingRemark([]), '');
});

test('a unit timeline and the first on-scene time', () => {
    const hhmm = (iso: string) => iso.slice(11, 16);
    assert.equal(unitTimeline(l1 as never, hhmm), 'assigned 14:02 · on scene 14:02 · cleared 14:40');
    assert.equal(unitTimeline(m4 as never, hhmm), 'assigned 14:02');
    assert.equal(unitTimeline({ uid: 'u', callsign: 'old' } as never, hhmm), '');
    assert.equal(unitLine({ uid: 'u', callsign: 'old' } as never, hhmm), 'old');
    assert.equal(unitLine(e12 as never, hhmm), 'E12 (assigned 14:02 · on scene 14:09)');
    assert.deepEqual(firstOnScene([e12, m4, l1] as never), { time: T1, callsign: 'L1' });
    assert.equal(firstOnScene([m4] as never), null);
});

test('the CSV has each unit with its times and a first_on_scene column', () => {
    const rows = buildCsv([incident as never]).split('\r\n');
    const header = rows[0].split(',');
    assert.equal(header[header.indexOf('created_at') + 1], 'first_on_scene');
    assert.match(rows[1], new RegExp(`"${T1}","2026-11-02T14:00:00.000Z"`.replace('"2026-11-02T14:00:00.000Z"', '')));
    assert.match(rows[1], /"2026-11-02T14:00:00\.000Z","2026-11-02T14:02:00\.000Z",""/, 'created_at, first_on_scene (L1 at 14:02), closed_at');
    assert.match(rows[1], /"E12 \(assigned 2026-11-02T14:02:00\.000Z · on scene 2026-11-02T14:09:00\.000Z\); M4 \(assigned 2026-11-02T14:02:00\.000Z\); L1 \(assigned [^)]+ · cleared 2026-11-02T14:40:00\.000Z\)"/);
});

test('the report lists each unit on its own line with its times, plus the first on-scene time', () => {
    const range = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') };
    const list = [{ ...incident, assigned: [{ ...e12, callsign: '<E12>' }, m4] }] as never[];
    const html = buildReportHtml({ name: 'E', prefix: '26', feed_name: 'feed', channel: null, status: 'active' } as never, list, buildStats(list, range), [], range, 'me');
    assert.match(html, /<td>Units<\/td><td>&lt;E12&gt; \(assigned [^)]+ · on scene [^)]+\)<br>M4 \(assigned [^)]+\)<\/td>/);
    assert.doesNotMatch(html, /<E12>/);
    assert.match(html, /<tr><td>On scene<\/td><td>[^<]+ \(&lt;E12&gt;\)<\/td><\/tr>/);
});

test('an incident with no units shows a dash and no on-scene row', () => {
    const range = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') };
    const list = [{ ...incident, assigned: [] }] as never[];
    const html = buildReportHtml({ name: 'E', prefix: '26', feed_name: 'feed', channel: null, status: 'active' } as never, list, buildStats(list, range), [], range, 'me');
    assert.match(html, /<td>Units<\/td><td>—<\/td>/);
    assert.doesNotMatch(html, /<td>On scene<\/td>/);
});
