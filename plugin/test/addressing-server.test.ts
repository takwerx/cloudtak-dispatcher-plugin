// Proof tests for the local address data matcher. Plain node, no CloudTAK and no database:
//   node --test plugin/test/*.test.ts
// The pure logic between `// <addressing-pure>` markers in server/plugin-addressing.ts (street
// normalisation, query parsing, row shaping, unit collapsing, the map-click choice, CSV parsing,
// column guessing) is cut out of the real file and run. It is the code that ships, not a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const server = readFileSync(new URL('../../server/plugin-addressing.ts', import.meta.url), 'utf8');
const block = server.slice(server.indexOf('// <addressing-pure>'), server.indexOf('// </addressing-pure>'));
assert.ok(block.includes('export function parseQuery'), 'could not find the pure block in the server file');

const dir = mkdtempSync(join(tmpdir(), 'addressing-'));
const sfile = join(dir, 'server.ts');
writeFileSync(sfile, block);
const s = await import(pathToFileURL(sfile).href);

const settings = s.normAddressSettings({ enabled: true });

// ── Normalisation ─────────────────────────────────────────────────────────────────────────────

test('normStreet: one form for street types and directions, any case or punctuation', () => {
    assert.equal(s.normStreet('North Main Street'), 'N MAIN ST');
    assert.equal(s.normStreet('n. main st.'), 'N MAIN ST');
    assert.equal(s.normStreet('W 5th Avenue'), 'W 5TH AVE');
    assert.equal(s.normStreet('Old Mill Highway'), 'OLD MILL HWY');
    assert.equal(s.normStreet('  Lake   Shore Pkwy '), 'LAKE SHORE PKWY');
});

test('streetFromParts: parts when a name is given, else the full street field', () => {
    assert.equal(s.streetFromParts({ prefix_dir: 'E', street_name: 'Harbor View', street_type: 'Boulevard' }), 'E HARBOR VIEW BLVD');
    assert.equal(s.streetFromParts({ full_street: 'E Harbor View Blvd' }), 'E HARBOR VIEW BLVD');
    assert.equal(s.streetFromParts({ street_name: '', full_street: 'C Street' }), 'C ST');
});

// ── Query parsing ─────────────────────────────────────────────────────────────────────────────

test('parseQuery: an address with a unit, in the ways dispatchers type it', () => {
    for (const q of ['123 N Main St Apt 4', '123 north main street #4', '123 N MAIN ST UNIT 4']) {
        const p = s.parseQuery(q);
        assert.equal(p.kind, 'address', q);
        assert.equal(p.number, 123);
        assert.equal(p.street, 'N MAIN ST');
        assert.equal(p.unit, '4');
    }
    const noUnit = s.parseQuery('45 Lake Shore');
    assert.equal(noUnit.unit, null);
    assert.equal(noUnit.street, 'LAKE SHORE');
});

test('parseQuery: intersections with &, and, /, at', () => {
    for (const q of ['Main & 5th', 'Main St and 5th Ave', 'main/5th', 'Main at 5th']) {
        const p = s.parseQuery(q);
        assert.equal(p.kind, 'intersection', q);
        assert.ok(p.street.startsWith('MAIN'));
        assert.ok(p.street2.startsWith('5TH'));
    }
});

test('parseQuery: free text (a place name, or a bare number) is text', () => {
    assert.equal(s.parseQuery('fire station 3').kind, 'text');
    assert.equal(s.parseQuery('123').kind, 'text', 'a number alone is not an address yet');
    assert.deepEqual(s.parseQuery('fire station 3').words, ['FIRE', 'STATION', '3']);
});

// ── Row shaping ───────────────────────────────────────────────────────────────────────────────

test('toDbRow points: label from parts, normalised street, integer house number, dropped when unusable', () => {
    const { row } = s.toDbRow('points', { house_number: '123', prefix_dir: 'N', street_name: 'Main', street_type: 'St', unit_type: 'APT', unit: '4', city: 'Town', zip: 12345, lat: '44.5', lon: '-123.2' });
    assert.equal(row.street, 'N MAIN ST');
    assert.equal(row.house_number, 123);
    assert.equal(row.label, '123 N Main St APT 4');
    assert.equal(row.unit, '4');
    assert.equal(row.zip, '12345');
    assert.equal(row.lat, 44.5);
    assert.equal(s.toDbRow('points', { house_number: 1, street_name: 'X' }).reason, 'no coordinates');
    assert.equal(s.toDbRow('points', { house_number: 1, lat: 1, lon: 1 }).reason, 'no street name');
    assert.equal(s.toDbRow('points', { street_name: 'X', lat: 1, lon: 1 }).reason, 'no house number');
    assert.equal(s.toDbRow('points', { house_number: 1, street_name: 'X', lat: 0, lon: 0 }).reason, 'no coordinates', '0,0 is not a location');
});

test('toDbRow points: the full address text is the label when the file has one', () => {
    const { row } = s.toDbRow('points', { house_number: 7, street_name: 'Elm', full_address: '7 ELM ST, TOWN ST 12345', lat: 1, lon: 2 });
    assert.equal(row.label, '7 ELM ST, TOWN ST 12345');
    assert.equal(row.search, '7 ELM ST TOWN ST 12345');
});

test('toDbRow intersections: two or more streets, normalised, label joined with &', () => {
    const { row } = s.toDbRow('intersections', { street1: 'Main Street', street2: '5th Avenue', street3: '', city_state_zip: 'Town ST 12345', lat: 1, lon: 2 });
    assert.deepEqual(row.streets, ['MAIN ST', '5TH AVE']);
    assert.equal(row.label, 'Main Street & 5th Avenue');
    assert.equal(row.city, 'Town ST 12345');
    assert.equal(s.toDbRow('intersections', { street1: 'Main', lat: 1, lon: 2 }).reason, 'fewer than two street names');
});

test('toDbRow places: name required, address or coordinates required, aliases searchable, no location left unresolved', () => {
    const { row } = s.toDbRow('places', { name: 'Fire Station 3', aliases: 'Station 3; FS3', category: 'Station', address: '123 Main St', city: 'Town' });
    assert.equal(row.search, 'FIRE STATION 3 | STATION 3 | FS3');
    assert.equal(row.aliases, 'Station 3; FS3');
    assert.equal(row.lat, null);
    assert.equal(row.resolved, null);
    const given = s.toDbRow('places', { name: 'Park', lat: 1, lon: 2 }).row;
    assert.equal(given.resolved, 'given');
    assert.equal(s.toDbRow('places', { aliases: 'x', address: '1 A St' }).reason, 'no name');
    assert.equal(s.toDbRow('places', { name: 'x' }).reason, 'no address and no coordinates');
});

// ── Units ─────────────────────────────────────────────────────────────────────────────────────

const pt = (over = {}) => ({
    kind: 'points', label: '123 MAIN ST', search: '123 MAIN ST', street: 'MAIN ST', house_number: 123, unit: null,
    city: 'Town', state: 'ST', zip: null, streets: null, name: null, aliases: null, category: null, address: null,
    lat: 44.5, lon: -123.2, resolved: 'given', as_of: '2026-11-01T00:00:00Z', ...over,
});

test('collapseUnits: one base address with many units is one suggestion carrying the units', () => {
    const rows = [pt(), pt({ label: '123 MAIN ST APT 1', unit: '1', lat: 44.5001 }), pt({ label: '123 MAIN ST APT 2', unit: '2' }), pt({ label: '9 OAK ST', house_number: 9, street: 'OAK ST' })];
    const out = s.collapseUnits(rows);
    assert.equal(out.length, 2);
    assert.equal(out[0].label, '123 MAIN ST (2 units)');
    assert.equal(out[0].lat, 44.5, 'the unit-less row is the base');
    assert.deepEqual(out[0].units.map((u: { unit: string }) => u.unit), ['1', '2']);
    assert.equal(out[0].asOf, '2026-11-01T00:00:00Z');
    assert.equal(out[1].label, '9 OAK ST');
    assert.equal(out[1].units, undefined);
});

test('collapseUnits: only unit rows (no base row) still make one suggestion with a plain base label', () => {
    const out = s.collapseUnits([pt({ label: '123 MAIN ST APT 1', unit: '1' }), pt({ label: '123 MAIN ST APT 2', unit: '2' })]);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, '123 MAIN ST (2 units)');
    assert.equal(out[0].units.length, 2);
});

test('collapseUnits: keeps the nearest distance of the group', () => {
    const out = s.collapseUnits([pt({ dist: 40 }), pt({ label: '123 MAIN ST APT 1', unit: '1', dist: 12 })]);
    assert.equal(out[0].distance, 12);
});

// ── Map click choice ──────────────────────────────────────────────────────────────────────────

const sug = (kind: string, distance: number, over = {}) => ({
    source: kind === 'place' ? 'place' : 'local', kind, label: `${kind} ${distance}`, lat: 0, lon: 0,
    streetName: '', city: '', state: '', zipCode: '', country: '', distance, ...over,
});

test('chooseReverse: an intersection inside its radius that is as close as the point wins', () => {
    const r = s.chooseReverse({ point: sug('point', 30), intersection: sug('intersection', 25), place: null, others: [] }, settings);
    assert.equal(r.best.kind, 'intersection');
    assert.deepEqual(r.alternates.map((a: { kind: string }) => a.kind), ['point']);
});

test('chooseReverse: a nearer address point beats a farther intersection', () => {
    const r = s.chooseReverse({ point: sug('point', 10), intersection: sug('intersection', 35), place: null, others: [] }, settings);
    assert.equal(r.best.kind, 'point');
});

test('chooseReverse: outside both radii nothing is applied (the public geocoder is next)', () => {
    const r = s.chooseReverse({ point: sug('point', 90), intersection: sug('intersection', 70), place: null, others: [] }, settings);
    assert.equal(r.best, null);
    assert.equal(r.alternates.length, 2, 'but both are still offered as alternates inside the give-up distance');
});

test('chooseReverse: a place within its radius is the first alternate, never the best by itself', () => {
    const r = s.chooseReverse({ point: sug('point', 20), intersection: null, place: sug('place', 8), others: [sug('point', 55)] }, settings);
    assert.equal(r.best.kind, 'point');
    assert.equal(r.alternates[0].kind, 'place');
    assert.equal(r.alternates.length, 2);
});

test('chooseReverse: alternates beyond the give-up distance are dropped', () => {
    const r = s.chooseReverse({ point: sug('point', 20), intersection: null, place: null, others: [sug('point', 500)] }, settings);
    assert.deepEqual(r.alternates, []);
});

// ── Settings ──────────────────────────────────────────────────────────────────────────────────

test('toDbRow: a place number is searchable without its leading zero', () => {
    const r = s.toDbRow('places', { name: 'Fire Station 08', address: '120 Cedar St', lat: 44.5, lon: -123.2 }).row;
    assert.match(r.search, /FIRE STATION 08 \| FIRE STATION 8$/);
    assert.equal(s.toDbRow('places', { name: 'Old Mill Diner', lat: 44.5, lon: -123.2 }).row.search, 'OLD MILL DINER');
});

test('fillBlanks: blanks from the verified address, country from the default, place street tidied', () => {
    const place = { source: 'place', kind: 'place', label: 'Old Mill Diner', lat: 44.5, lon: -123.2,
        streetName: '120 Cedar St, Springfield, ST, 12345', city: 'Riverside', state: '', zipCode: '', country: '' };
    const out = s.fillBlanks(place, { city: 'Springfield', state: 'ST', zip: '12345' }, 'United States');
    assert.equal(out.city, 'Riverside', 'a value the source gave is kept');
    assert.equal(out.state, 'ST');
    assert.equal(out.zipCode, '12345');
    assert.equal(out.country, 'United States');
    assert.equal(out.streetName, '120 Cedar St');
    // Nothing to borrow from: the full address line stays, only the country is added.
    const bare = s.fillBlanks(place, null, 'United States');
    assert.equal(bare.streetName, place.streetName);
    assert.equal(bare.state, '');
    assert.equal(bare.country, 'United States');
    // A public result is never touched.
    const osm = { ...place, source: 'osm', kind: 'osm' };
    assert.equal(s.fillBlanks(osm, { city: 'X', state: 'Y', zip: 'Z' }, 'United States'), osm);
    assert.equal(s.normAddressSettings({ default_country: '  Canada ' }).default_country, 'Canada');
});

test('normAddressSettings: defaults, clamps and off unless explicitly on', () => {
    assert.deepEqual(s.normAddressSettings(undefined), s.ADDRESS_SETTINGS_DEFAULT);
    assert.equal(s.normAddressSettings({ enabled: 'yes' }).enabled, false);
    assert.equal(s.normAddressSettings({ enabled: true, radius_point: 1 }).radius_point, 5);
    assert.equal(s.normAddressSettings({ radius_giveup: 99999 }).radius_giveup, 5000);
    assert.equal(s.normAddressSettings({ min_chars: 'x' }).min_chars, 2);
});

test('a map click keeps its point: nothing moves it onto the matched address', () => {
    // A stored setting from an earlier build is dropped, and nothing in the server or the form reads one.
    assert.equal('snap_default' in s.normAddressSettings({ snap_default: true }), false);
    const form = readFileSync(new URL('../components/IncidentForm.vue', import.meta.url), 'utf8');
    for (const text of [server, form]) assert.doesNotMatch(text, /snap/i);
    assert.ok(form.includes('match.value = { best, alternates, clicked: true };'));
    assert.ok(form.includes('if (best) fillFrom(best, false);'), 'the address is filled in, the coordinates are not');
    assert.ok(form.includes('if (!m?.best?.units?.length || m.clicked) return;'), 'a unit does not move a clicked point either');
});

// ── Geometry ──────────────────────────────────────────────────────────────────────────────────

test('distanceM and bbox: a 100 m box contains a point 60 m away and not one 200 m away', () => {
    const lat = 44.5, lon = -123.2;
    const b = s.bbox(lat, lon, 100);
    const near = { lat: lat + 60 / 111320, lon };
    const far = { lat, lon: lon + 200 / (111320 * Math.cos(lat * Math.PI / 180)) };
    assert.ok(near.lat <= b.maxLat && near.lat >= b.minLat);
    assert.ok(far.lon > b.maxLon);
    assert.ok(Math.abs(s.distanceM(lat, lon, near.lat, near.lon) - 60) < 1);
    assert.ok(Math.abs(s.distanceM(lat, lon, far.lat, far.lon) - 200) < 2);
});

// ── Web pull helpers ──────────────────────────────────────────────────────────────────────────

test('esriLayerUrl: a Feature Service layer with or without a query string; other URLs are not one', () => {
    assert.equal(s.esriLayerUrl('https://host/arcgis/rest/services/Addresses/FeatureServer/0'), 'https://host/arcgis/rest/services/Addresses/FeatureServer/0');
    assert.equal(s.esriLayerUrl('https://host/x/MapServer/3/?f=json'), 'https://host/x/MapServer/3');
    assert.equal(s.esriLayerUrl('https://host/data/addresses.geojson'), null);
});

test('applyMapping: mapped columns only, GeoJSON geometry gives lat and lon', () => {
    const row = s.applyMapping({ house_number: 'HN', street_name: 'SN' }, { HN: 5, SN: 'Elm', OTHER: 'x' }, { type: 'Point', coordinates: [-1, 2] });
    assert.deepEqual(row, { house_number: 5, street_name: 'Elm', lon: -1, lat: 2 });
});

test('parseCsv (server copy): same reading as the browser', () => {
    const { columns, rows } = s.parseCsv('# note\na,b\n"1,2",3\n');
    assert.deepEqual(columns, ['a', 'b']);
    assert.deepEqual(rows[0], { a: '1,2', b: '3' });
});

// ── The downloadable example files ────────────────────────────────────────────────────────────

test('example CSVs: every row of every kind is accepted by the server row shaping', async () => {
    const ap = await import('../lib/address-parse.ts');
    for (const kind of ['points', 'intersections', 'places'] as const) {
        const f = ap.parseFile(ap.exampleCsv(kind));
        const m = ap.initialMapping(kind, f);
        for (const r of f.rows) {
            const out = s.toDbRow(kind, ap.applyMapping(m, r));
            assert.ok(out.row, `${kind}: ${JSON.stringify(r)} dropped: ${out.reason}`);
        }
    }
});

// ── Typing a street without its direction ─────────────────────────────────────────────────────

test('streetScore: the leading direction is optional, and the whole name beats a longer name', () => {
    assert.equal(s.streetScore('W 32ND AVE', '32ND'), 1, 'name only');
    assert.equal(s.streetScore('W 32ND AVE', '32ND AVE'), 0, 'name and type');
    assert.equal(s.streetScore('W 32ND AVE', 'W 32ND AVE'), 0);
    assert.equal(s.streetScore('W 32ND AVE', 'E 32ND'), 1.5, 'a different typed direction still matches, a little lower');
    assert.equal(s.streetScore('C ST', 'C'), 1);
    assert.equal(s.streetScore('C ST', 'C ST'), 0);
    assert.equal(s.streetScore('CEDAR DR', 'C'), 3, 'only starts with it');
    assert.equal(s.streetScore('LAKE SHORE PKWY', 'LAKE'), 2, 'a longer name');
    assert.equal(s.streetScore('MAIN ST', 'OAK'), 9);
    assert.equal(s.streetScore('N MAIN ST', 'MAIN ST N'), 9, 'not a prefix');
});

test('intersectionScore: "32nd and C st" ranks W 32nd Ave & C St first among look-alikes', () => {
    const q = s.parseQuery('32nd and C st');
    const rows = [
        ['W 32ND AVE', 'CEDAR DR'], ['W 32ND AVE', 'C ST'], ['E 32ND AVE', 'CHERRY ST'], ['W 33RD AVE', 'C ST'],
    ];
    const ranked = rows.map(r => ({ r, score: s.intersectionScore(r, q.street, q.street2) }))
        .filter(x => x.score < 99).sort((x, y) => x.score - y.score);
    assert.deepEqual(ranked[0].r, ['W 32ND AVE', 'C ST']);
    assert.equal(ranked.length, 1, 'C ST typed with its type does not match Cedar or Cherry');
    // typed loosely, the exact names still come first
    const loose = s.parseQuery('c & 32nd');
    const r2 = rows.map(r => ({ r, score: s.intersectionScore(r, loose.street, loose.street2) }))
        .filter(x => x.score < 99).sort((x, y) => x.score - y.score);
    assert.deepEqual(r2[0].r, ['W 32ND AVE', 'C ST']);
    assert.equal(r2.length, 3);
});

test('intersectionScore: one stored street cannot answer both typed streets', () => {
    assert.equal(s.intersectionScore(['MAIN ST', 'OAK AVE'], 'MAIN', 'MAIN'), 99);
});

test('streetScore: a bare number is the numbered street ("32" is 32ND; "3" is 3RD before 30TH)', () => {
    assert.equal(s.streetScore('W 32ND AVE', '32'), 1);
    assert.equal(s.streetScore('E 3RD AVE', '3'), 1);
    assert.equal(s.streetScore('E 30TH AVE', '3'), 3);
    assert.equal(s.streetScore('W 32ND AVE', '32 AVE'), 0);
    assert.equal(s.streetScore('W 32ND AVE', '32ND'), 1, 'typing the ordinal still works');
    const q = s.parseQuery('32 & C');
    assert.equal(s.intersectionScore(['W 32ND AVE', 'C ST'], q.street, q.street2), 2);
});

// ── Public search area ────────────────────────────────────────────────────────────────────────

test('osm limit: off by default; on only with a centre; radius clamped', () => {
    const d = s.normAddressSettings({});
    assert.equal(d.osm_limit, false);
    assert.equal(d.osm_radius_km, 50);
    assert.equal(s.normAddressSettings({ osm_limit: true }).osm_limit, false, 'no centre: stays off so results are never all hidden');
    assert.equal(s.normAddressSettings({ osm_limit: true, osm_lat: 44.5, osm_lon: -123.2 }).osm_limit, true);
    assert.equal(s.normAddressSettings({ osm_limit: true, osm_lat: 95, osm_lon: -123.2 }).osm_limit, false, 'a latitude off the globe is no centre');
    assert.equal(s.normAddressSettings({ osm_lat: '44.5', osm_lon: '' }).osm_lat, 44.5);
    assert.equal(s.normAddressSettings({ osm_lat: '44.5', osm_lon: '' }).osm_lon, null);
    assert.equal(s.normAddressSettings({ osm_radius_km: 0 }).osm_radius_km, 1);
});

test('osm limit: viewbox is left,top,right,bottom around the centre; null when off', () => {
    assert.equal(s.osmViewbox(s.normAddressSettings({})), null);
    const on = s.normAddressSettings({ osm_limit: true, osm_lat: 44.5, osm_lon: -123.2, osm_radius_km: 50 });
    const [left, top, right, bottom] = s.osmViewbox(on).split(',').map(Number);
    assert.ok(left < -123.2 && right > -123.2 && top > 44.5 && bottom < 44.5);
    assert.ok(Math.abs((top - bottom) * 111.32 - 100) < 0.5, 'about 100 km tall');
});

test('osm limit: results outside the circle are dropped, including the corners of the box', () => {
    const on = s.normAddressSettings({ osm_limit: true, osm_lat: 44.5, osm_lon: -123.2, osm_radius_km: 50 });
    assert.equal(s.osmInArea(on, 44.6, -123.3), true);
    assert.equal(s.osmInArea(on, 14.6, -90.5), false, 'another country');
    const b = s.bbox(44.5, -123.2, 50000);
    assert.equal(s.osmInArea(on, b.maxLat - 0.001, b.maxLon - 0.001), false, 'inside the box, outside the circle');
    assert.equal(s.osmInArea(s.normAddressSettings({}), 14.6, -90.5), true, 'limit off: anywhere');
});

// ── Other agencies' data ──────────────────────────────────────────────────────────────────────

test('toDbRow points: a house number with a letter, fraction or range is kept under its first number', () => {
    const at = { street_name: 'Main St', lat: 44.5, lon: -123.2 };
    for (const [given, label] of [['21-A', '21-A Main St'], ['120 1/2', '120 1/2 Main St'], ['12-14', '12-14 Main St'], ['7B', '7B Main St'], [' 9 ', '9 Main St'], [15.0, '15 Main St']]) {
        const { row } = s.toDbRow('points', { ...at, house_number: given });
        assert.equal(row.house_number, parseInt(String(given), 10), String(given));
        assert.equal(row.label, label);
    }
    assert.equal(s.toDbRow('points', { ...at, house_number: 'REAR' }).reason, 'no house number');
    assert.equal(s.toDbRow('points', { ...at, house_number: ' ' }).reason, 'no house number', 'a blank is not house number 0');
});

test('toDbRow points: with no street column, the full address after the house number is the street', () => {
    const { row } = s.toDbRow('points', { house_number: 123, full_address: '123 N Main Street Apt 4, Springfield', prefix_dir: 'N', lat: 44.5, lon: -123.2 });
    assert.equal(row.street, 'N MAIN ST');
    assert.equal(row.label, '123 N Main Street Apt 4, Springfield');
    assert.equal(s.streetOfAddress('120 1/2 Oak Ave NW', '120'), 'OAK AVE NW');
    assert.equal(s.streetOfAddress('155 N 100 W', 155), 'N 100 W');
    assert.equal(s.streetOfAddress('9 Lake Shore Pkwy #B', '9'), 'LAKE SHORE PKWY');
    assert.equal(s.streetOfAddress('Main St', '123'), '', 'an address that does not start with the house number is not trusted');
    assert.equal(s.toDbRow('points', { house_number: 123, full_address: 'Main St', lat: 44.5, lon: -123.2 }).reason, 'no street name');
    const parts = s.toDbRow('points', { house_number: 123, street_name: 'Oak', street_type: 'Ave', full_address: '123 Elm St', lat: 44.5, lon: -123.2 }).row;
    assert.equal(parts.street, 'OAK AVE', 'street columns still come first');
});

test('toDbRow: coordinates that are not degrees are dropped with their own reason', () => {
    assert.equal(s.toDbRow('points', { house_number: 1, street_name: 'X', lat: 518036.6, lon: 3668672.3 }).reason, 'coordinates are not latitude and longitude');
    assert.equal(s.toDbRow('intersections', { street1: 'Main St', street2: '5th Ave', lat: 261471.5, lon: 870168.5 }).reason, 'coordinates are not latitude and longitude');
    assert.equal(s.toDbRow('points', { house_number: 1, street_name: 'X', lat: ' ', lon: ' ' }).reason, 'no coordinates');
});

test('normStreet: street type spellings seen in other data', () => {
    assert.equal(s.normStreet('Cedar Crt.'), 'CEDAR CT');
    assert.equal(s.normStreet('Harbor View Terr.'), 'HARBOR VIEW TER');
    assert.equal(s.normStreet('Lake Shore Pky'), 'LAKE SHORE PKWY');
});

test('wktPoint / wktColumn: a point as text in a CSV cell', () => {
    assert.deepEqual(s.wktPoint('POINT (-123.2 44.5)'), { type: 'Point', coordinates: [-123.2, 44.5] });
    assert.deepEqual(s.wktPoint(' point(-123 44) '), { type: 'Point', coordinates: [-123, 44] });
    assert.equal(s.wktPoint('POINT OF INTEREST'), null);
    assert.equal(s.wktPoint(''), null);
    const rows = [{ GEOMETRY: '', name: 'a' }, { GEOMETRY: 'POINT (-123.2 44.5)', name: 'b' }];
    assert.equal(s.wktColumn(['name', 'GEOMETRY'], rows), 'GEOMETRY');
    assert.equal(s.wktColumn(['name'], rows), null);
    const row = s.applyMapping({ street1: 'A', street2: 'B' }, { A: 'Main St', B: '5th Ave' }, s.wktPoint(rows[1].GEOMETRY));
    assert.deepEqual([row.lat, row.lon], [44.5, -123.2]);
});

test('esriLayerUrl: a service address with no layer number is its first layer; a pasted query address works', () => {
    assert.equal(s.esriLayerUrl('https://host/arcgis/rest/services/Addresses/FeatureServer'), 'https://host/arcgis/rest/services/Addresses/FeatureServer/0');
    assert.equal(s.esriLayerUrl('https://host/arcgis/rest/services/Addresses/FeatureServer/'), 'https://host/arcgis/rest/services/Addresses/FeatureServer/0');
    assert.equal(s.esriLayerUrl('https://host/x/MapServer/9/query?where=1%3D1&outFields=*&f=geojson'), 'https://host/x/MapServer/9');
});

test('toDbRow points: a pre-type and pre-modifier go in front of the name, in the street and in the label', () => {
    const at = { house_number: 5534, lat: 44.5, lon: -123.2 };
    const hwy = s.toDbRow('points', { ...at, pre_type: 'Highway', street_name: ' 191' }).row;
    assert.equal(hwy.street, 'HWY 191');
    assert.equal(hwy.label, '5534 Highway 191');
    const old = s.toDbRow('points', { ...at, pre_mod: 'Old', prefix_dir: 'North', pre_type: 'Highway', street_name: '50', suffix_dir: 'E' }).row;
    assert.equal(old.street, 'N OLD HWY 50 E', 'the direction leads the street, so it stays optional when typing');
    assert.equal(old.label, '5534 Old North Highway 50 E');
    const cr = s.toDbRow('points', { ...at, pre_type: 'County Road', street_name: '12' }).row;
    assert.equal(cr.street, 'COUNTY RD 12');
    const plain = s.toDbRow('points', { ...at, pre_mod: ' ', pre_type: '', street_name: 'Main', street_type: 'Street' }).row;
    assert.equal(plain.street, 'MAIN ST', 'blank parts change nothing');
});

test('normStreet / parseQuery: a type in front of a route number is shortened, so what is typed meets what is stored', () => {
    assert.equal(s.normStreet('Highway 191'), 'HWY 191');
    assert.equal(s.normStreet('hwy 191'), 'HWY 191');
    assert.equal(s.normStreet('State Route 9 North'), 'STATE RTE 9 N');
    assert.equal(s.normStreet('Old Mill Highway'), 'OLD MILL HWY');
    assert.equal(s.normStreet('Lake Shore Pkwy'), 'LAKE SHORE PKWY', 'a type word inside a name stays');
    assert.equal(s.normStreet('Avenue B'), 'AVENUE B');
    assert.equal(s.parseQuery('5534 highway 191').street, 'HWY 191');
    assert.equal(s.streetScore('HWY 191', s.parseQuery('5534 hwy 191').street), 0);
});

// ── Found in review ───────────────────────────────────────────────────────────────────────────

test('parseQuery: a fraction after the house number is an address, not an intersection', () => {
    const p = s.parseQuery('120 1/2 Main St');
    assert.equal(p.kind, 'address');
    assert.equal(p.number, 120);
    assert.equal(p.street, 'MAIN ST');
    assert.equal(s.parseQuery('Main / 5th').kind, 'intersection', 'a slash between two streets still is');
});

test('parseQuery: text that reads as two streets keeps every typed word, so a place name with "and" or "&" is still searched', () => {
    const p = s.parseQuery('Fifth and Main Diner');
    assert.equal(p.kind, 'intersection');
    assert.deepEqual(p.words, ['FIFTH', 'AND', 'MAIN', 'DINER'], 'the words the place search needs');
    assert.deepEqual(s.parseQuery('Bed & Bath Store').words, ['BED', '&', 'BATH', 'STORE']);
    // The route searches places for every kind but a house-number address; this pins that in the source.
    const body = server.slice(server.indexOf('async function localSuggest'), server.indexOf('async function nearest'));
    assert.ok(body.indexOf("r.kind = 'places'") < body.indexOf("if (pq.kind === 'intersection')"), 'places are searched before the intersection branch returns');
    assert.ok(body.includes("r.kind = 'places' AND r.lat IS NOT NULL"), 'a place with no location is not offered');
});

test('toDbRow points: a number too large to be a house number drops the row instead of failing the upload', () => {
    const at = { street_name: 'Main St', lat: 44.5, lon: -123.2 };
    assert.equal(s.toDbRow('points', { ...at, house_number: '14302232130000' }).reason, 'no house number');
    assert.equal(s.toDbRow('points', { ...at, house_number: 14302232130000 }).reason, 'no house number');
    assert.equal(s.toDbRow('points', { ...at, house_number: '99999' }).row.house_number, 99999);
});

test('pullDue: a web source is pulled after its interval, and a failed pull waits an hour', () => {
    const h = 3600_000, now = 100 * h;
    assert.equal(s.pullDue(now - 25 * h, 0, 24, now), true, 'past its interval, never failed');
    assert.equal(s.pullDue(now - 23 * h, 0, 24, now), false, 'not yet due');
    assert.equal(s.pullDue(now - 25 * h, now - 60_000, 24, now), false, 'failed a minute ago: not on the next lookup');
    assert.equal(s.pullDue(now - 25 * h, now - 61 * 60_000, 24, now), true, 'failed over an hour ago: try again');
    assert.equal(s.pullDue(0, 0, 24, now), true, 'never pulled');
    assert.equal(s.pullDue(now - 2 * h, now - 2 * h, 24, now), false, 'a failed manual refresh does not make it due early');
});

test('pageKey: the same page sent twice is noticed, different pages and an empty page are not', () => {
    const a = [{ id: 1 }, { id: 2 }], b = [{ id: 3 }, { id: 4 }];
    assert.equal(s.pageKey(a), s.pageKey([{ id: 1 }, { id: 2 }]));
    assert.notEqual(s.pageKey(a), s.pageKey(b));
    assert.equal(s.pageKey([]), '');
    const pull = server.slice(server.indexOf('async function pullSource'), server.indexOf('function maybeRefreshDue'));
    assert.ok(pull.includes('key === lastPage'), 'the pull stops on a repeated page');
});

test('web pulls and map clicks: the as-of date moves with each pull, and the nearest rows are taken first', () => {
    const pull = server.slice(server.indexOf('async function pullSource'), server.indexOf('function maybeRefreshDue'));
    assert.ok(pull.includes('dataAsOf ?? new Date().toISOString()'), 'a source with no edit date is as of this pull');
    const near = server.slice(server.indexOf('async function nearest'), server.indexOf('async function localReverse'));
    assert.ok(near.indexOf('ORDER BY') > 0 && near.indexOf('ORDER BY') < near.indexOf('LIMIT 400'), 'ordered by distance before the limit');
});
