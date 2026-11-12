// Proof test for unwrapping lists and settings that older versions stored as a JSON string. Every write
// before the fix cast its parameter straight to jsonb, and CloudTAK's driver (postgres-js) JSON-encoded
// the text again, so a unit list was stored as the string '[{"uid":...}]', not the list. The readers
// unwrap it, but SQL that looks inside the column found nothing. The schema bootstrap now unwraps them.
// Needs a real, empty Postgres (CI gives the job a postgres service). Run it the same way CI does:
//   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres node --test .github/ci/tests/upgrade-db-jsonb.test.mjs
// PSQL overrides the client command, e.g. PSQL="docker exec -i pg psql -U postgres".
//
// It loads fixtures/v1.4.0-db.sql, rewrites some rows the way the old plugin really stored them
// (to_jsonb(text) is what the driver produced), then runs the schema bootstrap cut out of the real
// server/plugin-dispatcher.ts, so it tests the statements that ship, not a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const src = readFileSync(new URL('../../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./fixtures/v1.4.0-db.sql', import.meta.url), 'utf8');

const [psqlCmd, ...psqlArgs] = (process.env.PSQL || 'psql').split(' ');
// One psql call per script: stop at the first error, print bare rows (no headers), tab-separated.
function psql(script) {
    return execFileSync(psqlCmd, [...psqlArgs, '-X', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=1'], {
        input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
}
const one = (q) => psql(q + ';');

// Every sql`...` between the bootstrap's start and its catch, in order.
const boot = src.slice(src.indexOf('Idempotent schema bootstrap'), src.indexOf('table bootstrap failed'));
const bootstrap = [...boot.matchAll(/sql`([\s\S]*?)`/g)].map(m => m[1]);
assert.ok(bootstrap.some(s => s.includes('vals := ARRAY[r.assigned, r.notes, r.callers]')), 'could not find the list unwrap in the bootstrap');
assert.ok(bootstrap.every(s => !s.includes('${')), 'the schema bootstrap must not take parameters');
const runBootstrap = () => psql(bootstrap.map(s => s.trim()).join(';\n') + ';');

// The current list query, cut from its route, with the route parameter filled in.
const at = src.indexOf("'List incidents in an event (active + closed)'");
const listIncidents = src.slice(at).match(/sql`([\s\S]*?)`/)[1].replace('${req.params.eventid}', "'ev-ds'");
const rows = (q) => psql(`SELECT row_to_json(t) FROM (${q}) t;`).split('\n').map(l => JSON.parse(l));
const typeOf = (id, col) => one(`SELECT jsonb_typeof(${col}) FROM dispatcher_incidents WHERE id = '${id}'`);
const setting = (key) => one(`SELECT jsonb_typeof(value) || ' ' || value::text FROM dispatcher_settings WHERE key = '${key}'`);
const snapshot = () => psql(`SELECT id, assigned::text, notes::text, callers::text FROM dispatcher_incidents ORDER BY id;
                             SELECT key, value::text FROM dispatcher_settings ORDER BY key;`);

// The lists as the old plugin stored them: the JSON text, wrapped once more as a JSON string.
const UNITS = '[{"uid":"ANDROID-e12","callsign":"E12","status":"on_scene","assigned_at":"2026-11-03T10:01:00.000Z"}]';
const NOTES = '[{"time":"2026-11-03T10:00:00.000Z","text":"Incident opened"}]';
const CALLERS = '[{"id":"c1","name":"Jane","phone":"555-0123","note":null,"time":"2026-11-03T10:00:00.000Z","primary":true}]';
// As JSON text: a NUL, half an emoji, a whole emoji (fire), and a backslash typed before u0000.
const ODD_NOTES = '[{"text":"a\\u0000b"},{"text":"cut \\ud83d"},{"text":"fire \\ud83d\\udd25"},{"text":"typed \\\\u0000"}]';
let untouched = '';
// SQL that looks inside the unit lists, like a busy-unit check would (skipping rows that hold no list).
const unitsOnE12 = `SELECT count(*) FROM dispatcher_incidents,
    jsonb_array_elements(CASE WHEN jsonb_typeof(assigned) = 'array' THEN assigned ELSE '[]' END) u
    WHERE u->>'uid' = 'ANDROID-e12'`;

test('a v1.4.0 database with lists and settings stored as JSON strings', () => {
    psql('DROP TABLE IF EXISTS dispatcher_incidents, dispatcher_events, dispatcher_settings CASCADE;');
    psql(fixture);
    psql(`
        UPDATE dispatcher_incidents SET assigned = to_jsonb('${UNITS}'::text), notes = to_jsonb('${NOTES}'::text),
                                        callers = to_jsonb('${CALLERS}'::text) WHERE id = 'inc-1';
        -- Twice over: a string holding a string holding the list.
        UPDATE dispatcher_incidents SET assigned = to_jsonb(to_jsonb('${UNITS}'::text)::text) WHERE id = 'inc-3';
        -- Junk the readers already show as an empty list: must not break the start.
        INSERT INTO dispatcher_incidents (id, event_id, number, status, assigned, notes, callers)
        VALUES ('inc-junk', 'ev-ds', 'DS-003', 'active', to_jsonb('{"uid":"x"}'::text), to_jsonb('not json'::text), '[]'::jsonb);
        -- Text real jsonb refuses (NUL, half an emoji) next to text it takes (a whole emoji, a typed
        -- backslash), and a NUL wrapped twice. The old shape stored all of these.
        INSERT INTO dispatcher_incidents (id, event_id, number, status, assigned, notes, callers)
        VALUES ('inc-text', 'ev-ds', 'DS-004', 'active', '[]'::jsonb,
                to_jsonb('${ODD_NOTES}'::text),
                to_jsonb(to_jsonb('[{"id":"c9","name":"N\\u0000","primary":true}]'::text)::text));
        -- Settings as the old PUT stored them (agency, switch, number, list), plus two text settings: one
        -- stored by the PUT (JSON inside the string) and the fixture's hand-typed one (cjis_reminder_text).
        UPDATE dispatcher_settings SET value = to_jsonb('{"name":"Old Agency"}'::text) WHERE key = 'agency';
        UPDATE dispatcher_settings SET value = to_jsonb('true'::text) WHERE key = 'cjis_reminder_enabled';
        UPDATE dispatcher_settings SET value = to_jsonb('["Welfare check"]'::text) WHERE key = 'incident_types';
        INSERT INTO dispatcher_settings (key, value) VALUES
            ('closed_marker_minutes', to_jsonb('30'::text)),
            ('report_title', to_jsonb('"123"'::text));
    `);
    assert.equal(typeOf('inc-1', 'assigned'), 'string');
    // This is the bug: SQL that looks inside the column finds no units.
    assert.equal(one(unitsOnE12), '0');
    untouched = one("SELECT assigned::text || notes::text || callers::text FROM dispatcher_incidents WHERE id = 'inc-2'");
});

test('the schema bootstrap unwraps them on start', () => {
    runBootstrap();
    for (const col of ['assigned', 'notes', 'callers']) assert.equal(typeOf('inc-1', col), 'array', col);
    assert.equal(typeOf('inc-3', 'assigned'), 'array');
    assert.equal(one(unitsOnE12), '2');
});

test('the lists keep their contents and load with the current query', () => {
    const list = rows(listIncidents);
    const a = list.find(r => r.id === 'inc-1');
    assert.deepEqual(a.assigned, JSON.parse(UNITS));
    assert.deepEqual(a.notes, JSON.parse(NOTES));
    assert.deepEqual(a.callers, JSON.parse(CALLERS));
    assert.deepEqual(rows("SELECT assigned FROM dispatcher_incidents WHERE id = 'inc-3'")[0].assigned, JSON.parse(UNITS));
});

test('rows that already held lists are left alone; junk becomes the empty list the readers showed', () => {
    assert.equal(one("SELECT assigned::text || notes::text || callers::text FROM dispatcher_incidents WHERE id = 'inc-2'"), untouched);
    assert.equal(one("SELECT assigned::text || ' ' || notes::text FROM dispatcher_incidents WHERE id = 'inc-junk'"), '[] []');
    // Nothing is left holding a string, so SQL over the lists can rely on them being lists.
    assert.equal(one("SELECT count(*) FROM dispatcher_incidents WHERE 'string' IN (jsonb_typeof(assigned), jsonb_typeof(notes), jsonb_typeof(callers))"), '0');
});

test('NUL and half emoji are dropped, everything else in the text is kept', () => {
    const [r] = rows("SELECT notes, callers FROM dispatcher_incidents WHERE id = 'inc-text'");
    assert.deepEqual(r.notes.map(n => n.text), ['ab', 'cut ', 'fire \u{1F525}', 'typed \\u0000']);
    assert.equal(r.callers[0].name, 'N');
});

test('settings: objects, lists, true/false and numbers are unwrapped; text settings stay text', () => {
    assert.equal(setting('agency'), 'object {"name": "Old Agency"}');
    assert.equal(setting('cjis_reminder_enabled'), 'boolean true');
    assert.equal(setting('incident_types'), 'array ["Welfare check"]');
    assert.equal(setting('closed_marker_minutes'), 'number 30');
    // The text "123" must not become the number 123, and a hand-typed text is not JSON at all.
    assert.equal(setting('report_title'), 'string "\\"123\\""');
    assert.equal(setting('cjis_reminder_text'), 'string "Keep CJIS data out of incidents."');
});

test('the next start changes nothing', () => {
    const before = snapshot();
    runBootstrap();
    assert.equal(snapshot(), before);
});

test('rollback: an older plugin writes a string again, and the next update unwraps it', () => {
    psql(`UPDATE dispatcher_incidents SET notes = to_jsonb('${NOTES}'::text) WHERE id = 'inc-2';`);
    assert.equal(typeOf('inc-2', 'notes'), 'string');
    runBootstrap();
    assert.equal(typeOf('inc-2', 'notes'), 'array');
    assert.equal(one("SELECT notes->0->>'text' FROM dispatcher_incidents WHERE id = 'inc-2'"), 'Incident opened');
});
