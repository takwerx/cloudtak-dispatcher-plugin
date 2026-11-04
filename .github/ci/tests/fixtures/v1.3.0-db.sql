-- A Dispatcher v1.3.0 database with data in it: the tables exactly as v1.3.0's schema bootstrap made
-- them (server/plugin-dispatcher.ts at the v1.3.0 tag), then rows written the way v1.3.0's routes
-- wrote them. upgrade-db.test.mjs loads this, runs the current schema bootstrap over it and checks
-- the old rows still load (ops #468).
CREATE TABLE dispatcher_events (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    prefix      TEXT NOT NULL,
    feed_guid   TEXT NOT NULL,
    feed_name   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    seq         INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  TEXT
);
CREATE TABLE dispatcher_incidents (
    id          TEXT PRIMARY KEY,
    event_id    TEXT NOT NULL REFERENCES dispatcher_events(id) ON DELETE CASCADE,
    number      TEXT NOT NULL,
    type        TEXT,
    address     TEXT,
    lat         DOUBLE PRECISION,
    lon         DOUBLE PRECISION,
    dispatcher  TEXT,
    details     TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    assigned    JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at   TIMESTAMPTZ
);
CREATE TABLE dispatcher_settings (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
);
ALTER TABLE dispatcher_events ADD COLUMN channel TEXT;
ALTER TABLE dispatcher_incidents ADD COLUMN report_number TEXT;

INSERT INTO dispatcher_events (id, name, prefix, feed_guid, feed_name, channel, seq, created_by)
VALUES ('ev-old', '2026-OLDFEST', 'OLD', 'feed-guid-1', 'OLDFEST Feed', 'Dispatch', 3, 'dispatcher@example.org');

INSERT INTO dispatcher_incidents
    (id, event_id, number, type, address, lat, lon, dispatcher, details, report_number, assigned, notes)
VALUES
    ('inc-1', 'ev-old', 'OLD-001', 'Medical', '1 Main St', 39.1, -105.2, 'Disp A', 'Fall, conscious', 'R-77',
     '[{"uid":"ANDROID-e12","callsign":"E12"},{"uid":"ANDROID-m4","callsign":"M4"}]'::jsonb,
     '[{"time":"2026-10-30T15:00:00.000Z","text":"Incident opened"}]'::jsonb),
    ('inc-2', 'ev-old', 'OLD-002', 'Fire', '2 Oak Ave', 39.2, -105.3, 'Disp B', NULL, NULL,
     '[]'::jsonb, '[]'::jsonb);

UPDATE dispatcher_incidents SET status = 'closed', closed_at = now() WHERE id = 'inc-2';

INSERT INTO dispatcher_settings (key, value) VALUES ('agency', '{"name":"Old Agency"}'::jsonb);
