// Proof tests for how the server stores its jsonb columns (incident units, notes and callers, and the
// shared settings). Before the fix every write stored a JSON string holding the list, because the
// parameter was cast straight to jsonb and CloudTAK's driver JSON-encoded it again; SQL that looked
// inside the column found nothing. Now the JSON goes in as text (toJsonb) and Postgres parses it.
// Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The JSON text and settings logic sits between `// <jsonb-pure>` markers in server/plugin-dispatcher.ts. This test
// cuts that block (and asArray) out of the real file and runs them, so it tests the code that ships.
// The bootstrap that unwraps old rows runs against a real Postgres in .github/ci/tests/upgrade-db-jsonb.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync(new URL('../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <jsonb-pure>'), src.indexOf('// </jsonb-pure>'));
const asArray = src.slice(src.indexOf('function asArray'), src.indexOf('\n}\n', src.indexOf('function asArray')) + 3);
assert.ok(block.includes('function jsonbText') && block.includes('function settingFromStore'), 'could not find the jsonb block in the server file');
assert.ok(asArray.includes('Array.isArray'), 'could not find asArray in the server file');

const dir = mkdtempSync(join(tmpdir(), 'jsonb-'));
const file = join(dir, 'jsonb.ts');
writeFileSync(file, `
${asArray}
${block}
export { asArray, jsonbText, unwrapJson, settingToStore, settingFromStore };
`);
const m = await import(pathToFileURL(file).href);

// What the driver hands back for a jsonb column: Postgres keeps the parsed JSON, postgres-js parses it again.
const roundTrip = (stored: unknown) => JSON.parse(m.jsonbText(stored));
// What the writes before the fix stored: the JSON text, encoded once more as a JSON string.
const oldWrite = (value: unknown) => JSON.stringify(value ?? null);
// The settings read in older plugin versions (rollback).
const oldRead = (v: unknown) => typeof v === 'string' ? JSON.parse(v) : v;

const VALUES: unknown[] = [
    'Agency', '', '123', 'true', '"quoted"', 'Keep CJIS data out of incidents.',
    true, false, 0, 60, null, { name: 'Agency', logo: 'data:image/png;base64,AAAA' }, ['Welfare check'], [],
];

test('every setting comes back as it was saved', () => {
    for (const v of VALUES) assert.deepEqual(m.settingFromStore(roundTrip(m.settingToStore(v))), v, JSON.stringify(v));
});

test('objects, lists, true/false and numbers are stored as real jsonb; text keeps its JSON inside', () => {
    assert.deepEqual(m.settingToStore({ name: 'A' }), { name: 'A' });
    assert.deepEqual(m.settingToStore(['x']), ['x']);
    assert.equal(m.settingToStore(true), true);
    assert.equal(m.settingToStore(60), 60);
    assert.equal(m.jsonbText(m.settingToStore(undefined)), 'null');
    // So the text "123" never turns into the number 123.
    assert.equal(m.settingToStore('123'), '"123"');
    assert.equal(m.settingFromStore(roundTrip(m.settingToStore('123'))), '123');
});

test('settings saved before the fix still read the same', () => {
    for (const v of VALUES) assert.deepEqual(m.settingFromStore(oldWrite(v)), v, JSON.stringify(v));
});

test('rollback: an older plugin reads settings saved by this version', () => {
    for (const v of VALUES) assert.deepEqual(oldRead(roundTrip(m.settingToStore(v))), v, JSON.stringify(v));
});

test('a text setting typed in by hand (not JSON) is read as it is, not an error', () => {
    assert.equal(m.settingFromStore('Keep CJIS data out of incidents.'), 'Keep CJIS data out of incidents.');
});

test('asArray reads real lists, lists stored as a string (once or twice), and nothing else', () => {
    const list = [{ uid: 'ANDROID-e12', callsign: 'E12' }];
    assert.deepEqual(m.asArray(list), list);
    assert.deepEqual(m.asArray(JSON.stringify(list)), list);
    assert.deepEqual(m.asArray(JSON.stringify(JSON.stringify(list))), list);
    assert.deepEqual(m.asArray('not json'), []);
    assert.deepEqual(m.asArray('{"a":1}'), []);
    assert.deepEqual(m.asArray(null), []);
});

test('text Postgres refuses in jsonb (NUL, half an emoji) is dropped; everything else is kept', () => {
    const save = (text: string) => JSON.parse(m.jsonbText([{ text }]))[0].text;
    assert.equal(save('a\u0000b'), 'ab');
    assert.equal(save('cut \ud83d'), 'cut ');
    assert.equal(save('\ude00 tail'), ' tail');
    assert.equal(save('x\ude00\ud83d'), 'x');
    assert.equal(save('fire \ud83d\udd25 ok'), 'fire \ud83d\udd25 ok');
    assert.equal(save('typed \\u0000 as text'), 'typed \\u0000 as text');
    assert.equal(m.jsonbText({ a: { b: ['n\u0000'] }, n: 1, t: true }), '{"a":{"b":["n"]},"n":1,"t":true}');
    assert.equal(m.jsonbText(undefined), 'null');
});

test('unwrapJson parses up to the given number of times and stops at text that is not JSON', () => {
    assert.equal(m.unwrapJson(JSON.stringify(JSON.stringify(true)), 1), 'true');
    assert.equal(m.unwrapJson(JSON.stringify(JSON.stringify(true)), 4), true);
    assert.equal(m.unwrapJson('not json', 4), 'not json');
    assert.deepEqual(m.unwrapJson([1], 4), [1]);
});

test('no write casts a parameter straight to jsonb; the lists go through toJsonb', () => {
    assert.ok(src.includes('sql`${jsonbText(value)}::text::jsonb`'), 'toJsonb must send the cleaned JSON as text');
    // No JSON is built inline in a query, and no parameter is cast to json/jsonb in any spelling.
    assert.deepEqual(src.match(/\$\{\s*JSON\.stringify/g) ?? [], []);
    assert.deepEqual(src.match(/\}\s*::\s*jsonb?\b/gi) ?? [], []);
    assert.deepEqual(src.match(/CAST\s*\(\s*\$\{/gi) ?? [], []);
    for (const col of ['callers', 'assigned', 'notes']) {
        const writes = [...src.matchAll(new RegExp(`\\b${col}\\s*=\\s*\\$\\{([^}]*)\\}`, 'g'))].map(w => w[1]);
        assert.ok(writes.length > 0, `no write to ${col} found`);
        for (const w of writes) assert.match(w, /^toJsonb\(/, `${col} = \${${w}}`);
    }
    // Each insert gives every list column it names a toJsonb value.
    const inserts = [...src.matchAll(/INSERT INTO dispatcher_incidents\s*\(([^)]*)\)\s*VALUES([\s\S]*?)RETURNING/g)];
    assert.ok(inserts.length > 0, 'no incident insert found');
    for (const [, cols, values] of inserts) {
        const lists = cols.split(',').map(c => c.trim()).filter(c => ['callers', 'assigned', 'notes'].includes(c));
        assert.equal((values.match(/\$\{toJsonb\(/g) ?? []).length, lists.length, `insert (${cols.trim()})`);
    }
});
