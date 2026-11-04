// Employee numbers in the plugin (Dispatcher Settings → Employee Numbers, default off): what the header box
// accepts, the switch as read from settings, and how who created, took, dispatched and closed each call reach
// the after-action report and the CSV, only when on.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOperator, operatorNumbersFrom, OPERATOR_MAX, OPERATOR_SETTING } from '../lib/operator.ts';
import { buildCsv, buildReportHtml, buildStats } from '../lib/report.ts';

const incident = {
    id: 'i1', event_id: 'e1', number: '26-001', type: 'Medical', address: '1 Main St', lat: 1, lon: 2,
    dispatcher: 'Desk', created_by_no: '4471', initial_dispatcher_no: '2308', closed_by_no: '3333',
    details: null, report_number: null, core_event_id: null, status: 'closed',
    callers: [
        { id: 'c1', name: 'Caller One', phone: null, note: null, time: '2026-11-03T14:00:00.000Z', primary: true, taken_by: '4471' },
        { id: 'c2', name: 'Caller Two', phone: null, note: null, time: '2026-11-03T14:05:00.000Z', primary: false },
    ],
    caller_name: 'Caller One', caller_phone: null,
    assigned: [], created_at: '2026-11-03T14:00:00.000Z', closed_at: '2026-11-03T15:00:00.000Z', disposition: 'Report', disposition_note: null,
    notes: [
        { text: 'Chest pain', time: '2026-11-03T14:00:00.000Z', by: '4471' },
        { text: 'E12 assigned', time: '2026-11-03T14:02:00.000Z', by: '2308' },
        { text: 'Older note', time: '2026-11-03T14:03:00.000Z' },
    ],
};
const range = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-05T00:00:00Z') };
const html = (list: object[], operators: boolean) =>
    buildReportHtml({ name: 'E', prefix: '26', feed_name: 'feed', channel: null, status: 'active' } as never, list as never[], buildStats(list as never[], range), [], range, 'me', null, operators);

test('the header box takes digits only, trimmed, up to 16', () => {
    assert.equal(parseOperator(' 4471 '), '4471');
    assert.equal(parseOperator('0042'), '0042');
    assert.equal(OPERATOR_MAX, 16);
    for (const bad of ['', '  ', '44a1', '-1', '44 71', '1'.repeat(17), null, undefined]) {
        assert.equal(parseOperator(bad as string), null, String(bad));
    }
});

test('the switch is off by default: missing settings, an older server, anything but true', () => {
    assert.equal(OPERATOR_SETTING, 'operator_numbers');
    assert.equal(operatorNumbersFrom(undefined), false);
    assert.equal(operatorNumbersFrom({}), false);
    assert.equal(operatorNumbersFrom({ operator_numbers: 'true' }), false);
    assert.equal(operatorNumbersFrom({ operator_numbers: true }), true);
});

test('switch off: the report is as before, no numbers anywhere', () => {
    const h = html([incident], false);
    assert.match(h, /<td>Dispatcher<\/td><td>Desk<\/td>/);
    assert.doesNotMatch(h, /Created by|Dispatcher #|Closed by|taken by|4471|2308|3333/);
});

test('switch on: the report shows who created, dispatched and closed it, who took each call, who wrote each note', () => {
    const h = html([incident], true);
    assert.match(h, /<td>Dispatcher<\/td><td>Desk<\/td>/, 'the dispatcher field itself is unchanged');
    assert.match(h, /<td>Created by #<\/td><td>4471<\/td>/);
    assert.match(h, /<td>Initial Dispatcher #<\/td><td>2308<\/td>/);
    assert.match(h, /<td>Closed by #<\/td><td>3333<\/td>/);
    assert.match(h, /Caller One \(primary\) · taken by #4471/);
    assert.match(h, /Caller Two<br>|Caller Two<\/td>/, 'a caller with no number shows no suffix');
    assert.match(h, /Chest pain <span class='muted'>· 4471<\/span>/);
    assert.match(h, /E12 assigned <span class='muted'>· 2308<\/span>/);
    assert.match(h, /Older note<\/div>/, 'a note without an author shows no suffix');
    const empty = html([{ ...incident, created_by_no: null, initial_dispatcher_no: null, closed_by_no: null }], true);
    assert.match(empty, /<td>Created by #<\/td><td>—<\/td>/);
    assert.match(empty, /<td>Closed by #<\/td><td>—<\/td>/);
    const active = html([{ ...incident, status: 'active', closed_at: null, closed_by_no: null }], true);
    assert.doesNotMatch(active, /Closed by/, 'an active incident has no Closed by row');
});

test('switch off: the CSV has exactly the old columns', () => {
    const rows = buildCsv([incident] as never[]).split('\r\n');
    assert.ok(!/created_by_no|dispatcher_no|closed_by_no/.test(rows[0]));
    assert.doesNotMatch(rows[1], /\(4471\)|\(2308\)|taken by/);
});

test('switch on: the CSV adds the three numbers after dispatcher, who took each call, and each note\'s author', () => {
    const rows = buildCsv([incident] as never[], true).split('\r\n');
    const header = rows[0].split(',');
    const at = header.indexOf('dispatcher');
    assert.deepEqual(header.slice(at, at + 4), ['dispatcher', 'created_by_no', 'initial_dispatcher_no', 'closed_by_no']);
    assert.match(rows[1], /,"?Desk"?,"?4471"?,"?2308"?,"?3333"?,/);
    assert.match(rows[1], /Caller One \(primary\) · taken by #4471 \| \[2026-11-03T14:05:00.000Z\] Caller Two"/);
    assert.match(rows[1], /\[2026-11-03T14:00:00.000Z\] Chest pain \(4471\) \| \[2026-11-03T14:02:00.000Z\] E12 assigned \(2308\) \| \[2026-11-03T14:03:00.000Z\] Older note/);
});
