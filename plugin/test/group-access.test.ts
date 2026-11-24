// Proof tests for Who Can Use Dispatcher in the plugin: the list logic (lib/group-access.ts) and how the
// plugin hides itself from a user the server does not let in. Plain node, no CloudTAK:
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as m from '../lib/group-access.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the saved list, from the settings map; anything else reads as empty', () => {
    assert.deepEqual(m.allowedGroupsFrom({ allowed_groups: ['County EMS', ' County Fire Main '] }), ['County EMS', 'County Fire Main']);
    assert.deepEqual(m.allowedGroupsFrom({}), []);
    assert.deepEqual(m.allowedGroupsFrom(null), []);
    assert.deepEqual(m.allowedGroupsFrom({ allowed_groups: 'County EMS' }), []);
});

test('adding a group: trimmed, once only (ignoring case), never blank, long or past the cap', () => {
    assert.deepEqual(m.addAllowedGroup([], ' County EMS '), { list: ['County EMS'] });
    assert.ok('problem' in m.addAllowedGroup(['County EMS'], 'county ems'));
    assert.ok('problem' in m.addAllowedGroup([], '   '));
    assert.ok('problem' in m.addAllowedGroup([], 'x'.repeat(m.ALLOWED_GROUP_NAME_MAX + 1)));
    const full = Array.from({ length: m.ALLOWED_GROUPS_MAX }, (_, i) => `Group ${i}`);
    assert.ok('problem' in m.addAllowedGroup(full, 'One More'));
});

test('a group name that is not one of the admin\'s own groups is caught, ignoring case', () => {
    assert.equal(m.isKnownGroup(['County EMS', 'County Fire Main'], ' county ems '), true);
    assert.equal(m.isKnownGroup(['County EMS'], 'Countyy EMS'), false);
    assert.equal(m.isKnownGroup([], 'County EMS'), false);
    const card = read('../components/GroupAccessSettings.vue');
    assert.match(card, /if \(!isKnownGroup\(mine\.value, name\) && unsure\.value !== name\) \{[\s\S]*unsure\.value = name;\s*return;/, 'the first Add only warns');
});

test('the menu item is added only when the server lets this user in, never after a later disable(), and enable() does not wait', () => {
    const index = read('../index.ts');
    const enable = index.slice(index.indexOf('async enable()'), index.indexOf('private async show('));
    assert.match(enable, /const turn = \+\+this\.turn;/);
    assert.match(enable, /void getDispatcherAccess\(\)\s*\.then\(mayUse => \(mayUse && turn === this\.turn \? this\.show\(startRoute\) : undefined\)\)/);
    assert.ok(!/await getDispatcherAccess/.test(enable), 'CloudTAK waits for each enable(): it must not wait on the network');
    assert.ok(!/menu\.add/.test(enable), 'the item is added only in show(), after the answer');
    const show = index.slice(index.indexOf('private async show('), index.indexOf('async disable()'));
    assert.match(show, /router\.currentRoute\.value\.name === startRoute\s*&& shouldReopenPanel/, 'reopens only if the user has not moved on');
    const disable = index.slice(index.indexOf('async disable()'));
    assert.match(disable, /^async disable\(\): Promise<void> \{\s*this\.turn\+\+;/);
});

// getDispatcherAccess, cut out of the real file and run with a stand-in for CloudTAK's std().
const client = read('../lib/events-client.ts');
const accessFn = client.slice(client.indexOf('export const ACCESS_WAIT_MS'), client.indexOf('\n}\n', client.indexOf('export async function getDispatcherAccess')) + 3);
assert.match(accessFn, /export const ACCESS_WAIT_MS = 10_000;/);
const accessDir = mkdtempSync(join(tmpdir(), 'access-client-'));
const accessFile = join(accessDir, 'access.ts');
writeFileSync(accessFile, `
const std = (url: string, opts: unknown) => (globalThis as any).__std(url, opts);
${accessFn.replace('ACCESS_WAIT_MS = 10_000', 'ACCESS_WAIT_MS = 30')}
`);
const ac = await import(pathToFileURL(accessFile).href);
const answer = (fn: (url: string) => Promise<unknown>) => { (globalThis as any).__std = fn; };

test('only a server that says no hides the Dispatcher: an older server, a failed request or no answer leaves it shown', async () => {
    const asked: string[] = [];
    answer(async (url) => { asked.push(url); return { may_use: false }; });
    assert.equal(await ac.getDispatcherAccess(), false);
    assert.deepEqual(asked, ['/api/dispatcher/access'], 'asks the small access route, not the whole settings');
    answer(async () => ({ may_use: true }));
    assert.equal(await ac.getDispatcherAccess(), true);
    answer(async () => ({}));
    assert.equal(await ac.getDispatcherAccess(), true, 'an answer without may_use (older server)');
    answer(async () => { throw new Error('404'); });
    assert.equal(await ac.getDispatcherAccess(), true, 'no access route (older server)');
    answer(() => new Promise(() => { /* never answers */ }));
    assert.equal(await ac.getDispatcherAccess(), true, 'no answer within the wait');
    answer(() => new Promise(resolve => setTimeout(() => resolve({ may_use: false }), 5)));
    assert.equal(await ac.getDispatcherAccess(), false, 'a no that comes before the wait is up still counts');
});

test('the page shows nothing until the server answers, and only the note to a user it does not let in', () => {
    const main = read('../components/CadMain.vue');
    // One v-if chain at the top of the page: the board (with the command line) is its last branch, so it never
    // mounts while checking or for a user the server does not let in.
    assert.match(main, /v-if='floatedElsewhere'[\s\S]*?v-else-if='access === "checking"'[\s\S]*?Connecting…[\s\S]*?v-else-if='access === "no"'[\s\S]*?The Dispatcher is not turned on for your group\. Ask your CloudTAK admin\.[\s\S]*?v-else-if='setupError'[\s\S]*?<\/div>\s*<template v-else>/);
    assert.match(main, /access\.value = \(await getDispatcherAccess\(\)\) \? 'yes' : 'no';\s*if \(access\.value === 'no'\) return;/);
});

test('the card changes nothing until the saved list is read, and says so when it cannot be', () => {
    const card = read('../components/GroupAccessSettings.vue');
    assert.match(card, /async function add\(\) \{\s*if \(listState\.value !== 'ready'\) return;/);
    assert.match(card, /async function remove\(g: string\) \{\s*if \(listState\.value !== 'ready'\) return;/);
    assert.equal((card.match(/:disabled='saving \|\| listState !== "ready"/g) ?? []).length, 3, 'name box, Add and each trash can');
    assert.match(card, /listState\.value = 'ready';\s*\} catch \{\s*listState\.value = 'failed';/);
    assert.match(card, /v-else-if='listState === "failed"'/);
});

test('Dispatcher Settings has the card, locked to CloudTAK admins', () => {
    const settings = read('../components/DispatcherSettings.vue');
    assert.match(settings, /<GroupAccessSettings :is-admin='isAdmin' \/>/);
    const card = read('../components/GroupAccessSettings.vue');
    assert.match(card, /CloudTAK admin only/);
    assert.match(card, /putDispatcherSetting\(ALLOWED_GROUPS_SETTING, next\)/);
    assert.match(card, /v-if='isAdmin'[\s\S]*data-test='allowed-group-add'/);
});
