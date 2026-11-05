// Proof test for updating a Dispatcher v1.4.0 database to this version, and rolling back (ops #501).
// Same idea as upgrade-db.test.mjs (which starts from v1.3.0); this one starts from the version that
// shipped just before employee numbers and the closed-incident window. Needs a real, empty Postgres
// (CI gives the job a postgres service). Run it the same way CI does:
//   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres node --test .github/ci/tests/upgrade-db-1.4.test.mjs
// PSQL overrides the client command, e.g. PSQL="docker exec -i pg psql -U postgres".
//
// It loads fixtures/v1.4.0-db.sql (the v1.4.0 tables with data), then runs the schema bootstrap cut out
// of the real server/plugin-dispatcher.ts, so it tests the statements that ship, not a copy.
// The bootstrap runs every time CloudTAK's API starts, so it has to work on old rows and run twice.
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
assert.ok(bootstrap.length >= 10 && bootstrap.some(s => s.includes('CREATE TABLE IF NOT EXISTS dispatcher_incidents')),
    'could not find the schema bootstrap in the server file');
assert.ok(bootstrap.every(s => !s.includes('${')), 'the schema bootstrap must not take parameters');
const runBootstrap = () => psql(bootstrap.map(s => s.trim()).join(';\n') + ';');

// The current list queries, cut from their routes, with the route parameter filled in.
function routeSql(marker) {
    const at = src.indexOf(marker);
    assert.ok(at > 0, `could not find ${marker} in the server file`);
    return src.slice(at).match(/sql`([\s\S]*?)`/)[1];
}
const listIncidents = routeSql("'List incidents in an event (active + closed)'").replace('${req.params.eventid}', "'ev-ds'");
const rows = (q) => psql(`SELECT row_to_json(t) FROM (${q}) t;`).split('\n').map(l => JSON.parse(l));

test('the v1.4.0 database loads into a clean Postgres', () => {
    psql('DROP TABLE IF EXISTS dispatcher_incidents, dispatcher_events, dispatcher_settings CASCADE;');
    psql(fixture);
    assert.equal(one('SELECT count(*) FROM dispatcher_incidents'), '3');
});

test('the schema bootstrap runs on the old database, and again on the next start', () => {
    runBootstrap();
    runBootstrap();
});

test('old incidents still load with the current query; the new employee-number columns are empty', () => {
    const list = rows(listIncidents);
    assert.equal(list.length, 2);
    const a = list.find(r => r.number === 'DS-001');
    const b = list.find(r => r.number === 'DS-002');
    assert.equal(a.report_number, 'R-77');
    assert.equal(a.details, 'Fall, conscious');
    assert.deepEqual(a.callers.map(c => c.name), ['Jane', 'Sam']);
    assert.equal(a.assigned[0].status, 'on_scene');
    assert.equal(a.assigned[0].on_scene_at, '2026-11-03T10:08:00.000Z');
    assert.equal(a.status, 'active');
    assert.equal(b.status, 'closed');
    assert.ok(b.closed_at);
    assert.equal(b.disposition, 'Report');
    for (const r of list) {
        assert.equal(r.created_by_no, null);
        assert.equal(r.initial_dispatcher_no, null);
        assert.equal(r.closed_by_no, null);
    }
    // The broadcast event's incident is untouched too.
    const bc = rows("SELECT number, core_event_id, callers FROM dispatcher_incidents WHERE event_id = 'ev-bc'");
    assert.equal(bc.length, 1);
    assert.equal(bc[0].core_event_id, 'core-event-1');
    assert.equal(bc[0].callers[0].phone, '555-0199');
});

test('both events keep their delivery mode, feed, channel and counter', () => {
    const ev = rows('SELECT id, delivery, feed_guid, channel, seq FROM dispatcher_events ORDER BY id');
    assert.deepEqual(ev, [
        { id: 'ev-bc', delivery: 'broadcast', feed_guid: '', channel: 'Field Channel', seq: 2 },
        { id: 'ev-ds', delivery: 'datasync', feed_guid: 'feed-guid-1', channel: 'Dispatch', seq: 2 },
    ]);
});

test('settings are kept, and the two new settings stay unset, which means switch off and 60 minutes', () => {
    assert.equal(one("SELECT value->>'name' FROM dispatcher_settings WHERE key = 'agency'"), 'Old Agency');
    assert.equal(one("SELECT value::text FROM dispatcher_settings WHERE key = 'cjis_reminder_enabled'"), 'true');
    assert.equal(one("SELECT value->>0 FROM dispatcher_settings WHERE key = 'incident_types'"), 'Welfare check');
    // Nothing writes these on update: a missing row is "employee numbers off" and "keep closed incidents 60 minutes".
    assert.equal(one("SELECT count(*) FROM dispatcher_settings WHERE key IN ('operator_numbers', 'closed_marker_minutes')"), '0');
});

test('rollback: v1.4.0 queries still read and write the updated tables', () => {
    // A row the new version writes with employee numbers on.
    psql(`UPDATE dispatcher_incidents SET created_by_no = '1042', initial_dispatcher_no = '1042',
              closed_by_no = '2210', status = 'closed', closed_at = now() WHERE id = 'inc-1';`);
    // v1.4.0's own list queries (server/plugin-dispatcher.ts at v1.4.0).
    const incidents = psql(`SELECT id, event_id, number, type, address, lat, lon, dispatcher, details,
                                   report_number, callers, core_event_id, status, assigned, notes, created_at, closed_at, disposition, disposition_note
                            FROM dispatcher_incidents WHERE event_id = 'ev-ds' ORDER BY created_at ASC;`);
    assert.equal(incidents.split('\n').length, 2);
    const events = psql(`SELECT id, name, prefix, delivery, feed_guid, feed_name, channel, status, seq, created_at, created_by
                         FROM dispatcher_events ORDER BY created_at DESC;`);
    assert.equal(events.split('\n').length, 2);
    // v1.4.0's inserts leave the new columns out; they must stay empty.
    psql(`INSERT INTO dispatcher_incidents
              (id, event_id, number, type, address, lat, lon, dispatcher, details, report_number, callers, notes)
          VALUES ('inc-rb', 'ev-ds', 'DS-099', 'Medical', NULL, 39.0, -105.0, NULL, NULL, NULL, '[]'::jsonb, '[]'::jsonb);`);
    assert.equal(one("SELECT created_by_no IS NULL FROM dispatcher_incidents WHERE id = 'inc-rb'"), 't');
    // And updating to this version again after the rollback is still fine, and keeps what the new version wrote.
    runBootstrap();
    assert.equal(one('SELECT count(*) FROM dispatcher_incidents'), '4');
    assert.equal(one("SELECT closed_by_no FROM dispatcher_incidents WHERE id = 'inc-1'"), '2210');
});
