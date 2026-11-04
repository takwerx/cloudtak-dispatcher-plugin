// The disposition reaches the closed incident's label, the after-action report and the CSV.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPOSITIONS, DISPOSITION_OTHER, DISPOSITION_MAX, DISPOSITION_NOTE_MAX, dispositionLabel } from '../lib/dispositions.ts';
import { buildCsv, buildReportHtml, buildStats } from '../lib/report.ts';

const incident = {
    id: 'i1', event_id: 'e1', number: '26-001', type: 'Fire', address: '1 Main St', lat: 1, lon: 2, dispatcher: 'D',
    details: null, report_number: null, callers: [], caller_name: null, caller_phone: null, core_event_id: null, status: 'closed',
    assigned: [], notes: [], created_at: '2026-11-02T14:00:00.000Z', closed_at: '2026-11-02T14:40:00.000Z',
    disposition: 'Unfounded', disposition_note: null,
};
const range = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') };
const html = (list: object[]) =>
    buildReportHtml({ name: 'E', prefix: '26', feed_name: 'feed', channel: null, status: 'active' } as never, list as never[], buildStats(list as never[], range), [], range, 'me');

test('the preset list: a handful of short choices, Other is not one of them, none repeats', () => {
    assert.ok(DISPOSITIONS.length >= 4 && DISPOSITIONS.length <= 8, `${DISPOSITIONS.length} presets`);
    assert.equal(new Set(DISPOSITIONS).size, DISPOSITIONS.length);
    assert.ok(!DISPOSITIONS.includes(DISPOSITION_OTHER));
    for (const d of DISPOSITIONS) assert.ok(d.trim() === d && d.length > 0 && d.length <= DISPOSITION_MAX, d);
    assert.equal(DISPOSITION_NOTE_MAX, 80);
});

test('the label: the preset, or Other with its words; empty when there is none', () => {
    assert.equal(dispositionLabel({ disposition: 'Unfounded', disposition_note: null }), 'Unfounded');
    assert.equal(dispositionLabel({ disposition: 'Other', disposition_note: 'lost contact with caller' }), 'Other — lost contact with caller');
    assert.equal(dispositionLabel({ disposition: null, disposition_note: null }), '');
});

test('the report shows the disposition under Closed, escaped', () => {
    const out = html([{ ...incident, disposition: 'Other', disposition_note: 'caller <left>' }]);
    assert.match(out, /<tr><td>Closed<\/td><td>[^<]+<\/td><\/tr>\s*<tr><td>Disposition<\/td><td>Other — caller &lt;left&gt;<\/td><\/tr>/);
    assert.doesNotMatch(out, /<left>/);
});

test('an active incident, or one closed before dispositions existed, has no Disposition row', () => {
    assert.doesNotMatch(html([{ ...incident, status: 'active', closed_at: null, disposition: null }]), /<td>Disposition<\/td>/);
    assert.doesNotMatch(html([{ ...incident, disposition: null }]), /<td>Disposition<\/td>/);
});

test('the CSV has disposition and disposition_note right after closed_at', () => {
    const rows = buildCsv([incident as never, { ...incident, disposition: 'Other', disposition_note: 'say "why"' } as never]).split('\r\n');
    const header = rows[0].split(',');
    const at = header.indexOf('closed_at');
    assert.deepEqual(header.slice(at, at + 3), ['closed_at', 'disposition', 'disposition_note']);
    assert.match(rows[1], /"2026-11-02T14:40:00\.000Z","Unfounded","","1 Main St"/);
    assert.match(rows[2], /"2026-11-02T14:40:00\.000Z","Other","say ""why""","1 Main St"/);
});
