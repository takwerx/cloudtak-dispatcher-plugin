-- A Dispatcher v1.4.0 database with data in it: the tables exactly as v1.4.0's schema bootstrap made
-- them (server/plugin-dispatcher.ts at the v1.4.0 tag, main at beea62e), then rows written the way
-- v1.4.0's routes wrote them. upgrade-db-1.4.test.mjs loads this, runs the current schema bootstrap
-- over it and checks the old rows still load (ops #501).
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
ALTER TABLE dispatcher_incidents ADD COLUMN callers JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dispatcher_events ADD COLUMN delivery TEXT NOT NULL DEFAULT 'datasync';
ALTER TABLE dispatcher_incidents ADD COLUMN core_event_id TEXT;
ALTER TABLE dispatcher_incidents ADD COLUMN disposition TEXT;
ALTER TABLE dispatcher_incidents ADD COLUMN disposition_note TEXT;

-- One DataSync event and one broadcast event (broadcast events store '' as their feed).
INSERT INTO dispatcher_events (id, name, prefix, delivery, feed_guid, feed_name, channel, seq, created_by)
VALUES ('ev-ds', '2026-DATASYNC', 'DS', 'datasync', 'feed-guid-1', 'DATASYNC Feed', 'Dispatch', 2, 'dispatcher@example.org'),
       ('ev-bc', '2026-BROADCAST', 'BC', 'broadcast', '', '', 'Field Channel', 2, 'dispatcher@example.org');

INSERT INTO dispatcher_incidents
    (id, event_id, number, type, address, lat, lon, dispatcher, details, report_number,
     callers, core_event_id, status, assigned, notes, disposition, disposition_note)
VALUES
    -- Open incident with two callers and a unit on scene.
    ('inc-1', 'ev-ds', 'DS-001', 'Medical', '1 Main St', 39.1, -105.2, 'Disp A', 'Fall, conscious', 'R-77',
     '[{"id":"c1","name":"Jane","phone":"555-0123","note":null,"time":"2026-11-03T10:00:00.000Z","primary":true},{"id":"c2","name":"Sam","phone":null,"note":"saw it","time":"2026-11-03T10:02:00.000Z","primary":false}]'::jsonb,
     NULL, 'active',
     '[{"uid":"ANDROID-e12","callsign":"E12","status":"on_scene","assigned_at":"2026-11-03T10:01:00.000Z","on_scene_at":"2026-11-03T10:08:00.000Z","cleared_at":null}]'::jsonb,
     '[{"time":"2026-11-03T10:00:00.000Z","text":"Incident opened"}]'::jsonb, NULL, NULL),
    -- Closed incident with a close reason.
    ('inc-2', 'ev-ds', 'DS-002', 'Fire', '2 Oak Ave', 39.2, -105.3, 'Disp B', NULL, NULL,
     '[]'::jsonb, NULL, 'closed', '[]'::jsonb, '[]'::jsonb, 'Report', NULL),
    -- Broadcast incident with a Core Event on the field devices.
    ('inc-3', 'ev-bc', 'BC-001', 'Traffic', '3 Elm Rd', 39.3, -105.4, NULL, 'Two cars', NULL,
     '[{"id":"c3","name":"Pat","phone":"555-0199","note":null,"time":"2026-11-03T11:00:00.000Z","primary":true}]'::jsonb,
     'core-event-1', 'active', '[]'::jsonb,
     '[{"time":"2026-11-03T11:00:00.000Z","text":"Tow requested"}]'::jsonb, NULL, NULL);

UPDATE dispatcher_incidents SET closed_at = now() WHERE id = 'inc-2';

INSERT INTO dispatcher_settings (key, value) VALUES
    ('agency', '{"name":"Old Agency"}'::jsonb),
    ('cjis_reminder_enabled', 'true'::jsonb),
    ('cjis_reminder_text', '"Keep CJIS data out of incidents."'::jsonb),
    ('incident_types', '["Welfare check"]'::jsonb);
