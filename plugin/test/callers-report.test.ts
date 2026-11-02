// Every caller, with the time of the call, reaches the CSV and the after-action report (ops #403).
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, buildReportHtml, buildStats, callerLine } from '../lib/report.ts';

const callers = [
    { id: 'a', name: 'Jane Doe', phone: '(555) 555-0123', note: null, time: '2026-11-02T07:10:00.000Z', primary: false },
    { id: 'b', name: 'Bob Smith', phone: '555-0199', note: 'reports smoke from rear', time: '2026-11-02T07:14:00.000Z', primary: true },
];
const incident = {
    id: 'i1', event_id: 'e1', number: '26-001', type: 'Fire', address: '1 Main St', lat: 1, lon: 2, dispatcher: 'D',
    details: null, report_number: null, callers, caller_name: 'Bob Smith', caller_phone: '555-0199', status: 'active',
    assigned: [], notes: [], created_at: '2026-11-02T07:00:00.000Z', closed_at: null,
};

test('one caller line has the time, name, phone, note and primary flag', () => {
    assert.equal(callerLine(callers[1], '[T]'), '[T] Bob Smith · 555-0199 — reports smoke from rear (primary)');
    assert.equal(callerLine(callers[0], '[T]'), '[T] Jane Doe · (555) 555-0123');
});

test('the CSV has every caller with its time, and keeps caller_name / caller_phone as the primary', () => {
    const rows = buildCsv([incident as never]).split('\r\n');
    const header = rows[0].split(',');
    assert.deepEqual(header.slice(0, 5), ['number', 'report_number', 'caller_name', 'caller_phone', 'callers']);
    assert.match(rows[1], /"Bob Smith","555-0199"/);
    assert.match(rows[1], /\[2026-11-02T07:10:00\.000Z\] Jane Doe · \(555\) 555-0123 \| \[2026-11-02T07:14:00\.000Z\] Bob Smith · 555-0199 — reports smoke from rear \(primary\)/);
});

test('an incident with no callers gives empty caller cells', () => {
    const rows = buildCsv([{ ...incident, callers: [], caller_name: null, caller_phone: null } as never]).split('\r\n');
    assert.match(rows[1], /^"26-001","","","","",/);
});

test('the report lists each caller on its own line, escaped', () => {
    const range = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') };
    const list = [{ ...incident, callers: [{ ...callers[0], name: '<b>Jane</b>' }, callers[1]] }] as never[];
    const html = buildReportHtml({ name: 'E', prefix: '26', feed_name: 'feed', channel: null, status: 'active' } as never, list, buildStats(list, range), [], range, 'me');
    assert.match(html, /<td>Callers<\/td>/);
    assert.match(html, /&lt;b&gt;Jane&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<b>Jane<\/b>/);
    assert.match(html, /Bob Smith · 555-0199 — reports smoke from rear \(primary\)/);
});
