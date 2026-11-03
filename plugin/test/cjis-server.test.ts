// Proof tests for the CJIS reminder settings. Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// Server side: the pure logic between `// <cjis-pure>` markers in server/plugin-dispatcher.ts is cut
// out of the real file and run (the admin check itself is CloudTAK's Auth and is not testable here).
// Plugin side: lib/cjis-reminder.ts's cjisReminderFrom() is cut out the same way (its std import
// needs a CloudTAK tree). Both are the code that ships, not a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const server = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = server.slice(server.indexOf('// <cjis-pure>'), server.indexOf('// </cjis-pure>'));
assert.ok(block.includes('function normCjisSetting'), 'could not find the cjis block in the server file');

const lib = readFileSync(new URL('../lib/cjis-reminder.ts', import.meta.url), 'utf8');
const libBody = lib.slice(lib.indexOf('export const CJIS_REMINDER_DEFAULT_TEXT'), lib.indexOf('// Whether the signed-in user'));
assert.ok(libBody.includes('export function cjisReminderFrom'), 'could not find cjisReminderFrom in the plugin lib');

const dir = mkdtempSync(join(tmpdir(), 'cjis-'));
const sfile = join(dir, 'server.ts');
writeFileSync(sfile, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${block}
export { isAdminOnlySetting, normCjisSetting, CJIS_REMINDER_DEFAULT_TEXT, CJIS_REMINDER_TEXT_MAX };
`);
const lfile = join(dir, 'lib.ts');
writeFileSync(lfile, libBody);
const s = await import(pathToFileURL(sfile).href);
const l = await import(pathToFileURL(lfile).href);

const refuses = (fn: () => unknown, status: number, re?: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === status && (!re || re.test(e.message ?? '')));

test('server and plugin agree on the default wording and the length cap', () => {
    assert.equal(s.CJIS_REMINDER_DEFAULT_TEXT, l.CJIS_REMINDER_DEFAULT_TEXT);
    assert.equal(s.CJIS_REMINDER_TEXT_MAX, l.CJIS_REMINDER_TEXT_MAX);
    assert.match(s.CJIS_REMINDER_DEFAULT_TEXT, /CJIS/);
});

test('only the two CJIS keys are admin-only; every other setting is unchanged', () => {
    assert.equal(s.isAdminOnlySetting('cjis_reminder_enabled'), true);
    assert.equal(s.isAdminOnlySetting('cjis_reminder_text'), true);
    for (const k of ['caller_on_markers', 'incident_types', 'agency', 'cjis', '']) {
        assert.equal(s.isAdminOnlySetting(k), false, k);
    }
});

test('the switch stores only a boolean', () => {
    assert.equal(s.normCjisSetting('cjis_reminder_enabled', false), false);
    assert.equal(s.normCjisSetting('cjis_reminder_enabled', true), true);
    refuses(() => s.normCjisSetting('cjis_reminder_enabled', 'off'), 400);
    refuses(() => s.normCjisSetting('cjis_reminder_enabled', null), 400);
});

test('the text is trimmed, a blank text stores the default, and too long is refused', () => {
    assert.equal(s.normCjisSetting('cjis_reminder_text', '  Keep CJIS out.  '), 'Keep CJIS out.');
    assert.equal(s.normCjisSetting('cjis_reminder_text', ''), s.CJIS_REMINDER_DEFAULT_TEXT);
    assert.equal(s.normCjisSetting('cjis_reminder_text', null), s.CJIS_REMINDER_DEFAULT_TEXT);
    assert.equal(s.normCjisSetting('cjis_reminder_text', 'x'.repeat(300)), 'x'.repeat(300));
    refuses(() => s.normCjisSetting('cjis_reminder_text', 'x'.repeat(301)), 400, /too long/);
    refuses(() => s.normCjisSetting('cjis_reminder_text', 42), 400);
});

test('other keys pass through normCjisSetting untouched', () => {
    assert.deepEqual(s.normCjisSetting('agency', { name: 'x' }), { name: 'x' });
});

test('plugin: no settings, an empty map, or an older server all mean on with the default text', () => {
    for (const input of [undefined, null, {}, { caller_on_markers: false }]) {
        assert.deepEqual(l.cjisReminderFrom(input), { enabled: true, text: l.CJIS_REMINDER_DEFAULT_TEXT });
    }
});

test('plugin: only an explicit false turns the reminder off; custom text is used, blank falls back', () => {
    assert.equal(l.cjisReminderFrom({ cjis_reminder_enabled: false }).enabled, false);
    assert.equal(l.cjisReminderFrom({ cjis_reminder_enabled: 'no' }).enabled, true);
    assert.equal(l.cjisReminderFrom({ cjis_reminder_text: '  Agency wording ' }).text, 'Agency wording');
    assert.equal(l.cjisReminderFrom({ cjis_reminder_text: '   ' }).text, l.CJIS_REMINDER_DEFAULT_TEXT);
    assert.equal(l.cjisReminderFrom({ cjis_reminder_text: 7 }).text, l.CJIS_REMINDER_DEFAULT_TEXT);
});
