// Proof tests for Who Can Use Dispatcher on the server. Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The rule sits between `// <access-pure>` markers in server/plugin-dispatcher.ts and, as the same text,
// in server/plugin-addressing.ts (each route file loads on its own). This test checks the two copies
// match, cuts the block out of the real file and runs it, and reads both files to check that every
// Dispatcher route makes the check. The check's database read and CloudTAK's Auth are not testable here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dispatcher = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const addressing = readFileSync(new URL('../../server/plugin-addressing.ts', import.meta.url), 'utf8');
const cut = (src: string) => src.slice(src.indexOf('// <access-pure>'), src.indexOf('// </access-pure>'));
const block = cut(dispatcher);
assert.ok(block.includes('function mayUseDispatcher'), 'could not find the access block in the server file');

const dir = mkdtempSync(join(tmpdir(), 'access-'));
const file = join(dir, 'access.ts');
writeFileSync(file, `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
${block}
export { ALLOWED_GROUPS_SETTING, ALLOWED_GROUPS_MAX, ALLOWED_GROUP_NAME_MAX, DISPATCHER_NOT_ALLOWED, normAllowedGroups, allowedGroupsFrom, mayUseDispatcher };
`);
const m = await import(pathToFileURL(file).href);
const lib = await import('../lib/group-access.ts');

const refuses = (fn: () => unknown, status: number, re?: RegExp) =>
    assert.throws(fn, (e: { status?: number; message?: string }) => e.status === status && (!re || re.test(e.message ?? '')));

// Each route handler in a route file: from one `await schema.` to the next.
function handlers(src: string): { route: string; body: string }[] {
    const router = src.slice(src.indexOf('export default async function router('));
    return router.split(/\n    await schema\./).slice(1).map(h => ({ route: h.slice(0, h.indexOf(',')), body: h }));
}

test('plugin-addressing.ts carries the same rule as plugin-dispatcher.ts, word for word', () => {
    assert.equal(cut(addressing), block);
});

test('server and plugin agree on the setting name and the caps', () => {
    assert.equal(m.ALLOWED_GROUPS_SETTING, lib.ALLOWED_GROUPS_SETTING);
    assert.equal(m.ALLOWED_GROUPS_MAX, lib.ALLOWED_GROUPS_MAX);
    assert.equal(m.ALLOWED_GROUP_NAME_MAX, lib.ALLOWED_GROUP_NAME_MAX);
});

test('an empty list lets everyone in', () => {
    assert.equal(m.mayUseDispatcher([], [], false), true);
    assert.equal(m.mayUseDispatcher(['Anything'], [], false), true);
});

test('with groups listed, only a member of one of them or an admin gets in', () => {
    const allowed = ['County Fire Main', 'County EMS'];
    assert.equal(m.mayUseDispatcher(['Other Agency', 'County EMS'], allowed, false), true);
    assert.equal(m.mayUseDispatcher(['Other Agency'], allowed, false), false);
    assert.equal(m.mayUseDispatcher([], allowed, false), false);
    assert.equal(m.mayUseDispatcher([], allowed, true), true, 'a CloudTAK system admin always gets in');
    assert.equal(m.mayUseDispatcher(new Set(['County Fire Main']), allowed, false), true, 'takes the Set userChannels returns');
});

test('group names match without regard to case', () => {
    assert.equal(m.mayUseDispatcher(['county fire MAIN'], ['County Fire Main'], false), true);
    assert.equal(m.mayUseDispatcher(['County Fire'], ['County Fire Main'], false), false, 'a whole name, not part of one');
});

test('the stored list: trimmed, blanks dropped, each group once', () => {
    assert.deepEqual(m.normAllowedGroups([' County Fire Main ', '', 'county fire main', 'County EMS']), ['County Fire Main', 'County EMS']);
    assert.deepEqual(m.normAllowedGroups([]), [], 'an empty list is how the admin lets everyone in again');
});

test('not a list of names, a long name or too many groups is refused', () => {
    refuses(() => m.normAllowedGroups('County Fire Main'), 400);
    refuses(() => m.normAllowedGroups(null), 400);
    refuses(() => m.normAllowedGroups(['County Fire Main', 7]), 400);
    refuses(() => m.normAllowedGroups(['x'.repeat(m.ALLOWED_GROUP_NAME_MAX + 1)]), 400);
    assert.equal(m.normAllowedGroups(['x'.repeat(m.ALLOWED_GROUP_NAME_MAX)]).length, 1);
    const many = Array.from({ length: m.ALLOWED_GROUPS_MAX + 1 }, (_, i) => `Group ${i}`);
    refuses(() => m.normAllowedGroups(many), 400);
    assert.equal(m.normAllowedGroups(many.slice(1)).length, m.ALLOWED_GROUPS_MAX);
});

test('reading back never refuses: a stored text is unwrapped, anything else reads as empty', () => {
    assert.deepEqual(m.allowedGroupsFrom(['County EMS']), ['County EMS']);
    assert.deepEqual(m.allowedGroupsFrom(JSON.stringify(['County EMS'])), ['County EMS']);
    assert.deepEqual(m.allowedGroupsFrom(JSON.stringify(JSON.stringify(['County EMS']))), ['County EMS']);
    assert.deepEqual(m.allowedGroupsFrom(undefined), []);
    assert.deepEqual(m.allowedGroupsFrom('not json'), []);
    assert.deepEqual(m.allowedGroupsFrom([' ', 3, 'County EMS']), ['County EMS']);
});

test('only a CloudTAK system admin can change the list, and it is checked before it is stored', () => {
    const route = dispatcher.slice(dispatcher.indexOf("schema.put('/dispatcher/settings/:key'"), dispatcher.indexOf('// ── Events ──'));
    assert.match(route, /\|\| req\.params\.key === ALLOWED_GROUPS_SETTING\) \{[\s\S]*if \(!user\.is_admin\(\)\) throw[\s\S]*ALLOWED_GROUPS_SETTING\) value = normAllowedGroups\(value\);/);
});

test('the access route answers only may_use, after sign-in', () => {
    const route = dispatcher.slice(dispatcher.indexOf("schema.get('/dispatcher/access'"), dispatcher.indexOf("schema.get('/dispatcher/settings'"));
    assert.match(route, /await Auth\.is_auth\(config, req\);\s*res\.json\(\{ may_use: await dispatcherAccess\(config, req\) \}\);/);
});

test('the settings route gives no settings to a user it does not let in', () => {
    const route = dispatcher.slice(dispatcher.indexOf("schema.get('/dispatcher/settings'"), dispatcher.indexOf("schema.put('/dispatcher/settings/:key'"));
    assert.match(route, /if \(!\(await dispatcherAccess\(config, req\)\)\) \{\s*res\.json\(\{ settings: \{\} \}\);\s*return;/);
});

// The awaited statements of a handler, from its `try {` on, in order.
const awaitsOf = (body: string) => [...body.slice(body.indexOf('try {')).matchAll(/await [^;]+;/g)].map(x => x[0]);

test('every Dispatcher route checks who may use it first thing, right after sign-in', () => {
    const all = handlers(dispatcher);
    assert.equal(all.length, dispatcher.split('await schema.').length - 1, 'every route was found');
    for (const { route, body } of all) {
        // These two answer for a caller they do not let in (tests above); the settings write is below.
        if (route.startsWith("get('/dispatcher/access'") || route.startsWith("get('/dispatcher/settings'") || route.startsWith("put('/dispatcher/settings/:key'")) continue;
        const [first, second] = awaitsOf(body);
        const ok = (first === 'await Auth.as_user(config, req);' && second === 'await requireDispatcherAccess(config, req, user);')
            || (first === 'await Auth.is_auth(config, req);' && second === 'await requireDispatcherAccess(config, req);');
        assert.ok(ok, `${route} makes the check first: ${first} / ${second}`);
    }
    const put = all.find(h => h.route.startsWith("put('/dispatcher/settings/:key'"))!.body;
    assert.match(put, /\} else \{\s*await Auth\.is_auth\(config, req\);\s*await requireDispatcherAccess\(config, req\);\s*\}/, 'a setting anyone may change is checked too');
});

test('every address route checks who may use the Dispatcher first thing, or is admin only', () => {
    const all = handlers(addressing);
    assert.equal(all.length, addressing.split('await schema.').length - 1, 'every route was found');
    for (const { route, body } of all) {
        const [first, second] = awaitsOf(body);
        const ok = first === 'await requireAdmin(config, req);'
            || (first === 'await Auth.is_auth(config, req);' && second === 'await requireDispatcherAccess(config, req);');
        assert.ok(ok, `${route} makes the check first: ${first} / ${second}`);
    }
});

// The door check itself, cut out of each real file and run with stand-ins for the database, CloudTAK's
// Auth and the TAK group lookup (globalThis.__h holds what they answer and records what they were asked).
type Harness = { rows: { value: unknown }[]; user: { email: string; is_admin(): boolean }; groups: string[]; groupsThrow: boolean; queries: unknown[][]; asUser: number; lookups: string[] };
declare global { var __h: Harness; }   // eslint-disable-line no-var

function fnText(src: string, start: string): string {
    const at = src.indexOf(start);
    assert.ok(at >= 0, `could not find ${start}`);
    return src.slice(at, src.indexOf('\n}\n', at) + 3);
}

const STANDINS = `
export class Err extends Error { status: number; constructor(status: number, _x: unknown, message: string) { super(message); this.status = status; } }
const sql = (_strings: TemplateStringsArray, ...values: unknown[]) => values;
const Auth = { as_user: async (_c: unknown, _r: unknown) => { globalThis.__h.asUser++; return globalThis.__h.user; } };
async function query<T>(_config: unknown, values: unknown[]): Promise<T[]> { globalThis.__h.queries.push(values); return globalThis.__h.rows as T[]; }
async function lookup(email: string): Promise<Set<string>> {
    globalThis.__h.lookups.push(email);
    if (globalThis.__h.groupsThrow) throw new Err(401, null, 'User has been provisioned but has not yet logged in');
    return new Set(globalThis.__h.groups);
}
async function userChannels(_config: unknown, email: string) { return lookup(email); }
async function userGroups(_config: unknown, email: string) { return lookup(email); }
${block}
`;
const gates: Record<string, (signedIn?: Harness['user']) => Promise<boolean>> = {};
{
    const dfile = join(dir, 'gate-dispatcher.ts');
    writeFileSync(dfile, `${STANDINS}
${dispatcher.slice(dispatcher.indexOf('type SignedInUser'), dispatcher.indexOf('async function requireDispatcherAccess'))}
${fnText(dispatcher, 'async function requireDispatcherAccess')}
export { dispatcherAccess, requireDispatcherAccess };
`);
    const afile = join(dir, 'gate-addressing.ts');
    writeFileSync(afile, `${STANDINS}
${fnText(addressing, 'async function requireDispatcherAccess')}
export { requireDispatcherAccess };
`);
    const d = await import(pathToFileURL(dfile).href);
    const a = await import(pathToFileURL(afile).href);
    const allowedBy = (fn: () => Promise<void>) => fn().then(() => true, (e: { status?: number; message?: string }) => {
        assert.equal(e.status, 403);
        assert.equal(e.message, m.DISPATCHER_NOT_ALLOWED);
        return false;
    });
    gates['plugin-dispatcher.ts dispatcherAccess'] = (u) => d.dispatcherAccess({}, {}, u);
    gates['plugin-dispatcher.ts requireDispatcherAccess'] = (u) => allowedBy(() => d.requireDispatcherAccess({}, {}, u));
    gates['plugin-addressing.ts requireDispatcherAccess'] = () => allowedBy(() => a.requireDispatcherAccess({}, {}));
}

const member = { email: 'member@x', is_admin: () => false };
const admin  = { email: 'admin@x', is_admin: () => true };
const reset = (h: Partial<Harness>) => {
    globalThis.__h = { rows: [], user: member, groups: [], groupsThrow: false, queries: [], asUser: 0, lookups: [], ...h };
};

for (const [name, gate] of Object.entries(gates)) {
    test(`${name}: reads the allowed_groups row on every request`, async () => {
        reset({});
        await gate();
        await gate();
        assert.deepEqual(globalThis.__h.queries, [[m.ALLOWED_GROUPS_SETTING], [m.ALLOWED_GROUPS_SETTING]]);
    });

    test(`${name}: an empty or missing list lets everyone in without looking anyone up`, async () => {
        for (const rows of [[], [{ value: [] }], [{ value: JSON.stringify([]) }]]) {
            reset({ rows, groups: [] });
            assert.equal(await gate(), true);
            assert.equal(globalThis.__h.asUser, 0);
            assert.deepEqual(globalThis.__h.lookups, []);
        }
    });

    test(`${name}: with groups listed, a member gets in and anyone else is refused`, async () => {
        for (const value of [['County EMS'], JSON.stringify(['County EMS'])]) {
            reset({ rows: [{ value }], groups: ['Other', 'county ems'] });
            assert.equal(await gate(), true, 'member (any case)');
            reset({ rows: [{ value }], groups: ['Other'] });
            assert.equal(await gate(), false, 'not a member');
            assert.deepEqual(globalThis.__h.lookups, ['member@x'], 'looked up the signed-in user');
        }
    });

    test(`${name}: a CloudTAK system admin always gets in, without a group lookup`, async () => {
        reset({ rows: [{ value: ['County EMS'] }], user: admin, groups: [] });
        assert.equal(await gate(), true);
        assert.deepEqual(globalThis.__h.lookups, []);
    });

    test(`${name}: a caller whose groups cannot be read is refused while the list has groups`, async () => {
        reset({ rows: [{ value: ['County EMS'] }], groupsThrow: true });
        assert.equal(await gate(), false);
    });
}

test('a route that already has the signed-in user does not sign in again', async () => {
    reset({ rows: [{ value: ['County EMS'] }], groups: ['County EMS'] });
    assert.equal(await gates['plugin-dispatcher.ts dispatcherAccess'](member), true);
    assert.equal(globalThis.__h.asUser, 0);
    assert.equal(await gates['plugin-dispatcher.ts requireDispatcherAccess'](), true);
    assert.equal(globalThis.__h.asUser, 1, 'without it, the gate signs in itself');
});
