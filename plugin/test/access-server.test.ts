// Proof tests for "who can use the Dispatcher" (setting `allowed_groups`, a list of TAK group names). Plain
// node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The gate sits between `// <access-gate>` markers, the same text in plugin-dispatcher.ts, plugin-addressing.ts
// and plugin-takcad.ts (CloudTAK loads each route file on its own, so they cannot share one). This test cuts
// the block out of each real file, checks the three are identical, stubs CloudTAK's Auth, the database and TAK
// Server around it, and runs it, so it tests the code that ships. A last group of tests reads the route files
// and fails if any route skips the gate (a new route that forgets it is the way a limit leaks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as a from '../lib/access.ts';

const FILES = ['server/plugin-dispatcher.ts', 'server/plugin-addressing.ts', 'server/plugin-takcad.ts'];
const src: Record<string, string> = {};
for (const f of FILES) src[f] = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const cut = (text: string, tag: string) => {
    const i = text.indexOf(`// <${tag}>`), j = text.indexOf(`// </${tag}>`);
    assert.ok(i >= 0 && j > i, `could not find the ${tag} block`);
    return text.slice(i, j);
};

// ── the three copies are one ────────────────────────────────────────────────────────────────
const gate = cut(src[FILES[0]], 'access-gate');
test('the access gate is the same text in all three route files', () => {
    for (const f of FILES) assert.equal(cut(src[f], 'access-gate'), gate, `${f} has a different access gate`);
});

// ── run the real block against stubs ────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'access-'));
const groupsFile = cut(src[FILES[0]], 'allowed-groups-pure');
const cjisFile = cut(src[FILES[0]], 'cjis-pure');
const file = join(dir, 'access.ts');
writeFileSync(file, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
export const world: any = { setting: undefined, settingThrows: false, groups: [] as string[], takThrows: false, takCalls: 0, auth: null as any, profile: { auth: { cert: 'c', key: 'k' } } };
const sql = (s: TemplateStringsArray, ...v: unknown[]) => ({ s: s.join('?'), v });
const Auth = { is_auth: async () => { if (world.auth === 'none') throw new Err(401, null, 'Not authenticated'); return world.auth; } };
class APIAuthCertificate { cert: string; key: string; constructor(cert: string, key: string) { this.cert = cert; this.key = key; } }
const TAKAPI = { init: async () => { world.takCalls++; if (world.takThrows) throw new Error('TAK down'); return { Group: { list: async () => ({ data: world.groups.map((name: string) => ({ name })) }) } }; } };
const config: any = {
    pg: { execute: async () => { if (world.settingThrows) throw new Error('db down'); return world.setting === undefined ? [] : [{ value: world.setting }]; } },
    models: { Profile: { from: async () => world.profile } },
    server: { api: 'https://tak.example:8443' },
};
type ConfigStateless = any;
${gate}
${cjisFile}
${groupsFile}
export { parseAllowedGroups, mayUseDispatcher, dispatcherAccess, requireDispatcherAccess, accessGroupCache, config, isAdminOnlySetting, normAllowedGroups, ACCESS_DENIED, ALLOWED_GROUPS_SETTING };
`);
const m = await import(pathToFileURL(file).href);
const w = m.world;

const user = (email: string, admin = false) => ({ email, is_admin: () => admin });
const reset = () => {
    w.setting = undefined; w.settingThrows = false; w.groups = []; w.takThrows = false; w.takCalls = 0;
    w.auth = user('dispatcher@example.org'); w.profile = { auth: { cert: 'c', key: 'k' } };
    m.accessGroupCache.clear();
};
const denies = async (status: number, re: RegExp) =>
    assert.rejects(m.requireDispatcherAccess(m.config, {}), (e: { status?: number; message?: string }) => e.status === status && re.test(e.message ?? ''));

test('no list set: everyone signed in gets the Dispatcher, and TAK Server is never asked', async () => {
    reset();
    await m.requireDispatcherAccess(m.config, {});
    assert.deepEqual(await m.dispatcherAccess(m.config, {}), { allowed: true, limited: false, admin: false });
    assert.equal(w.takCalls, 0);
});

test('an empty list is the same as no list', async () => {
    reset();
    w.setting = [];
    await m.requireDispatcherAccess(m.config, {});
    w.setting = '[]';
    await m.requireDispatcherAccess(m.config, {});
    assert.equal(w.takCalls, 0);
});

test('with a list: a member of a listed group gets in, ignoring upper and lower case', async () => {
    reset();
    w.setting = ['Fire Dispatch'];
    w.groups = ['Other', 'fire dispatch'];
    await m.requireDispatcherAccess(m.config, {});
    assert.deepEqual(await m.dispatcherAccess(m.config, {}), { allowed: true, limited: true, admin: false });
});

test('with a list: a user in none of the listed groups is refused with 403', async () => {
    reset();
    w.setting = ['Fire Dispatch'];
    w.groups = ['EMS', 'Police'];
    await denies(403, /limited to certain TAK groups/);
    assert.deepEqual(await m.dispatcherAccess(m.config, {}), { allowed: false, limited: true, admin: false });
});

test('with a list: a user with no groups at all is refused', async () => {
    reset();
    w.setting = ['Fire Dispatch'];
    w.groups = [];
    await denies(403, /limited to certain TAK groups/);
});

test('with a list: a CloudTAK system admin always gets in, with no TAK lookup', async () => {
    reset();
    w.setting = ['Fire Dispatch'];
    w.auth = user('admin@example.org', true);
    w.takThrows = true;
    await m.requireDispatcherAccess(m.config, {});
    assert.deepEqual(await m.dispatcherAccess(m.config, {}), { allowed: true, limited: true, admin: true });
    assert.equal(w.takCalls, 0);
});

test('with a list: a layer or connection token (not a person) is refused; with no list it is untouched', async () => {
    reset();
    w.auth = { access: 'layer', id: 7 };
    await m.requireDispatcherAccess(m.config, {});
    w.setting = ['Fire Dispatch'];
    await denies(403, /limited to certain TAK groups/);
});

test('with a list: if TAK Server cannot say which groups the user is in, the user is refused (503), never let in', async () => {
    reset();
    w.setting = ['Fire Dispatch'];
    w.takThrows = true;
    await denies(503, /Could not check your TAK groups/);
    reset();
    w.setting = ['Fire Dispatch'];
    w.profile = { auth: null };   // provisioned but never logged in: no certificate
    await denies(503, /Could not check your TAK groups/);
});

test('if the list cannot be read, the user is refused (503), never let in', async () => {
    reset();
    w.settingThrows = true;
    await denies(503, /Could not check who may use the Dispatcher/);
});

test('a stored list that is not a list locks everyone but admins out, until an admin fixes it', async () => {
    reset();
    w.setting = 'Fire Dispatch';          // text, not a JSON list
    w.groups = ['Fire Dispatch'];
    await denies(403, /limited to certain TAK groups/);
    w.auth = user('admin@example.org', true);
    await m.requireDispatcherAccess(m.config, {});
});

test('the list may come back from the database as JSON text (older rows), and still limits', async () => {
    reset();
    w.setting = '["Fire Dispatch"]';
    w.groups = ['EMS'];
    await denies(403, /limited to certain TAK groups/);
    w.groups = ['Fire Dispatch'];
    m.accessGroupCache.clear();
    await m.requireDispatcherAccess(m.config, {});
});

test('a not-signed-in request is still refused with CloudTAK\'s own 401, list or not', async () => {
    reset();
    w.auth = 'none';
    await denies(401, /Not authenticated/);
    w.setting = ['Fire Dispatch'];
    await denies(401, /Not authenticated/);
});

test('the admin list is read on every request, so turning it off or on takes effect at once', async () => {
    reset();
    w.groups = ['EMS'];
    await m.requireDispatcherAccess(m.config, {});
    w.setting = ['Fire Dispatch'];
    await denies(403, /limited/);
    w.setting = [];
    await m.requireDispatcherAccess(m.config, {});
});

test('parseAllowedGroups and mayUseDispatcher', () => {
    assert.deepEqual(m.parseAllowedGroups(undefined), { limited: false, groups: [] });
    assert.deepEqual(m.parseAllowedGroups(null), { limited: false, groups: [] });
    assert.deepEqual(m.parseAllowedGroups(' '), { limited: true, groups: [] });
    assert.deepEqual(m.parseAllowedGroups(['  A ', '', 'B', 3]), { limited: true, groups: ['A', 'B'] });
    assert.deepEqual(m.parseAllowedGroups([3]), { limited: true, groups: [] });
    assert.equal(m.mayUseDispatcher({ limited: false, groups: [] }, false, []), true);
    assert.equal(m.mayUseDispatcher({ limited: true, groups: ['A'] }, false, ['a ']), true);
    assert.equal(m.mayUseDispatcher({ limited: true, groups: ['A'] }, false, ['AB']), false);
    assert.equal(m.mayUseDispatcher({ limited: true, groups: [] }, false, ['A']), false);
    assert.equal(m.mayUseDispatcher({ limited: true, groups: [] }, true, []), true);
});

// ── saving the list: admin only, and only a clean list of names ─────────────────────────────
test('allowed_groups is an admin-only setting', () => {
    assert.equal(m.isAdminOnlySetting('allowed_groups'), true);
    assert.equal(m.ALLOWED_GROUPS_SETTING, 'allowed_groups');
    assert.match(src[FILES[0]], /req\.params\.key === ALLOWED_GROUPS_SETTING\) value = normAllowedGroups\(value\)/);
});

test('a saved list is trimmed, without blanks or repeats (ignoring case); none or empty turns the limit off', () => {
    assert.deepEqual(m.normAllowedGroups([' Fire Dispatch ', 'EMS', 'fire dispatch', '', '  ']), ['Fire Dispatch', 'EMS']);
    assert.deepEqual(m.normAllowedGroups([]), []);
    assert.deepEqual(m.normAllowedGroups(null), []);
    assert.deepEqual(m.normAllowedGroups(undefined), []);
});

test('a list that is not a list of text is refused with a plain 400', () => {
    const refuses = (v: unknown, re: RegExp) => assert.throws(() => m.normAllowedGroups(v), (e: { status?: number; message?: string }) => e.status === 400 && re.test(e.message ?? ''));
    refuses('Fire Dispatch', /list of TAK group names/);
    refuses({ a: 1 }, /list of TAK group names/);
    refuses(['ok', 5], /must be text/);
    refuses(['x'.repeat(201)], /too long/);
    refuses(Array.from({ length: 101 }, (_, i) => `g${i}`), /Too many/);
    assert.equal(m.normAllowedGroups(Array.from({ length: 100 }, (_, i) => `g${i}`)).length, 100);
});

// ── no route skips the gate ─────────────────────────────────────────────────────────────────
// /dispatcher/access must answer for a user the gate would refuse (the plugin asks it to decide about the menu),
// and /dispatcher/groups does its own admin check. Every other route calls requireDispatcherAccess first.
const OWN_CHECK = new Set(['/dispatcher/access', '/dispatcher/groups']);
const ROUTES_MIN: Record<string, number> = { 'server/plugin-dispatcher.ts': 17, 'server/plugin-addressing.ts': 15, 'server/plugin-takcad.ts': 6 };
for (const f of FILES) {
    test(`every route in ${f} refuses a user outside the list`, () => {
        const parts = src[f].split(/^\s*await schema\.(?:get|post|put|patch|delete)\(\s*/m).slice(1);
        assert.ok(parts.length >= ROUTES_MIN[f], `found only ${parts.length} routes in ${f}`);
        for (const p of parts) {
            const path = /^'([^']+)'/.exec(p)?.[1] ?? '?';
            if (OWN_CHECK.has(path)) continue;
            const handler = p.slice(p.indexOf('async (req, res) =>'));
            const firstLine = handler.split('\n').slice(0, 3).join('\n');
            assert.match(firstLine, /await requireDispatcherAccess\(config, req\);/, `${path} in ${f} does not start with the access gate`);
        }
    });
}

// ── the browser side ────────────────────────────────────────────────────────────────────────
test('the menu item shows unless the server clearly says no', () => {
    assert.equal(a.menuAllowed({ allowed: false, limited: true, admin: false }), false);
    assert.equal(a.menuAllowed({ allowed: true, limited: true, admin: false }), true);
    assert.equal(a.menuAllowed({ allowed: true, limited: false, admin: true }), true);
    assert.equal(a.menuAllowed(null), true);        // server could not answer
    assert.equal(a.menuAllowed(undefined), true);
    assert.equal(a.menuAllowed('oops'), true);
    assert.equal(a.menuAllowed({}), true);
});

test('the settings page reads the list from the settings map and edits it', () => {
    assert.deepEqual(a.allowedGroupsFrom({ allowed_groups: [' EMS ', 'EMS', '', 7, 'Fire'] }), ['EMS', 'Fire']);
    assert.deepEqual(a.allowedGroupsFrom({}), []);
    assert.deepEqual(a.allowedGroupsFrom(null), []);
    assert.deepEqual(a.allowedGroupsFrom({ allowed_groups: 'EMS' }), []);
    assert.deepEqual(a.withGroup(['EMS'], ' Fire '), ['EMS', 'Fire']);
    assert.equal(a.withGroup(['EMS'], 'ems'), null);
    assert.equal(a.withGroup(['EMS'], '   '), null);
    assert.equal(a.withGroup(Array.from({ length: 100 }, (_, i) => `g${i}`), 'new'), null);
    assert.deepEqual(a.withoutGroup(['EMS', 'Fire'], 'EMS'), ['Fire']);
});

test('the plugin menu check is wired into enable()', () => {
    const idx = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    assert.match(idx, /getDispatcherAccess\(\)/);
    assert.match(idx, /if \(!menuAllowed\(access\)\)/);
    assert.ok(idx.indexOf('menuAllowed(access)') < idx.indexOf('this.api.menu.add('), 'the check must come before the menu is added');
});
