// Proof tests for units that are not on TAK (ops 1068, item 5): the callsign rules, how such a unit is told
// from a TAK unit, what the board, the report and the CSV say about it, and that the screens and the command
// line are wired to it. Plain node:
//   node --test plugin/test/*.test.ts
// lib/off-tak.ts, lib/unit-status.ts and lib/report.ts are pure, so they run as they ship.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    OFF_TAK_CALLSIGN_MAX, OFF_TAK_LABEL, OFF_TAK_PREFIX, isOffTak, offTakCallsign, offTakCallsignProblem, offTakTag, offTakUid, offTakUnit,
    offTakWord, onTak,
} from '../lib/off-tak.ts';
import { busyUnits, rowUnitList, respondingLine, unitStatus, workingUids } from '../lib/unit-status.ts';
import { buildCsv, buildReportHtml, buildStats, unitLine } from '../lib/report.ts';

const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const T1 = '2026-11-22T20:00:00.000Z', T2 = '2026-11-22T20:10:00.000Z';
const tak = { uid: 'ANDROID-1', callsign: 'E12', status: 'assigned', assigned_at: T1, on_scene_at: null, cleared_at: null };
const off = { uid: 'offtak:E99', callsign: 'E99', off_tak: true, status: 'on_scene', assigned_at: T1, on_scene_at: T2, cleared_at: null };

test('a callsign: letters, digits and . _ / - and spaces, 40 at most; markup and odd characters are refused', () => {
    for (const ok of ['E99', 'e 99', 'Medic-5', 'M4/E12', 'ENG.9', 'A_1', '9ABC', 'x'.repeat(OFF_TAK_CALLSIGN_MAX)]) {
        assert.equal(offTakCallsignProblem(ok), '', ok);
    }
    for (const bad of ['', '   ', '-E99', '<img src=x>', 'E9"9', 'E99;X', 'E99,X', '+E99', 'É9', 'x'.repeat(OFF_TAK_CALLSIGN_MAX + 1)]) {
        assert.notEqual(offTakCallsignProblem(bad), '', JSON.stringify(bad));
    }
    assert.equal(offTakCallsign('  Medic   5 '), 'Medic 5');
    assert.equal(offTakCallsign('E99\nX'), 'E99 X', 'a line break is one space');
});

test('its id is made from the callsign in upper case, so one callsign is one unit', () => {
    assert.equal(offTakUid('e99'), 'offtak:E99');
    assert.equal(offTakUid('Medic   5'), 'offtak:MEDIC 5');
    assert.deepEqual(offTakUnit(' e99 '), { uid: 'offtak:E99', callsign: 'e99', off_tak: true });
    assert.equal(OFF_TAK_PREFIX, 'offtak:');
});

test('a unit is not on TAK only with the flag AND the id the server makes; a TAK unit never is', () => {
    assert.equal(isOffTak(off), true);
    assert.equal(isOffTak(tak), false);
    assert.equal(isOffTak({ uid: 'offtak:X' }), false, 'no flag');
    assert.equal(isOffTak({ uid: 'ANDROID-9', off_tak: true }), false, 'a flag on a TAK id');
    assert.deepEqual(onTak([tak, off]), [tak]);
    assert.equal(offTakTag(off), ' (not on TAK)');
    assert.equal(offTakTag(tak), '');
    assert.equal(OFF_TAK_LABEL, 'Not on TAK');
});

test('on the command line, +E99 names a unit not on TAK; a bare + or a plain word does not', () => {
    assert.equal(offTakWord('+E99'), 'E99');
    assert.equal(offTakWord('+'), null);
    assert.equal(offTakWord('E99'), null);
    assert.equal(offTakWord('E+9'), null);
});

test('it works like any unit on the board: status, one incident at a time, who is still working', () => {
    assert.equal(unitStatus(off as never), 'on_scene');
    assert.deepEqual([...workingUids([tak, off] as never)], ['ANDROID-1', 'offtak:E99']);
    const incidents = [{ id: 'i1', number: '26-014', status: 'active', assigned: [off] }, { id: 'i2', number: '26-015', status: 'active', assigned: [] }];
    // E99 is on 014, so it cannot be assigned to 015 until it is cleared there, same as a TAK unit
    assert.equal(busyUnits(incidents as never, 'i2').get(offTakUid('e99')), '014');
    assert.equal(respondingLine([tak, off] as never), 'Responding: E12, E99 (on scene)');
});

test('the incident list marks the units that are not on TAK', () => {
    assert.deepEqual(rowUnitList([tak, off, { ...off, uid: 'offtak:K9', callsign: 'K9', status: 'cleared' }] as never), [
        { callsign: 'E12', offTak: false }, { callsign: 'E99', offTak: true },
    ]);
    const row = src('components/IncidentRow.vue');
    assert.match(row, /rowUnitList\(props\.inc\.assigned\)/);
    assert.match(row, /v-if='u\.offTak'[\s\S]*?data-test='unit-off-tak'[\s\S]*?\{\{ OFF_TAK_LABEL \}\}/);
    assert.match(row, /:title='unitsTitle'/);
});

test('the report and the CSV say which units are not on TAK', () => {
    assert.equal(unitLine(off as never, t => t), `E99 (not on TAK) (on scene) assigned ${T1} · on scene ${T2}`);
    assert.equal(unitLine(tak as never, t => t), `E12 assigned ${T1}`);
    const incident = {
        id: 'i1', event_id: 'e1', number: '26-001', type: 'Fire', address: '1 Main St', lat: 1, lon: 2, dispatcher: 'D',
        details: null, report_number: null, callers: [], caller_name: null, caller_phone: null, status: 'active',
        assigned: [tak, off], notes: [], created_at: T1, closed_at: null,
    };
    const [header, row] = buildCsv([incident as never]).split('\r\n');
    assert.equal(header.split(',').pop(), 'units_not_on_tak');
    assert.ok(row.endsWith(',"E99"'), 'the last column holds the callsigns not on TAK');
    assert.match(row, /"E12; E99"/, 'they are still among the assigned units');
    assert.match(row, /E99 \(not on TAK\) \(on scene\) assigned/);
    assert.doesNotMatch(row, /E12 \(not on TAK\)/);
    const range = { start: new Date('2026-11-22T00:00:00Z'), end: new Date('2026-11-23T00:00:00Z') };
    const html = buildReportHtml({ name: 'E', prefix: '26', feed_name: 'feed', channel: null, status: 'active' } as never, [incident as never], buildStats([incident as never], range), [], range, 'me');
    assert.match(html, /E99 \(not on TAK\) \(on scene\) assigned/);
    // an incident with no such unit: the new CSV column is empty
    assert.ok(buildCsv([{ ...incident, assigned: [tak] } as never]).split('\r\n')[1].endsWith(',""'));
});

test('wiring: no message goes to a unit not on TAK, and the flag reaches the server', () => {
    const actions = src('lib/incident-actions.ts');
    assert.match(actions, /for \(const c of onTak\(units\)\) \{/, 'the assignment message');
    assert.match(actions, /for \(const c of onTak\(\(updated\.assigned \?\? \[\]\)\.filter\(u => unitStatus\(u\) !== 'cleared'\)\)\) \{/, 'the note message');
    assert.match(actions, /isOffTak\(c\)\s+\? \{ uid: c\.uid, callsign: c\.callsign, off_tak: true \}/);
    assert.match(src('lib/events-client.ts'), /units: \{ uid: string; callsign: string; off_tak\?: boolean \}\[\]/);
    assert.match(src('lib/events-client.ts'), /off_tak\?: boolean;/);
});

test('wiring: the incident panel offers a callsign not found among the contacts, and badges the unit', () => {
    const d = src('components/IncidentDetail.vue');
    assert.match(d, /v-if='\(filteredContacts\.length \|\| offTakCandidate\) && slContactSearch'/);
    assert.match(d, /data-test='assign-off-tak'[\s\S]*?@click='slAssignOffTak\(inc\)'/);
    assert.match(d, /v-if='isOffTak\(c\)'[\s\S]*?data-test='unit-off-tak'[\s\S]*?\{\{ OFF_TAK_LABEL \}\}/);
    // offered only for a usable callsign that no TAK contact has and the incident does not already have
    assert.match(d, /if \(!typed \|\| offTakCallsignProblem\(typed\)\) return '';\s+if \(allContacts\.value\.some\(c => c\.callsign\.trim\(\)\.toUpperCase\(\) === typed\.toUpperCase\(\)\)\) return '';\s+if \(workingUids\(inc\.value\?\.assigned\)\.has\(offTakUid\(typed\)\)\) return '';/);
    assert.match(d, /await assignAction\(slActions, inc, \[offTakUnit\(callsign\)\]\);/);
});

test('wiring: A +E99 on the command line, settled before anything is assigned', () => {
    const c = src('components/CommandLine.vue');
    assert.match(c, /import \{ offTakCallsign, offTakCallsignProblem, offTakTag, offTakUnit, offTakWord \} from '\.\.\/lib\/off-tak\.ts';/);
    assert.match(c, /const tak = typed\.filter\(w => offTakWord\(w\) === null\);/);
    assert.match(c, /const offTak = \[\.\.\.new Map\(typed\.flatMap\(w => \(offTakWord\(w\) === null \? \[\] : \[offTakFor\(offTakWord\(w\) as string\)\]\)\)/);
    assert.match(c, /is on TAK: type A \$\{c\}, without the \+\./);
    assert.match(c, /To put a unit that is not on TAK on the incident: A \+\$\{w\}/);
    // the line under the box reads +E99 before Enter
    assert.match(c, /const plus = offTakWord\(w\);/);
    // the list (?) tells the dispatcher
    assert.match(c, /A unit that is not on TAK: put a \+ before its callsign, A \+E99\./);
    // On Scene, Clear and remove find it among the incident's own units, so they need nothing new
    assert.match(c, /unitRows\(p\.incident \? \[target\(p\)\] : store\.incidents, want\)/);
});
