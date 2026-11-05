// Proof tests for the broadcast closed-marker window (closed_marker_minutes). Plain node, no
// CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// Plugin side: lib/closed-window.ts has no imports, so it is loaded as it ships.
// Server side: the pure logic between `// <cjis-pure>` markers in server/plugin-dispatcher.ts is
// cut out of the real file and run (the admin check itself is CloudTAK's Auth and is not testable
// here). Both are the code that ships, not a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as w from '../lib/closed-window.ts';

const server = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = server.slice(server.indexOf('// <cjis-pure>'), server.indexOf('// </cjis-pure>'));
assert.ok(block.includes('closed_marker_minutes'), 'could not find the closed_marker_minutes rule in the server file');

const dir = mkdtempSync(join(tmpdir(), 'closed-window-'));
const sfile = join(dir, 'server.ts');
writeFileSync(sfile, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${block}
export { isAdminOnlySetting, normCjisSetting, CLOSED_MARKER_MINUTES_MIN, CLOSED_MARKER_MINUTES_MAX };
`);
const s = await import(pathToFileURL(sfile).href);

const refuses = (fn: () => unknown, status: number, re?: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === status && (!re || re.test(e.message ?? '')));

const MIN = 60 * 1000;
const T0 = Date.parse('2026-01-01T12:00:00Z');   // a close time
const NOW = T0 + 5 * MIN;                        // five minutes later

test('server and plugin agree on the allowed range; the default is 60 minutes', () => {
    assert.equal(s.CLOSED_MARKER_MINUTES_MIN, w.CLOSED_MARKER_MINUTES_MIN);
    assert.equal(s.CLOSED_MARKER_MINUTES_MAX, w.CLOSED_MARKER_MINUTES_MAX);
    assert.equal(w.CLOSED_MARKER_MINUTES_MIN, 0);
    assert.equal(w.CLOSED_MARKER_MINUTES_MAX, 1440);
    assert.equal(w.CLOSED_MARKER_MINUTES_DEFAULT, 60);
});

test('closed_marker_minutes is admin-only, like the CJIS keys', () => {
    assert.equal(s.isAdminOnlySetting('closed_marker_minutes'), true);
    assert.equal(s.isAdminOnlySetting('cjis_reminder_enabled'), true);
    assert.equal(s.isAdminOnlySetting('caller_on_markers'), false);
});

test('server: stores whole minutes from 0 to 1440 and refuses everything else with a 400', () => {
    for (const ok of [0, 1, 60, 1440]) assert.equal(s.normCjisSetting('closed_marker_minutes', ok), ok);
    for (const bad of [-1, 1441, 60.5, '60', null, undefined, true, NaN, Infinity]) {
        refuses(() => s.normCjisSetting('closed_marker_minutes', bad), 400, /whole number of minutes/);
    }
});

test('plugin: a missing key, an older server, or a bad value all read as the default', () => {
    for (const input of [undefined, null, {}, { caller_on_markers: false }, { closed_marker_minutes: '30' },
        { closed_marker_minutes: 30.5 }, { closed_marker_minutes: -5 }, { closed_marker_minutes: 2000 }]) {
        assert.equal(w.closedMarkerMinutesFrom(input), 60);
    }
    assert.equal(w.closedMarkerMinutesFrom({ closed_marker_minutes: 0 }), 0);
    assert.equal(w.closedMarkerMinutesFrom({ closed_marker_minutes: 15 }), 15);
    assert.equal(w.closedMarkerMinutesFrom({ closed_marker_minutes: 1440 }), 1440);
});

test('ended = close time + window for 60 and 1440 minutes', () => {
    assert.equal(w.closedMarkerEndMs(T0, 60, NOW), T0 + 60 * MIN);
    assert.equal(w.closedMarkerEndMs(T0, 1440, NOW), T0 + 1440 * MIN);
    // an unusable window (older store value) falls back to the default rather than failing the close
    assert.equal(w.closedMarkerEndMs(T0, -1, NOW), T0 + 60 * MIN);
});

test('0 minutes ends the Core Event a minute from now, never in the past', () => {
    assert.equal(w.closedMarkerEndMs(T0, 0, NOW), NOW + w.WITHDRAW_MS);
    assert.ok(w.closedMarkerEndMs(T0, 0, NOW) > NOW);
});

test('withdraw guard: an open incident, or one ending later than the withdraw time, is withdrawn', () => {
    assert.equal(w.shouldWithdraw(null, NOW), true);                       // never closed
    assert.equal(w.shouldWithdraw(T0 + 60 * MIN, NOW), true);              // ends in 55 min
    assert.equal(w.shouldWithdraw(NOW + w.WITHDRAW_MS + 1, NOW), true);    // just past the withdraw time
});

test('withdraw guard: an incident already ending by the withdraw time is left alone', () => {
    assert.equal(w.shouldWithdraw(T0 + 2 * MIN, NOW), false);              // ended 3 min ago
    assert.equal(w.shouldWithdraw(NOW + w.WITHDRAW_MS, NOW), false);       // ends exactly then
    assert.equal(w.shouldWithdraw(w.closedMarkerEndMs(T0, 0, NOW), NOW), false);  // a 0-minute close
});

test('the remembered window starts at the default; a bad value falls back to it', () => {
    assert.equal(w.closedMarkerMinutes(), 60);
    assert.equal(w.setClosedMarkerMinutes(15), 15);
    assert.equal(w.closedMarkerMinutes(), 15);
    assert.equal(w.setClosedMarkerMinutes('15'), 60);
    assert.equal(w.setClosedMarkerMinutes(0), 0);
    w.setClosedMarkerMinutes(60);
});

test('the dropdown choices are 0, 5, 10, 15, 30 and 60, all within the server range', () => {
    assert.deepEqual([...w.CLOSED_MARKER_MINUTE_CHOICES], [0, 5, 10, 15, 30, 60]);
    for (const m of w.CLOSED_MARKER_MINUTE_CHOICES) assert.equal(w.isClosedMarkerMinutes(m), true);
});

test('endedMsFrom reads the end time CloudTAK returns, in either date format, or null', () => {
    assert.equal(w.endedMsFrom({ ended: '2026-11-04T15:03:36.223Z' }), Date.parse('2026-11-04T15:03:36.223Z'));
    assert.equal(w.endedMsFrom({ ended: '2026-11-04 15:03:36.223+00' }), Date.parse('2026-11-04T15:03:36.223Z'));
    for (const bad of [null, undefined, {}, { ended: null }, { ended: '' }, { ended: 'soon' }, { ended: 5 }, 'x']) {
        assert.equal(w.endedMsFrom(bad), null);
    }
});
