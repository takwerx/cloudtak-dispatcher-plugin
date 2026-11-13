// Proof tests for the Dispatcher command line: how a typed line is read, and which unit, incident type or
// disposition a typed word names. Plain node: lib/command-line.ts has no imports, so it is loaded as it ships.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from '../lib/command-line.ts';

function memStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem:    (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem:    (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
    };
}

const unit = (callsign: string) => ({ uid: callsign, callsign });
const names = (list: { callsign: string }[]) => list.map(u => u.callsign);

test('a line is an optional incident number, a verb, then the rest', () => {
    assert.deepEqual(m.parseLine('14 a H35 E6'), { incident: '14', verb: 'A', rest: 'H35 E6' });
    assert.deepEqual(m.parseLine('o h35'), { incident: null, verb: 'O', rest: 'h35' });
    assert.deepEqual(m.parseLine('  014   X   unf  '), { incident: '014', verb: 'X', rest: 'unf' });
    assert.deepEqual(m.parseLine('wx all'), { incident: null, verb: 'WX', rest: 'all' });
    assert.deepEqual(m.parseLine('?'), { incident: null, verb: '?', rest: '' });
    assert.equal(m.parseLine('   '), null);
});

test('a number alone opens that incident', () => {
    assert.deepEqual(m.parseLine('14'), { incident: '14', verb: '', rest: '' });
});

test('nothing after the verb is read as an incident: digit callsigns and notes that start with a number', () => {
    assert.deepEqual(m.parseLine('A 2141 2142'), { incident: null, verb: 'A', rest: '2141 2142' });
    assert.deepEqual(m.parseLine('T 2 patients, one trapped'), { incident: null, verb: 'T', rest: '2 patients, one trapped' });
    assert.deepEqual(m.parseLine('14 T 2 patients'), { incident: '14', verb: 'T', rest: '2 patients' });
    // No space between the verb and a number still reads as the verb.
    assert.deepEqual(m.parseLine('T2 patients'), { incident: null, verb: 'T', rest: '2 patients' });
});

test('an unknown verb is an error that names it, and never runs', () => {
    const r = m.parseLine('14 ZZ H35');
    assert.ok(r && 'error' in r);
    assert.match(r.error, /^ZZ is not a command/);
    const typo = m.parseLine('OH35');
    assert.ok(typo && 'error' in typo);
    const junk = m.parseLine('14 ; drop');
    assert.ok(junk && 'error' in junk);
});

test('every listed command parses, and the list has no verb twice', () => {
    const verbs = m.COMMANDS.map(c => c.verb);
    assert.equal(new Set(verbs).size, verbs.length);
    for (const c of m.COMMANDS) {
        const r = m.parseLine(c.example);
        assert.ok(r && !('error' in r), c.example);
        assert.equal(r.verb, c.verb, c.example);
    }
});

test('incident numbers: leading zeros do not matter, the event prefix is not typed', () => {
    const list = [{ number: '26-014' }, { number: '26-140' }, { number: '26-004' }];
    assert.equal(m.findIncident(list, '14')?.number, '26-014');
    assert.equal(m.findIncident(list, '014')?.number, '26-014');
    assert.equal(m.findIncident(list, '140')?.number, '26-140');
    assert.equal(m.findIncident(list, '4')?.number, '26-004');
    assert.equal(m.findIncident(list, '1'), undefined);
    assert.equal(m.findIncident(list, '0'), undefined);
});

test('a callsign splits into parts on hyphens, slashes and spaces', () => {
    assert.deepEqual(m.callsignParts('AGY-Name-H202'), ['AGY', 'NAME', 'H202']);
    assert.deepEqual(m.callsignParts('AGY-Name-X35/D13'), ['AGY', 'NAME', 'X35', 'D13']);
    assert.deepEqual(m.callsignParts('D7'), ['D7']);
    assert.deepEqual(m.callsignParts('Engine 21'), ['ENGINE', '21']);
});

test('the radio ID alone names the unit, in any case', () => {
    const units = [unit('AGY-Alpha-H202'), unit('AGY-Bravo-H325'), unit('AGY-Charlie-X35/D13'), unit('D7'), unit('AGY-Delta-E6')];
    assert.deepEqual(names(m.matchUnits('h202', units).exact), ['AGY-Alpha-H202']);
    assert.deepEqual(names(m.matchUnits('D13', units).exact), ['AGY-Charlie-X35/D13']);
    assert.deepEqual(names(m.matchUnits('x35', units).exact), ['AGY-Charlie-X35/D13']);
    assert.deepEqual(names(m.matchUnits('D7', units).exact), ['D7']);
    assert.deepEqual(names(m.matchUnits('e6', units).exact), ['AGY-Delta-E6']);
});

test('the last name, the name with the ID, and the whole callsign also name it', () => {
    const units = [unit('AGY-Alpha-H35'), unit('AGY-Bravo-H35')];
    assert.deepEqual(names(m.matchUnits('bravo', units).exact), ['AGY-Bravo-H35']);
    assert.deepEqual(names(m.matchUnits('alpha-h35', units).exact), ['AGY-Alpha-H35']);
    assert.deepEqual(names(m.matchUnits('AGY-Bravo-H35', units).exact), ['AGY-Bravo-H35']);
    // Parts must be next to each other and in order.
    assert.deepEqual(m.matchUnits('agy-h35', units).exact, []);
});

test('the same radio ID on two units gives both, for a numbered list: never a guess', () => {
    const units = [unit('AGY-Alpha-H35'), unit('AGY-Bravo-H35'), unit('AGY-Charlie-H350')];
    const r = m.matchUnits('H35', units);
    assert.deepEqual(names(r.exact), ['AGY-Alpha-H35', 'AGY-Bravo-H35']);
    assert.deepEqual(names(r.partial), ['AGY-Charlie-H350']);
});

test('part of an ID is never an exact match: it only lists', () => {
    const units = [unit('AGY-Alpha-H202'), unit('AGY-Bravo-H210'), unit('D7'), unit('AGY-Charlie-D13')];
    const r = m.matchUnits('H2', units);
    assert.deepEqual(r.exact, []);
    assert.deepEqual(names(r.partial), ['AGY-Alpha-H202', 'AGY-Bravo-H210']);
    // D7 and D13 stay apart.
    assert.deepEqual(names(m.matchUnits('D1', units).partial), ['AGY-Charlie-D13']);
    assert.deepEqual(m.matchUnits('', units), { exact: [], partial: [] });
});

test('an incident type is named by its code first', () => {
    const types = [
        { code: 'MVA', name: 'Traffic Accident' },
        { code: 'MED', name: 'Medical Emergency' },
        { code: '', name: 'Medical Assist' },
    ];
    assert.deepEqual(m.matchOptions('mva', types).map(t => t.name), ['Traffic Accident']);
    // The code wins over a name that starts with the same letters.
    assert.deepEqual(m.matchOptions('MED', types).map(t => t.name), ['Medical Emergency']);
});

test('with no code: the whole name, then the start of the name, then word starts', () => {
    const types = ['Medical Emergency', 'Medical Assist', 'Fire', 'Traffic Accident', 'Gas Leak'].map(name => ({ name }));
    assert.deepEqual(m.matchOptions('fire', types).map(t => t.name), ['Fire']);
    assert.deepEqual(m.matchOptions('med', types).map(t => t.name), ['Medical Emergency', 'Medical Assist']);
    assert.deepEqual(m.matchOptions('med em', types).map(t => t.name), ['Medical Emergency']);
    assert.deepEqual(m.matchOptions('acc', types).map(t => t.name), ['Traffic Accident']);
    assert.deepEqual(m.matchOptions('leak', types).map(t => t.name), ['Gas Leak']);
    assert.deepEqual(m.matchOptions('zzz', types), []);
    assert.deepEqual(m.matchOptions('  ', types), []);
});

test('dispositions: "rep" is Report, "no" is Cleared - No Report, "c" is a choice of two', () => {
    const d = ['Cleared - No Report', 'Report', 'Unfounded', 'Warning', 'Gone on Arrival', 'Canceled', 'Other'].map(name => ({ name }));
    assert.deepEqual(m.matchOptions('rep', d).map(o => o.name), ['Report']);
    assert.deepEqual(m.matchOptions('no', d).map(o => o.name), ['Cleared - No Report']);
    assert.deepEqual(m.matchOptions('unf', d).map(o => o.name), ['Unfounded']);
    assert.deepEqual(m.matchOptions('gone', d).map(o => o.name), ['Gone on Arrival']);
    assert.deepEqual(m.matchOptions('c', d).map(o => o.name), ['Cleared - No Report', 'Canceled']);
});

test('a caller is name, phone, note; a first field of digits is the phone', () => {
    assert.deepEqual(m.parseCaller('J Smith, 555-0100, sees smoke, from the rear'),
        { name: 'J Smith', phone: '555-0100', note: 'sees smoke, from the rear' });
    assert.deepEqual(m.parseCaller('555-0100, would not give a name'),
        { name: '', phone: '555-0100', note: 'would not give a name' });
    assert.deepEqual(m.parseCaller('J Smith'), { name: 'J Smith', phone: '', note: '' });
    assert.deepEqual(m.parseCaller(''), { name: '', phone: '', note: '' });
});

test('a new incident is the type, then the address after the first comma', () => {
    assert.deepEqual(m.parseNew('fire, 120 main st, springfield'), { type: 'fire', address: '120 main st, springfield' });
    assert.deepEqual(m.parseNew('fire'), { type: 'fire', address: '' });
    assert.deepEqual(m.parseNew(', 120 main'), { type: '', address: '120 main' });
    assert.deepEqual(m.parseNew(''), { type: '', address: '' });
});

test('hidden unless turned on at this computer, and remembered', () => {
    const s = memStorage();
    assert.equal(m.loadCommandLine(s), false);
    m.saveCommandLine(true, s);
    assert.equal(s.map.get(m.COMMAND_LINE_KEY), 'on');
    assert.equal(m.loadCommandLine(s), true);
    m.saveCommandLine(false, s);
    assert.equal(s.map.has(m.COMMAND_LINE_KEY), false);
    assert.equal(m.loadCommandLine(s), false);
});

test('history keeps the newest last, skips an immediate repeat and empty lines, and is capped', () => {
    let h: string[] = [];
    h = m.pushHistory(h, 'O H35');
    h = m.pushHistory(h, 'O H35');
    h = m.pushHistory(h, '  ');
    h = m.pushHistory(h, 'C H35');
    assert.deepEqual(h, ['O H35', 'C H35']);
    for (let i = 0; i < m.HISTORY_MAX + 5; i++) h = m.pushHistory(h, `T note ${i}`);
    assert.equal(h.length, m.HISTORY_MAX);
    assert.equal(h[h.length - 1], `T note ${m.HISTORY_MAX + 4}`);
});

test('the README table shows every command, by the same example the list (?) shows', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const section = readme.slice(readme.indexOf('### Command line (standalone)'), readme.indexOf('### Delivery to field units'));
    assert.ok(section.length > 0);
    for (const c of m.COMMANDS) assert.ok(section.includes(`| \`${c.example}\` |`), c.example);
});

// ── Running a command: which incident, which units, in what order ────────────────────────────────────

const board = [
    { id: 'a', number: '26-014', status: 'active', assigned: [
        { uid: 'u1', callsign: 'AGY-Alpha-H35', status: 'assigned' },
        { uid: 'u2', callsign: 'AGY-Echo-E6', status: 'on_scene' },
        { uid: 'u3', callsign: 'AGY-Old-K1', status: 'cleared' },
    ] },
    { id: 'b', number: '26-015', status: 'active', assigned: [{ uid: 'u4', callsign: 'AGY-Bravo-H202' }] },
    { id: 'c', number: '26-009', status: 'closed', assigned: [{ uid: 'u5', callsign: 'AGY-Gone-Z9', status: 'assigned' }] },
] as unknown as Parameters<typeof m.unitRows>[0];

const line = (text: string) => m.parseLine(text) as m.ParsedLine;

test('the incident a command is for: the number typed first, else the one being worked, else an error', () => {
    assert.equal((m.targetIncident(board, line('15 T x'), 'a') as { id: string }).id, 'b');
    assert.equal((m.targetIncident(board, line('T x'), 'a') as { id: string }).id, 'a');
    assert.deepEqual(m.targetIncident(board, line('77 T x'), 'a'), { error: 'No incident 77 in this event.' });
    assert.deepEqual(m.targetIncident(board, line('T x'), null), { error: 'Which incident? Put its number first: 14 T x' });
    // The incident being worked has left the board: it is not guessed at.
    assert.ok('error' in m.targetIncident(board, line('T x'), 'gone'));
});

test('status commands see only units still on an open incident', () => {
    assert.deepEqual(m.unitRows(board, 'assigned').map(r => r.callsign), ['AGY-Alpha-H35', 'AGY-Bravo-H202']);
    assert.deepEqual(m.unitRows(board, 'working').map(r => r.callsign), ['AGY-Alpha-H35', 'AGY-Echo-E6', 'AGY-Bravo-H202']);
    assert.equal(m.unitRows(board, 'working').find(r => r.callsign === 'AGY-Bravo-H202')?.inc.number, '26-015');
});

test('one unit named exactly is the answer; several, or a partial fit, are asked about; nothing is none', () => {
    const units = [unit('AGY-Alpha-H35'), unit('AGY-Bravo-H35'), unit('AGY-Charlie-H202')];
    assert.deepEqual(m.pickUnit('h202', units), { kind: 'one', unit: units[2] });
    assert.deepEqual(m.pickUnit('h35', units), { kind: 'ask', options: [units[0], units[1]] });
    assert.deepEqual(m.pickUnit('h2', units), { kind: 'ask', options: [units[2]] });
    assert.deepEqual(m.pickUnit('zz', units), { kind: 'none' });
});

test('every word on the line is settled before anything is done: one wrong word and nothing is changed', async () => {
    const units = [unit('AGY-Alpha-H35'), unit('AGY-Echo-E6')];
    const acted: string[] = [];
    const run = async (typed: string[]) => {
        const chosen = await m.resolveUnits(typed, units, {
            ask:  async () => { throw new Error('asked'); },
            none: w => new Error(`No unit "${w}"`),
        });
        return m.actOnEach(chosen, async (u) => { acted.push(u.callsign); return `${u.callsign} done`; });
    };
    // "c h35 is out": a note typed without its T. H35 must NOT be cleared.
    await assert.rejects(run(['h35', 'is', 'out']), /No unit "is"/);
    assert.deepEqual(acted, []);
    assert.deepEqual(await run(['h35', 'e6', 'H35']), ['AGY-Alpha-H35 done', 'AGY-Echo-E6 done']);
    assert.deepEqual(acted, ['AGY-Alpha-H35', 'AGY-Echo-E6']);
});

test('a word that fits two units is asked about, and cancelling the question stops the whole line', async () => {
    const units = [unit('AGY-Alpha-H35'), unit('AGY-Bravo-H35'), unit('AGY-Echo-E6')];
    const asked: string[] = [];
    const chosen = await m.resolveUnits(['e6', 'h35'], units, {
        ask:  async (w, options) => { asked.push(`${w}:${options.length}`); return options[1]; },
        none: w => new Error(w),
    });
    assert.deepEqual(asked, ['h35:2']);
    assert.deepEqual(names(chosen), ['AGY-Echo-E6', 'AGY-Bravo-H35']);
    await assert.rejects(m.resolveUnits(['e6', 'h35'], units, {
        ask:  async () => { throw new Error('cancelled'); },
        none: w => new Error(w),
    }), /cancelled/);
});

test('when the server refuses a later unit, the error says what was done and what was not', async () => {
    const units = [unit('AGY-Alpha-H35'), unit('AGY-Echo-E6')];
    const act = async (u: { callsign: string }) => {
        if (u.callsign.endsWith('E6')) throw new Error('refused');
        return `${u.callsign} On Scene`;
    };
    await assert.rejects(m.actOnEach(units, act), /^Error: Done: AGY-Alpha-H35 On Scene\. Not done: AGY-Echo-E6 \(refused\)$/);
    // The first one failing is just its own error: nothing was done.
    await assert.rejects(m.actOnEach([units[1]], act), /^Error: refused$/);
});

test('X: a disposition by the start of its words, Other with its text, a list when unclear', () => {
    const presets = ['Cleared - No Report', 'Report', 'Unfounded', 'Warning', 'Gone on Arrival', 'Canceled'];
    const read = (rest: string) => m.readDisposition(rest, presets, 'Other');
    assert.deepEqual(read('unf'), { disposition: 'Unfounded', note: '' });
    assert.deepEqual(read('rep'), { disposition: 'Report', note: '' });
    assert.deepEqual(read('Report'), { disposition: 'Report', note: '' });
    assert.deepEqual(read('other lost contact with caller'), { disposition: 'Other', note: 'lost contact with caller' });
    assert.deepEqual(read('o lost contact'), { disposition: 'Other', note: 'lost contact' });
    assert.ok('error' in read('other'));
    assert.ok('error' in read('nonsense'));
    assert.deepEqual(read('c'), { ask: ['Cleared - No Report', 'Canceled'] });
    assert.deepEqual(read(''), { ask: [...presets, 'Other'] });
    // "on" is a word of Gone on Arrival, not the start of Other.
    assert.deepEqual(read('on'), { disposition: 'Gone on Arrival', note: '' });
});

test('a caller with no phone: what follows the name is the note, never stored as the phone', () => {
    assert.deepEqual(m.parseCaller('J Smith, sees smoke from the rear'),
        { name: 'J Smith', phone: '', note: 'sees smoke from the rear' });
    assert.deepEqual(m.parseCaller('J Smith, 3 cars involved, one on its side'),
        { name: 'J Smith', phone: '', note: '3 cars involved, one on its side' });
    assert.deepEqual(m.parseCaller('J Smith, apartment 302'), { name: 'J Smith', phone: '', note: 'apartment 302' });
    assert.deepEqual(m.parseCaller('J Smith, 555 0100 ext 4, at work'),
        { name: 'J Smith', phone: '555 0100 ext 4', note: 'at work' });
});

test('wiring: the command line settles units first, and a note is sent as its text alone', () => {
    const cmd = readFileSync(new URL('../components/CommandLine.vue', import.meta.url), 'utf8');
    // On Scene / Clear / remove / Assign all go through resolveUnits before any action is called.
    assert.equal((cmd.match(/await resolveUnits\(/g) ?? []).length, 3);
    assert.match(cmd, /const done = await actOnEach\(rows, async \(row\) => \{\s+await unitStatusAction\(/);
    assert.doesNotMatch(cmd, /patchIncident|setUnitStatus\(|assignUnits\(/);
    const actions = readFileSync(new URL('../lib/incident-actions.ts', import.meta.url), 'utf8');
    assert.match(actions, /patchIncident\(inc\.id, \{ note_add: text \}\)/);
    assert.match(actions, /\{ note_add: `Reopened: \$\{why\}` \}/);
    // The window in front is the incident being worked; one that came back after a reload is not.
    const panes = readFileSync(new URL('../lib/undock-panes.ts', import.meta.url), 'utf8');
    assert.match(panes, /export function raiseCard[^}]+touchIncidentView\(id\);/s);
    const detail = readFileSync(new URL('../components/IncidentDetail.vue', import.meta.url), 'utf8');
    assert.match(detail, /registerIncidentView\(props\.incidentId, [^;]+, !props\.floating\);/);
});

test('wiring: the header is one style: labelled buttons and links, no pills', () => {
    const main = readFileSync(new URL('../components/CadMain.vue', import.meta.url), 'utf8');
    // TAK-CAD is a link beside Sign out, in both its states; the event's three actions are one row.
    assert.equal((main.match(/data-test='takcad-toggle'/g) ?? []).length, 2);
    assert.doesNotMatch(main, /class='badge bg-(success|secondary) text-white small border-0'/);
    for (const name of ['switch-event', 'event-report', 'command-line-toggle']) {
        assert.match(main, new RegExp(`style='flex:1 1 0'\\s+title='[^']+'\\s+data-test='${name}'`));
    }
    // The incident a command is for sits inside the command box, not in a pill beside it.
    const cmd = readFileSync(new URL('../components/CommandLine.vue', import.meta.url), 'utf8');
    assert.match(cmd, /class='input-group-text font-monospace'[^>]+data-test='command-current'/s);
});
