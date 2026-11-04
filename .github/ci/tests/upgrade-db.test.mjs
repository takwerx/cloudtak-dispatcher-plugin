// Proof test for updating a Dispatcher v1.3.0 database to this version, and rolling back (ops #468).
// Needs a real, empty Postgres (CI gives the job a postgres service). Run it the same way CI does:
//   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres node --test .github/ci/tests/upgrade-db.test.mjs
// PSQL overrides the client command, e.g. PSQL="docker exec -i pg psql -U postgres".
//
// It loads fixtures/v1.3.0-db.sql (the v1.3.0 tables with data), then runs the schema bootstrap
// cut out of the real server/plugin-dispatcher.ts, so it tests the statements that ship, not a copy.
// The bootstrap runs every time CloudTAK's API starts, so it has to work on old rows and run twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const src = readFileSync(new URL('../../../server/plugin-dispatcher.ts', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./fixtures/v1.3.0-db.sql', import.meta.url), 'utf8');

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
const listIncidents = routeSql("'List incidents in an event (active + closed)'").replace('${req.params.eventid}', "'ev-old'");
const listEvents = routeSql("schema.get('/dispatcher/events',");

test('the v1.3.0 database loads into a clean Postgres', () => {
    psql('DROP TABLE IF EXISTS dispatcher_incidents, dispatcher_events, dispatcher_settings CASCADE;');
    psql(fixture);
    assert.equal(one('SELECT count(*) FROM dispatcher_incidents'), '2');
});

test('the schema bootstrap runs on the old database, and again on the next start', () => {
    runBootstrap();
    runBootstrap();
});

test('old incidents still load with the current query, new columns empty, nothing lost', () => {
    const rows = psql(`SELECT row_to_json(t) FROM (${listIncidents}) t;`).split('\n').map(l => JSON.parse(l));
    assert.equal(rows.length, 2);
    const [a, b] = rows;
    assert.equal(a.number, 'OLD-001');
    assert.equal(a.report_number, 'R-77');
    assert.equal(a.details, 'Fall, conscious');
    assert.deepEqual(a.assigned.map(u => u.callsign), ['E12', 'M4']);
    assert.equal(a.notes.length, 1);
    assert.deepEqual(a.callers, []);
    assert.equal(a.disposition, null);
    assert.equal(a.core_event_id, null);
    assert.equal(a.status, 'active');
    assert.equal(b.status, 'closed');
    assert.ok(b.closed_at);
    assert.equal(b.disposition, null);
});

test('the old event stays a DataSync event with its feed and counter', () => {
    const rows = psql(`SELECT row_to_json(t) FROM (${listEvents}) t;`).split('\n').map(l => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].delivery, 'datasync');
    assert.equal(rows[0].feed_guid, 'feed-guid-1');
    assert.equal(rows[0].channel, 'Dispatch');
    assert.equal(rows[0].seq, 3);
    assert.equal(one("SELECT value->>'name' FROM dispatcher_settings WHERE key = 'agency'"), 'Old Agency');
});

test('rollback: v1.3.0 queries still read and write the updated tables', () => {
    // A row the new version writes: callers, a disposition, unit times.
    psql(`UPDATE dispatcher_incidents SET
              callers = '[{"id":"c1","name":"Jane","phone":"555-0123","note":null,"time":"2026-11-03T10:00:00.000Z","primary":true}]'::jsonb,
              disposition = 'Report', status = 'closed', closed_at = now(),
              assigned = '[{"uid":"ANDROID-e12","callsign":"E12","status":"cleared","assigned_at":"2026-11-03T10:00:00.000Z","cleared_at":"2026-11-03T10:30:00.000Z"}]'::jsonb
          WHERE id = 'inc-1';`);
    // v1.3.0's own list queries (server/plugin-dispatcher.ts at v1.3.0).
    const incidents = psql(`SELECT id, event_id, number, type, address, lat, lon, dispatcher, details,
                                   report_number, status, assigned, notes, created_at, closed_at
                            FROM dispatcher_incidents WHERE event_id = 'ev-old' ORDER BY created_at ASC;`);
    assert.equal(incidents.split('\n').length, 2);
    const events = psql(`SELECT id, name, prefix, feed_guid, feed_name, channel, status, seq, created_at, created_by
                         FROM dispatcher_events ORDER BY created_at DESC;`);
    assert.equal(events.split('\n').length, 1);
    // v1.3.0's inserts leave the new columns out; their defaults must fill them.
    psql(`INSERT INTO dispatcher_events (id, name, prefix, feed_guid, feed_name, channel, created_by)
          VALUES ('ev-rb', 'ROLLBACK', 'RB', 'feed-guid-2', 'RB Feed', NULL, 'dispatcher@example.org');
          INSERT INTO dispatcher_incidents
              (id, event_id, number, type, address, lat, lon, dispatcher, details, report_number, notes)
          VALUES ('inc-rb', 'ev-rb', 'RB-001', 'Medical', NULL, 39.0, -105.0, NULL, NULL, NULL, '[]'::jsonb);`);
    assert.equal(one("SELECT delivery FROM dispatcher_events WHERE id = 'ev-rb'"), 'datasync');
    assert.equal(one("SELECT callers::text FROM dispatcher_incidents WHERE id = 'inc-rb'"), '[]');
    // And updating to this version again after the rollback is still fine.
    runBootstrap();
    assert.equal(one('SELECT count(*) FROM dispatcher_incidents'), '3');
});
