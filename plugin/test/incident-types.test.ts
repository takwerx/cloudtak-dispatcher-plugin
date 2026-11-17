// Proof tests for the incident type list (Dispatcher Settings → Incident Types): what the New Incident
// dropdown offers with the admin's switch on and off, older saved lists, and the CSV file reader.
// Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// lib/incident-types.ts is pure, so this runs the file as it ships. The last test reads the two
// components' source to prove they are wired to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    DEFAULT_INCIDENT_TYPES, INCIDENT_TYPE_CODE_MAX, INCIDENT_TYPE_NAME_MAX, INCIDENT_TYPES_MAX,
    INCIDENT_TYPE_EXAMPLE_CSV,
    incidentTypeLabel, incidentTypeOptions, incidentTypeProblems, incidentTypesOnly, isIncidentTypeCode,
    parseIncidentTypeCsv, savedIncidentTypes,
} from '../lib/incident-types.ts';
import type { IncidentTypeOption } from '../lib/incident-types.ts';

const names = (list: IncidentTypeOption[]) => list.map(t => t.name);
const OWN = [{ code: 'MVA', name: 'Vehicle Crash' }, { code: '', name: 'Brush Fire' }];

test('no settings, or an older server: the built-in types, none with a code', () => {
    for (const s of [{}, { caller_on_markers: false }, { incident_types: 'junk' }, { incident_types: [] }]) {
        const list = incidentTypeOptions(s);
        assert.deepEqual(names(list), DEFAULT_INCIDENT_TYPES);
        assert.ok(list.every(t => t.code === ''));
    }
    assert.equal(DEFAULT_INCIDENT_TYPES.length, 17);
    assert.equal(DEFAULT_INCIDENT_TYPES[DEFAULT_INCIDENT_TYPES.length - 1], 'Other');
});

test('switch off: built-in types, then the admin\'s by name, then Other, as before', () => {
    const list = incidentTypeOptions({ incident_types: OWN });
    const builtIn = DEFAULT_INCIDENT_TYPES.filter(t => t !== 'Other');
    assert.deepEqual(names(list), [...builtIn, 'Brush Fire', 'Vehicle Crash', 'Other']);
    assert.equal(list.find(t => t.name === 'Vehicle Crash')?.code, 'MVA');
    // anything but true is off
    for (const off of [false, 'true', 1, null]) {
        assert.equal(incidentTypeOptions({ incident_types: OWN, incident_types_only: off }).length, list.length);
    }
});

test('an older saved list of plain names still loads, as names with no code', () => {
    assert.deepEqual(savedIncidentTypes(['Brush Fire', 'Welfare check']), [
        { code: '', name: 'Brush Fire' }, { code: '', name: 'Welfare check' },
    ]);
    const list = incidentTypeOptions({ incident_types: ['Zebra Loose', 'Brush Fire'] });
    assert.deepEqual(names(list).slice(-3), ['Brush Fire', 'Zebra Loose', 'Other']);
    // a list with both shapes, and junk that is skipped rather than failing the read
    assert.deepEqual(savedIncidentTypes(['Brush Fire', { code: 'mva', name: ' Vehicle  Crash ' }, 7, null, { code: 'X' }, '']), [
        { code: '', name: 'Brush Fire' }, { code: 'MVA', name: 'Vehicle Crash' },
    ]);
});

test('a hand-edited list cannot put a name or a code in the dropdown twice', () => {
    assert.deepEqual(savedIncidentTypes([
        { code: 'A1', name: 'Alarm' }, { code: 'A2', name: 'alarm' }, { code: 'a1', name: 'Alarm Two' }, { code: 'B 1', name: 'Bad Code' },
    ]), [{ code: 'A1', name: 'Alarm' }, { code: '', name: 'Alarm Two' }, { code: '', name: 'Bad Code' }]);
});

test('switch on: only the admin\'s list, in the admin\'s order; no built-in type, no added Other', () => {
    const list = incidentTypeOptions({ incident_types: OWN, incident_types_only: true });
    assert.deepEqual(list, OWN);
    assert.equal(incidentTypesOnly({ incident_types_only: true }), true);
    assert.equal(incidentTypesOnly({}), false);
    assert.equal(incidentTypesOnly(undefined), false);
});

test('switch on with an empty list: the built-in types stay, so the dropdown is never empty', () => {
    for (const empty of [undefined, [], [''], 'junk']) {
        assert.deepEqual(names(incidentTypeOptions({ incident_types: empty, incident_types_only: true })), DEFAULT_INCIDENT_TYPES);
    }
});

test('switch off: a type named like a built-in one gives it its code and is not listed twice', () => {
    const list = incidentTypeOptions({ incident_types: [{ code: 'MVA', name: 'traffic accident' }, { code: 'OTH', name: 'Other' }] });
    assert.deepEqual(names(list), DEFAULT_INCIDENT_TYPES);
    assert.equal(list.find(t => t.name === 'Traffic Accident')?.code, 'MVA');
    assert.deepEqual(list[list.length - 1], { code: 'OTH', name: 'Other' });
});

test('the dropdown shows the code beside the name when there is one', () => {
    assert.equal(incidentTypeLabel({ code: 'MVA', name: 'Traffic Accident' }), 'MVA - Traffic Accident');
    assert.equal(incidentTypeLabel({ code: '', name: 'Welfare Check' }), 'Welfare Check');
});

test('a code is letters and digits only, no spaces, 8 at most', () => {
    assert.equal(INCIDENT_TYPE_CODE_MAX, 8);
    for (const ok of ['MVA', 'mva', '10', 'A1B2C3D4']) assert.equal(isIncidentTypeCode(ok), true, ok);
    for (const bad of ['', 'M VA', 'M-VA', 'A1B2C3D4E', 'MVA.', 'É1']) assert.equal(isIncidentTypeCode(bad), false, bad);
});

test('CSV: code and name per row, codes stored upper case, header and blank rows skipped', () => {
    const read = parseIncidentTypeCsv('\uFEFFCode,Name\r\nmva,Traffic Accident\r\n\r\n str , Structure  Fire \r\n,Welfare Check\r\nLift Assist\r\n');
    assert.deepEqual(read.errors, []);
    assert.deepEqual(read.types, [
        { code: 'MVA', name: 'Traffic Accident' },
        { code: 'STR', name: 'Structure Fire' },
        { code: '', name: 'Welfare Check' },
        { code: '', name: 'Lift Assist' },
    ]);
    // no header, bare newlines, no newline at the end, spreadsheet padding columns
    assert.deepEqual(parseIncidentTypeCsv('MVA,Traffic Accident,,\nMED,Medical').types, [
        { code: 'MVA', name: 'Traffic Accident' }, { code: 'MED', name: 'Medical' },
    ]);
});

test('CSV: quotes let a name hold a comma or a quote', () => {
    const read = parseIncidentTypeCsv('ALARM,"Alarm, Commercial"\nHOSE,"5"" Hose Down"\nSIZE,5" Line\n');
    assert.deepEqual(read.errors, []);
    assert.deepEqual(read.types.map(t => t.name), ['Alarm, Commercial', '5" Hose Down', '5" Line']);
});

test('CSV: a file separated by semicolons or tabs is read as code and name, never as names', () => {
    const want = [{ code: 'MVA', name: 'Traffic Accident' }, { code: 'STR', name: 'Structure Fire' }, { code: '', name: 'Welfare Check' }];
    assert.deepEqual(parseIncidentTypeCsv('Code;Name\r\nMVA;Traffic Accident\r\nstr;Structure Fire\r\n;Welfare Check\r\n'), { types: want, errors: [] });
    assert.deepEqual(parseIncidentTypeCsv('code\tname\nMVA\tTraffic Accident\nSTR\tStructure Fire\n\tWelfare Check\n'), { types: want, errors: [] });
    // a comma inside a name is then part of the name; a semicolon inside one needs quotes
    assert.deepEqual(parseIncidentTypeCsv('ALARM;Alarm, Commercial\nMVA;Traffic Accident\nHAZ;"Spill; Fuel"\n').types, [
        { code: 'ALARM', name: 'Alarm, Commercial' }, { code: 'MVA', name: 'Traffic Accident' }, { code: 'HAZ', name: 'Spill; Fuel' },
    ]);
    assert.match(parseIncidentTypeCsv('MVA;Traffic Accident\nSTR;Fire; Structure\n').errors[0], /^Row 2: more than two columns\. Put quotes around a name that has a semicolon in it\.$/);
    // a row with no separator in such a file is still a name with no code
    assert.deepEqual(parseIncidentTypeCsv('MVA;Traffic Accident\nSTR;Structure Fire\nLift Assist\n').types[2], { code: '', name: 'Lift Assist' });
});

test('CSV: a semicolon in a comma file, or in one name of a list of names, is not taken for a separator', () => {
    assert.deepEqual(parseIncidentTypeCsv('HAZ,Spill; Fuel\nMVA,Traffic Accident\n').types, [
        { code: 'HAZ', name: 'Spill; Fuel' }, { code: 'MVA', name: 'Traffic Accident' },
    ]);
    // one row of five has a semicolon: separator or part of the name? Named, not guessed.
    const unsure = parseIncidentTypeCsv('Alarm\nBurglary\nSpill; Fuel\nLift Assist\nWelfare Check\n');
    assert.deepEqual(unsure.types, []);
    assert.deepEqual(unsure.errors, ['Row 3: has a semicolon in it. Use a comma between the code and the name, or put quotes around a name that has a semicolon in it.']);
    assert.deepEqual(parseIncidentTypeCsv('Alarm\nBurglary\n"Spill; Fuel"\nLift Assist\nWelfare Check\n').types.map(t => t.name), [
        'Alarm', 'Burglary', 'Spill; Fuel', 'Lift Assist', 'Welfare Check',
    ]);
});

test('CSV: only a row of header words is skipped as the header', () => {
    // names only, under "name" or "type": no type called "name"
    for (const head of ['name', 'Name', 'TYPE', 'Incident Type', 'name,,']) {
        assert.deepEqual(parseIncidentTypeCsv(`${head}\nAlarm\nBurglary\n`).types.map(t => t.name), ['Alarm', 'Burglary'], head);
    }
    for (const head of ['code,name', 'Code,Type', 'CODE,Description', 'code,incident type', 'code;name', 'Code,Name,,']) {
        const sep = head.includes(';') ? ';' : ',';
        assert.deepEqual(parseIncidentTypeCsv(`${head}\nALRM${sep}Alarm\n`).types, [{ code: 'ALRM', name: 'Alarm' }], head);
    }
    // a real type whose code is CODE is a type, first row or not
    assert.deepEqual(parseIncidentTypeCsv('CODE,Code Blue\nMVA,Traffic Accident\n').types, [
        { code: 'CODE', name: 'Code Blue' }, { code: 'MVA', name: 'Traffic Accident' },
    ]);
    assert.deepEqual(parseIncidentTypeCsv('code,name\nCODE,Code Blue\n').types, [{ code: 'CODE', name: 'Code Blue' }]);
    // header words further down are types like any other, and so is a lone "code"
    assert.deepEqual(parseIncidentTypeCsv('Alarm\nName\n').types.map(t => t.name), ['Alarm', 'Name']);
    assert.deepEqual(parseIncidentTypeCsv('code\nAlarm\n').types.map(t => t.name), ['code', 'Alarm']);
});

test('the example file loads clean and shows a code, a comma in a name and a type with no code', () => {
    const read = parseIncidentTypeCsv(INCIDENT_TYPE_EXAMPLE_CSV);
    assert.deepEqual(read.errors, []);
    assert.equal(read.types.length, 5);
    assert.ok(read.types.some(t => t.code === '' && t.name));
    assert.ok(read.types.some(t => t.name.includes(',')));
});

test('CSV: a duplicated code or name refuses the whole file and names the rows', () => {
    const read = parseIncidentTypeCsv('code,name\nMVA,Traffic Accident\nFIRE,Fire\nmva,Vehicle Crash\nF2,fire\nMVA,Third\n');
    assert.deepEqual(read.types, []);
    assert.deepEqual(read.errors, [
        'Rows 2, 4 and 6: the code MVA is used more than once.',
        'Rows 3 and 5: the name "Fire" is used more than once.',
    ]);
});

test('CSV: a malformed code, a missing name, an unquoted comma and a long name are each named by row', () => {
    const read = parseIncidentTypeCsv([
        'code,name',
        'M VA,Traffic Accident',
        'TOOLONG99,Fire',
        'MED,',
        'STR,Fire, Structure',
        `LONG,${'x'.repeat(INCIDENT_TYPE_NAME_MAX + 1)}`,
        `OK,${'x'.repeat(INCIDENT_TYPE_NAME_MAX)}`,
    ].join('\n'));
    assert.deepEqual(read.types, []);
    assert.equal(read.errors.length, 5, 'in row order');
    assert.match(read.errors[0], /^Row 2: the code "M VA" must be letters and digits only/);
    assert.match(read.errors[1], /^Row 3: the code "TOOLONG99"/);
    assert.equal(read.errors[2], 'Row 4: the name is missing.');
    assert.match(read.errors[3], /^Row 5: more than two columns/);
    assert.equal(read.errors[4], `Row 6: the name is longer than ${INCIDENT_TYPE_NAME_MAX} characters.`);
});

test('CSV: an empty file, or one with only a header, says so; too many types is refused', () => {
    for (const empty of ['', '\n\n', 'code,name\n', ',\n,,\n']) {
        assert.deepEqual(parseIncidentTypeCsv(empty), { types: [], errors: ['No incident types were found in the file.'] });
    }
    const many = Array.from({ length: INCIDENT_TYPES_MAX + 1 }, (_, i) => `T${i},Type ${i}`).join('\n');
    assert.deepEqual(parseIncidentTypeCsv(many).errors, [`There are ${INCIDENT_TYPES_MAX + 1} types; ${INCIDENT_TYPES_MAX} is the most.`]);
    assert.equal(parseIncidentTypeCsv(many.slice(0, many.lastIndexOf('\n'))).types.length, INCIDENT_TYPES_MAX);
});

test('a list checked without a file numbers the types by their place', () => {
    assert.deepEqual(incidentTypeProblems([{ code: 'A', name: 'One' }, { code: '', name: 'Two' }]), []);
    assert.deepEqual(incidentTypeProblems([{ code: 'A', name: 'One' }, { code: 'a', name: 'one' }]), [
        'Rows 1 and 2: the code A is used more than once.',
        'Rows 1 and 2: the name "One" is used more than once.',
    ]);
});

test('wiring: the list lives in the shared store, built by this file, so the form knows it when it opens', () => {
    const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    // starts as the built-in list, typed as the contract says
    const store = src('lib/dispatcher-store.ts');
    assert.match(store, /incidentTypes: {2}IncidentTypeOption\[\];/);
    assert.match(store, /incidentTypes: {2}incidentTypeOptions\(\{\}\),/);
    // set when the board starts and when an incident opens (refreshSharedSettings), by the form when it
    // opens, and by the Settings card: when it loads, and after a saved list or switch
    const fromSettings = /dispatcherStore\.incidentTypes = incidentTypeOptions\(s\);/;
    assert.match(src('lib/incident-poll.ts').slice(src('lib/incident-poll.ts').indexOf('export function refreshSharedSettings')), fromSettings);
    const form = src('components/IncidentForm.vue');
    assert.match(form, fromSettings);
    const card = src('components/IncidentTypesSettings.vue');
    assert.match(card, /function shareTypes\(\) \{\s+dispatcherStore\.incidentTypes = incidentTypeOptions\(\{\s+\[INCIDENT_TYPES_SETTING\]: types\.value,\s+\[INCIDENT_TYPES_ONLY_SETTING\]: only\.value,/);
    assert.match(card, /await putDispatcherSetting\(INCIDENT_TYPES_SETTING, next\);\s+types\.value = next;\s+shareTypes\(\);/);
    assert.match(card, /await putDispatcherSetting\(INCIDENT_TYPES_ONLY_SETTING, want\);\s+shareTypes\(\);/);
    assert.equal(card.split('shareTypes();').length - 1, 3);
});

test('wiring: the New Incident form builds its dropdown from the store, and Settings has one card for it', () => {
    const form = readFileSync(new URL('../components/IncidentForm.vue', import.meta.url), 'utf8');
    assert.match(form, /return props\.serverMode === 'standalone' \? dispatcherStore\.incidentTypes : incidentTypeOptions\(\{\}\);/);
    assert.match(form, /\{\{ incidentTypeLabel\(t\) \}\}/);
    assert.ok(!form.includes('DEFAULT_INCIDENT_TYPES'), 'the form must not build its own list');
    // the first offered type is preselected at once (no wait for the settings), a type already set and
    // offered is kept, and a refresh that takes the selected type away moves to the first one offered
    assert.ok(!/await typesReady|await getDispatcherSettings/.test(form), 'the form must not wait for the settings');
    assert.match(form, /\} else if \(!typeOptions\.value\.some\(t => t\.name === form\.incidentType\)\) \{[^}]*form\.incidentType = typeOptions\.value\[0\]\?\.name \?\? '';/);
    assert.match(form, /watch\(typeOptions, \(list\) => \{\s+if \(props\.serverMode !== 'standalone' \|\| !form\.incidentType \|\| !list\.length\) return;\s+if \(!list\.some\(t => t\.name === form\.incidentType\)\) form\.incidentType = list\[0\]\.name;/);
    // TAK-CAD mode keeps its server-provided list
    assert.match(form, /props\.serverMode === 'takcad' && props\.incidentTypes\.length/);
    const settings = readFileSync(new URL('../components/DispatcherSettings.vue', import.meta.url), 'utf8');
    assert.equal(settings.split('<IncidentTypesSettings').length - 1, 1);
    assert.ok(!settings.includes("putDispatcherSetting('incident_types'"), 'one place edits the list');
    const card = readFileSync(new URL('../components/IncidentTypesSettings.vue', import.meta.url), 'utf8');
    assert.equal(card.split(":disabled='!isAdmin").length - 1, 5, 'switch, file, code, name and Add are admin only');
    assert.match(card, /v-if='isAdmin'[^>]*>?[\s\S]{0,400}removeType\(t\)/);
});
