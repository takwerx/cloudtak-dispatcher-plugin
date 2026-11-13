// Proof tests for the incident type settings on the server. Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The pure logic between `// <incident-types-pure>` markers (and the admin-only key list between
// `// <cjis-pure>`) in server/plugin-dispatcher.ts is cut out of the real file and run; the admin
// check itself is CloudTAK's Auth and is not testable here. The plugin's own rules
// (lib/incident-types.ts, pure) are imported as they ship, to prove both sides agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from '../lib/incident-types.ts';

const server = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const cut = (name: string) => server.slice(server.indexOf(`// <${name}>`), server.indexOf(`// </${name}>`));
const block = cut('incident-types-pure');
assert.ok(block.includes('function normIncidentTypeSetting'), 'could not find the incident types block in the server file');

const dir = mkdtempSync(join(tmpdir(), 'incident-types-'));
const sfile = join(dir, 'server.ts');
writeFileSync(sfile, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${cut('cjis-pure')}
${block}
export { isAdminOnlySetting, normIncidentTypeSetting, INCIDENT_TYPE_KEYS, INCIDENT_TYPE_CODE_MAX, INCIDENT_TYPE_NAME_MAX, INCIDENT_TYPES_MAX };
`);
const s = await import(pathToFileURL(sfile).href);

const refuses = (fn: () => unknown, status: number, re?: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === status && (!re || re.test(e.message ?? '')));
const norm = (v: unknown) => s.normIncidentTypeSetting('incident_types', v);

test('server and plugin agree on the setting names and the caps', () => {
    assert.deepEqual([...s.INCIDENT_TYPE_KEYS].sort(), [lib.INCIDENT_TYPES_SETTING, lib.INCIDENT_TYPES_ONLY_SETTING].sort());
    assert.equal(s.INCIDENT_TYPE_CODE_MAX, lib.INCIDENT_TYPE_CODE_MAX);
    assert.equal(s.INCIDENT_TYPE_NAME_MAX, lib.INCIDENT_TYPE_NAME_MAX);
    assert.equal(s.INCIDENT_TYPES_MAX, lib.INCIDENT_TYPES_MAX);
});

test('the list and its switch are admin-only', () => {
    assert.equal(s.isAdminOnlySetting('incident_types'), true);
    assert.equal(s.isAdminOnlySetting('incident_types_only'), true);
    assert.equal(s.isAdminOnlySetting('incident_type'), false);
});

test('the route sends both keys through the check, after the admin check', () => {
    const route = server.slice(server.indexOf("schema.put('/dispatcher/settings/:key'"), server.indexOf('// ── Events ──'));
    assert.match(route, /if \(!user\.is_admin\(\)\) throw[\s\S]*INCIDENT_TYPE_KEYS\.has\(req\.params\.key\)\) value = normIncidentTypeSetting\(req\.params\.key, value\);/);
});

test('the switch stores only a boolean', () => {
    assert.equal(s.normIncidentTypeSetting('incident_types_only', true), true);
    assert.equal(s.normIncidentTypeSetting('incident_types_only', false), false);
    refuses(() => s.normIncidentTypeSetting('incident_types_only', 'on'), 400);
    refuses(() => s.normIncidentTypeSetting('incident_types_only', null), 400);
});

test('a list is stored as code and name: codes upper case, names trimmed, no code as empty text', () => {
    assert.deepEqual(norm([{ code: 'mva', name: ' Traffic  Accident ' }, { name: 'Welfare Check' }, { code: null, name: 'Fire' }, { code: ' ', name: 'Alarm' }]), [
        { code: 'MVA', name: 'Traffic Accident' },
        { code: '', name: 'Welfare Check' },
        { code: '', name: 'Fire' },
        { code: '', name: 'Alarm' },
    ]);
    assert.deepEqual(norm([]), []);
});

test('a list of plain names, as an older plugin sends it, is still accepted: names with no code', () => {
    assert.deepEqual(norm(['Brush Fire', 'Welfare check']), [{ code: '', name: 'Brush Fire' }, { code: '', name: 'Welfare check' }]);
    assert.deepEqual(norm(['Brush Fire', { code: 'MVA', name: 'Crash' }]), [{ code: '', name: 'Brush Fire' }, { code: 'MVA', name: 'Crash' }]);
});

test('what the server stores is what the plugin reads back', () => {
    const stored = norm([{ code: 'mva', name: 'Traffic Accident' }, 'Brush Fire']);
    assert.deepEqual(lib.savedIncidentTypes(stored), stored);
    assert.deepEqual(lib.incidentTypeProblems(stored as lib.IncidentTypeOption[]), []);
});

test('a duplicated code or name refuses the whole list, ignoring case', () => {
    refuses(() => norm([{ code: 'MVA', name: 'One' }, { code: 'mva', name: 'Two' }]), 400, /Code MVA is used twice/);
    refuses(() => norm([{ code: 'A', name: 'Fire' }, { code: 'B', name: 'FIRE' }]), 400, /"FIRE" is in the list twice/);
    refuses(() => norm(['Fire', 'fire']), 400, /twice/);
    // two types with no code are fine
    assert.equal((norm(['One', 'Two']) as unknown[]).length, 2);
});

test('a malformed code, a missing name, a long name and junk are refused', () => {
    for (const code of ['M VA', 'M-VA', 'A1B2C3D4E', 'É1']) {
        refuses(() => norm([{ code, name: 'X' }]), 400, /letters and digits only/);
    }
    assert.deepEqual(norm([{ code: 'A1B2C3D4', name: 'X' }]), [{ code: 'A1B2C3D4', name: 'X' }]);
    refuses(() => norm([{ code: 'A', name: '  ' }]), 400, /no name/);
    refuses(() => norm(['']), 400, /no name/);
    refuses(() => norm([{ code: 'A' }]), 400);
    refuses(() => norm([7]), 400);
    refuses(() => norm([null]), 400);
    refuses(() => norm([{ code: 7, name: 'X' }]), 400);
    refuses(() => norm([{ code: 'A', name: 'x'.repeat(s.INCIDENT_TYPE_NAME_MAX + 1) }]), 400, /too long/);
    assert.equal((norm([{ code: 'A', name: 'x'.repeat(s.INCIDENT_TYPE_NAME_MAX) }]) as unknown[]).length, 1);
});

test('not a list, or too many types, is refused', () => {
    refuses(() => norm('Fire'), 400, /must be a list/);
    refuses(() => norm(null), 400, /must be a list/);
    refuses(() => norm({ code: 'A', name: 'X' }), 400, /must be a list/);
    const many = Array.from({ length: s.INCIDENT_TYPES_MAX + 1 }, (_, i) => `Type ${i}`);
    refuses(() => norm(many), 400, /Too many/);
    assert.equal((norm(many.slice(1)) as unknown[]).length, s.INCIDENT_TYPES_MAX);
});
