// Proof tests for the browser-side file parsing and field mapping of local address data.
// Plain node, no CloudTAK: lib/address-parse.ts has no CloudTAK imports.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseFile, guessMapping, initialMapping, applyMapping, missingFields, distinctValues, valueCounts, localDay, guessKind, FIELD_GUESSES, KIND_FIELDS, exampleCsv, exampleCsvName } from '../lib/address-parse.ts';
import type { SourceKind } from '../lib/address-parse.ts';
import { streetWithUnit, detailsWithPlace, unitChoices, unitNamed, sameUnit, UNIT_CHOICES } from '../lib/address-form.ts';
import { readFileSync } from 'node:fs';

test('parseCsv: header, quoted commas, doubled quotes, CRLF, BOM, blank lines', () => {
    const text = '﻿HOUSE_NUMBER,STREET_NAME,CITY\r\n123,"MAIN, THE",Town\r\n\r\n7,"O""BRIEN",Ville\n';
    const { columns, rows } = parseCsv(text);
    assert.deepEqual(columns, ['HOUSE_NUMBER', 'STREET_NAME', 'CITY']);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { HOUSE_NUMBER: '123', STREET_NAME: 'MAIN, THE', CITY: 'Town' });
    assert.equal(rows[1].STREET_NAME, 'O"BRIEN');
});

test('parseCsv: note rows above the column names are skipped, a # further down is data', () => {
    const { columns, rows } = parseCsv('# a note\r\n"# name","what, goes in it"\r\nname,unit\r\nOld Mill Diner,#4\r\n#1 Cedar Cafe,\r\n');
    assert.deepEqual(columns, ['name', 'unit']);
    assert.deepEqual(rows, [{ name: 'Old Mill Diner', unit: '#4' }, { name: '#1 Cedar Cafe', unit: '' }]);
});

test('exampleCsv: every column is explained in the note rows', () => {
    for (const kind of ['points', 'intersections', 'places'] as const) {
        const text = exampleCsv(kind);
        for (const col of parseFile(text).columns) {
            const line = text.split('\r\n').find(l => l.startsWith(`# ${col},`));
            assert.ok(line && line.length > `# ${col},`.length + 10, `${kind}.${col} has a definition`);
        }
    }
});

test('parseCsv: a short row leaves the missing columns empty', () => {
    const { rows } = parseCsv('a,b,c\n1,2\n');
    assert.deepEqual(rows[0], { a: '1', b: '2', c: '' });
});

test('parseFile: GeoJSON points give __lat / __lon and the property columns', () => {
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { NAME: 'Fire Station 3', ADDRESS: '123 Main St' }, geometry: { type: 'Point', coordinates: [-123.2, 44.5] } },
        { type: 'Feature', properties: { NAME: 'No geometry' }, geometry: null },
    ] });
    const f = parseFile(gj);
    assert.equal(f.type, 'geojson');
    assert.equal(f.hasGeometry, true);
    assert.deepEqual(f.columns, ['NAME', 'ADDRESS']);
    assert.equal(f.rows[0].__lat, 44.5);
    assert.equal(f.rows[0].__lon, -123.2);
    assert.equal(f.rows[1].__lat, undefined);
});

test('parseFile: CSV is detected when the text is not JSON', () => {
    const f = parseFile('name,address,lat,lon\nStation,1 Main St,44.5,-123.2\n');
    assert.equal(f.type, 'csv');
    assert.equal(f.hasGeometry, false);
    assert.equal(f.rows[0].lat, '44.5');
});

test('guessMapping: a typical address-point file maps every main field, exact names first', () => {
    const cols = ['OBJECTID', 'FULL_ADDRESS', 'STREET_ADDRESS', 'PREFIX_DIRECTIONAL', 'HOUSE_NUMBER', 'STREET_NAME', 'STREET_TYPE',
        'SUFFIX_DIRECTIONAL', 'UNIT_TYPE', 'UNIT_ID', 'CITY', 'STATE', 'ZIPCODE', 'STATUS', 'PUBDATE'];
    const m = guessMapping('points', cols);
    assert.equal(m.house_number, 'HOUSE_NUMBER');
    assert.equal(m.prefix_dir, 'PREFIX_DIRECTIONAL');
    assert.equal(m.street_name, 'STREET_NAME');
    assert.equal(m.street_type, 'STREET_TYPE');
    assert.equal(m.suffix_dir, 'SUFFIX_DIRECTIONAL');
    assert.equal(m.full_street, 'STREET_ADDRESS');
    assert.equal(m.unit_type, 'UNIT_TYPE');
    assert.equal(m.unit, 'UNIT_ID');
    assert.equal(m.city, 'CITY');
    assert.equal(m.state, 'STATE');
    assert.equal(m.zip, 'ZIPCODE');
    assert.equal(m.full_address, 'FULL_ADDRESS');
    assert.equal(m.status, 'STATUS');
    assert.equal(m.lat, undefined, 'no coordinate column in this file: comes from the geometry');
});

test('guessMapping: a guess matches whole words of a column name, not letters inside it', () => {
    const t = guessMapping('places', ['Trail_Name', 'Trail_System', 'WinterMaintenanceType']);
    assert.equal(t.name, 'Trail_Name');
    assert.equal(t.lat, undefined, 'the y in Trail_System is not a latitude');
    assert.equal(t.category, 'WinterMaintenanceType');
    const p = guessMapping('places', ['MarkerLocation', 'EmergencyLocatorID', 'POINT_X', 'POINT_Y']);
    assert.deepEqual(p, { name: 'EmergencyLocatorID', address: 'MarkerLocation', lat: 'POINT_Y', lon: 'POINT_X' });
});

test('parseFile: a GeoJSON file of lines is refused with a plain reason', () => {
    const lines = JSON.stringify({ features: [{ properties: { Trail_Name: 'Old Mill Trail' }, geometry: { type: 'LineString', coordinates: [[-123.2, 44.5], [-123.21, 44.51]] } }] });
    assert.throws(() => parseFile(lines), /lines or areas, not points/);
});

test('guessKind: the kind of data from the column names', () => {
    assert.equal(guessKind(['HOUSE_NUMBER', 'STREET_NAME', 'STREET_TYPE', 'CITY']), 'points');
    assert.equal(guessKind(['ADDR_NUM', 'STREET_NAME', 'LandmkName']), 'points', 'an address file with a landmark column is still addresses');
    assert.equal(guessKind(['Street1', 'Street2', 'Community']), 'intersections');
    assert.equal(guessKind(['name', 'address', 'lat', 'lon', 'area']), 'places');
    assert.equal(guessKind(['NAME', 'STATION_NUMBER', 'FULL_ADDRESS']), 'places', 'a number that is not a house number');
    assert.equal(guessKind(['OBJECTID', 'Shape_Length']), null);
});

test('guessMapping: a column is used once (STREET_NAME is not also taken as the full street)', () => {
    const m = guessMapping('points', ['HOUSE_NUMBER', 'STREET_NAME']);
    assert.equal(m.street_name, 'STREET_NAME');
    assert.equal(m.full_street, undefined);
});

test('guessMapping: intersections and places', () => {
    const x = guessMapping('intersections', ['Street1', 'Street2', 'Street3', 'Street4', 'CityStateZIP', 'PUBDATE']);
    assert.deepEqual([x.street1, x.street2, x.street3, x.street4, x.city_state_zip], ['Street1', 'Street2', 'Street3', 'Street4', 'CityStateZIP']);
    const p = guessMapping('places', ['Name', 'Aliases', 'Category', 'Address', 'City', 'Zip', 'Latitude', 'Longitude']);
    assert.deepEqual([p.name, p.aliases, p.category, p.address, p.city, p.zip, p.lat, p.lon],
        ['Name', 'Aliases', 'Category', 'Address', 'City', 'Zip', 'Latitude', 'Longitude']);
});

test('initialMapping + applyMapping: geometry columns are used when the file has point geometry', () => {
    const f = parseFile(JSON.stringify({ type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { HOUSE_NUMBER: 12, STREET_NAME: 'Main', STREET_TYPE: 'St' }, geometry: { type: 'Point', coordinates: [-1, 2] } },
    ] }));
    const m = initialMapping('points', f);
    assert.equal(m.lat, '__lat');
    assert.equal(m.lon, '__lon');
    const row = applyMapping(m, f.rows[0]);
    assert.equal(row.house_number, 12);
    assert.equal(row.street_name, 'Main');
    assert.equal(row.lat, 2);
    assert.equal(row.lon, -1);
    assert.equal('city' in row, false, 'unmapped fields are left out');
});

test('missingFields: says what a mapping still lacks, with the full-street and coordinates alternatives', () => {
    assert.deepEqual(missingFields('points', {}), ['House number', 'Street name', 'Latitude and longitude']);
    assert.deepEqual(missingFields('points', { house_number: 'h', full_street: 's', lat: 'y', lon: 'x' }), []);
    assert.deepEqual(missingFields('intersections', { street1: 'a' }), ['Street 2', 'Latitude and longitude']);
    assert.deepEqual(missingFields('places', { name: 'n' }), ['Street address']);
    assert.deepEqual(missingFields('places', { name: 'n', lat: 'y', lon: 'x' }), [], 'a place needs an address or coordinates');
});

test('localDay: the date on this clock, late evening stays the same day', () => {
    assert.equal(localDay(new Date(2026, 10, 11, 23, 30)), '2026-11-11');
    assert.equal(localDay(new Date(2026, 0, 5, 0, 10).toISOString()), '2026-01-05');
    assert.equal(localDay(null), '');
    assert.equal(localDay('not a date'), '');
});

test('valueCounts: row count per value, most common first; too many values gives nothing', () => {
    const rows = [{ s: 'A' }, { s: 'T' }, { s: ' A ' }, { s: '' }, { s: 'A' }];
    assert.deepEqual(valueCounts(rows, 's'), [{ value: 'A', count: 3 }, { value: 'T', count: 1 }]);
    assert.deepEqual(valueCounts(rows, 's', 1), []);
});

test('distinctValues: most common first, blanks skipped', () => {
    const rows = [{ s: 'ACTIVE' }, { s: 'RETIRED' }, { s: 'ACTIVE' }, { s: '' }];
    assert.deepEqual(distinctValues(rows, 's'), ['ACTIVE', 'RETIRED']);
});

test('the column guesses are the same table the server uses for web pulls', () => {
    const server = readFileSync(new URL('../../server/plugin-addressing.ts', import.meta.url), 'utf8');
    const start = server.indexOf('export const FIELD_GUESSES');
    const block = server.slice(start, server.indexOf('};', start) + 2);
    // Evaluate the server's literal on its own and compare.
    const obj = new Function(`${block.replace(/^export const FIELD_GUESSES[^=]*=/, 'return ')}`)();
    assert.deepEqual(obj, FIELD_GUESSES);
});

test('example CSV: for every kind it parses, maps every column with no manual step, and lacks nothing', () => {
    for (const kind of ['points', 'intersections', 'places'] as SourceKind[]) {
        const f = parseFile(exampleCsv(kind));
        assert.equal(f.type, 'csv', kind);
        assert.ok(f.rows.length >= 3, `${kind}: a few rows`);
        const m = initialMapping(kind, f);
        assert.deepEqual(missingFields(kind, m), [], `${kind}: nothing still needed`);
        assert.deepEqual(Object.values(m).sort(), [...f.columns].sort(), `${kind}: every column is recognised`);
        const known = new Set(KIND_FIELDS[kind].map(k => k.key));
        for (const field of Object.keys(m)) assert.ok(known.has(field), `${kind}: ${field} is one of the plugin's fields`);
        assert.ok(exampleCsvName(kind).endsWith('.csv'));
    }
});

test('example CSV: a value with a comma is quoted and reads back whole', () => {
    const f = parseFile(exampleCsv('places'));
    assert.ok(f.rows.some(r => r.name === 'Lakeside Dental, Suite B'));
});

// ── Other agencies' layouts: column names as they are published, made-up values ───────────────

test('guessMapping: the NENA address-point layout, in a geodatabase or a CSV export', () => {
    const cols = ['Site_NGUID', 'AddNum_Pre', 'Add_Number', 'AddNum_Suf', 'St_PreMod', 'St_PreDir', 'St_PreTyp', 'St_Name', 'St_PosTyp', 'St_PosDir', 'St_PosMod',
        'LSt_PreDir', 'LSt_Name', 'LSt_Type', 'Unit', 'Inc_Muni', 'Post_Comm', 'State', 'Post_Code', 'Post_Code4', 'LandmkName', 'Place_Type', 'Lat', 'Long'];
    const want = { house_number: 'Add_Number', prefix_dir: 'St_PreDir', pre_mod: 'St_PreMod', pre_type: 'St_PreTyp', street_name: 'St_Name', street_type: 'St_PosTyp', suffix_dir: 'St_PosDir',
        unit: 'Unit', city: 'Post_Comm', state: 'State', zip: 'Post_Code', lat: 'Lat', lon: 'Long' };
    assert.deepEqual(guessMapping('points', cols), want);
    const lower = Object.fromEntries(Object.entries(want).map(([k, v]) => [k, v.toLowerCase()]));
    assert.deepEqual(guessMapping('points', cols.map(c => c.toLowerCase())), lower);
    assert.equal(guessKind(cols), 'points');
});

test('guessMapping: state and city layouts that are not NENA map with no manual step', () => {
    const cases: [string[], Record<string, string>][] = [
        [['AddNum', 'PrefixDir', 'StreetName', 'StreetType', 'SuffixDir', 'UnitType', 'UnitID', 'City', 'ZipCode', 'State', 'FullAdd', 'LandmarkName'],
            { house_number: 'AddNum', prefix_dir: 'PrefixDir', street_name: 'StreetName', street_type: 'StreetType', suffix_dir: 'SuffixDir', unit_type: 'UnitType', unit: 'UnitID', city: 'City', state: 'State', zip: 'ZipCode', full_address: 'FullAdd' }],
        [['HOUSENUM', 'UNITNUM', 'ST_PREFIX', 'ST_NAME', 'ST_TYPE', 'LSN', 'USPS_CITY', 'STATE', 'ZIPCODE', 'COMMENT'],
            { house_number: 'HOUSENUM', prefix_dir: 'ST_PREFIX', street_name: 'ST_NAME', street_type: 'ST_TYPE', unit: 'UNITNUM', city: 'USPS_CITY', state: 'STATE', zip: 'ZIPCODE', full_address: 'LSN' }],
        [['HOUSE_NUMBER', 'PRIMARYNAME', 'PRIMARYADDRESS', 'TOWNNAME', 'STATE', 'ZIP', 'SITETYPE'],
            { house_number: 'HOUSE_NUMBER', full_street: 'PRIMARYNAME', city: 'TOWNNAME', state: 'STATE', zip: 'ZIP', full_address: 'PRIMARYADDRESS' }],
        [['ADDRESS', 'ADDRESS_NUMBER', 'ADDRESS_NUMBER_SUFFIX', 'ADDRESS_TYPE', 'STREET_NAME', 'STREET_TYPE', 'QUADRANT', 'CITY', 'STATE', 'ZIPCODE', 'STATUS', 'HAS_RESIDENTIAL_UNIT', 'RESIDENTIAL_UNIT_COUNT'],
            { house_number: 'ADDRESS_NUMBER', street_name: 'STREET_NAME', street_type: 'STREET_TYPE', suffix_dir: 'QUADRANT', city: 'CITY', state: 'STATE', zip: 'ZIPCODE', full_address: 'ADDRESS', status: 'STATUS' }],
        [['Site Address ID', 'Address Number Prefix', 'Address Number Suffix', 'Full Address Number', 'Address Unit Type', 'Address Unit Number', 'Full Road Name', 'Full Address', 'Place Name', 'Address Source'],
            { house_number: 'Full Address Number', street_name: 'Full Road Name', unit_type: 'Address Unit Type', unit: 'Address Unit Number', full_address: 'Full Address' }],
        [['HOUSENUM', 'STREET', 'STRTYPE', 'UNITTYPE', 'UNIT', 'ADDRESS', 'CITY', 'PROVINCE', 'POSTAL_CODE'],
            { house_number: 'HOUSENUM', street_name: 'STREET', street_type: 'STRTYPE', unit_type: 'UNITTYPE', unit: 'UNIT', city: 'CITY', state: 'PROVINCE', zip: 'POSTAL_CODE', full_address: 'ADDRESS' }],
        [['Address Point ID', 'House Number', 'House Number Suffix', 'House Number Range', 'Pre-Directional', 'Street Name', 'POST_TYPE', 'Post Directional', 'ZIPCODE', 'Address Status'],
            { house_number: 'House Number', prefix_dir: 'Pre-Directional', street_name: 'Street Name', street_type: 'POST_TYPE', suffix_dir: 'Post Directional', zip: 'ZIPCODE', status: 'Address Status' }],
    ];
    for (const [cols, want] of cases) {
        assert.deepEqual(guessMapping('points', cols), want, cols.join(','));
        assert.equal(guessKind(cols), 'points', cols.join(','));
    }
});

test('guessMapping: the street pre-type and pre-modifier under the names other layouts give them', () => {
    assert.deepEqual(guessMapping('points', ['PRE_TYPE', 'POST_TYPE', 'Pre-Modifier', 'Street Name']),
        { pre_mod: 'Pre-Modifier', pre_type: 'PRE_TYPE', street_name: 'Street Name', street_type: 'POST_TYPE' });
    assert.equal(guessMapping('points', ['PREFIX_DIRECTION', 'PREFIX_TYPE', 'STREET_NAME', 'STREET_TYPE']).pre_type, 'PREFIX_TYPE');
    assert.equal(guessMapping('points', ['STREET_TYPE', 'UNIT_TYPE', 'ADDRESS_TYPE']).pre_type, undefined);
    assert.deepEqual(KIND_FIELDS.points.filter(f => f.key.startsWith('pre')).map(f => f.label), ['Prefix direction', 'Street pre-modifier', 'Street pre-type']);
});

test('guessMapping: a qualifier in a longer column name stops the match', () => {
    assert.equal(guessMapping('points', ['HAS_UNIT', 'UNIT_COUNT']).unit, undefined, 'a yes/no flag and a count are not the unit');
    assert.equal(guessMapping('points', ['ADDRESS_TYPE', 'Address Source']).full_address, undefined);
    assert.equal(guessMapping('points', ['Unit Number']).house_number, undefined, 'a unit number is not the house number');
    assert.equal(guessMapping('points', ['St_Name', 'ST_PREFIX']).state, undefined, 'ST inside a street column is not the state');
    assert.equal(guessMapping('points', ['ST']).state, 'ST', 'a column called just ST is');
    assert.deepEqual(guessMapping('points', ['MAIL_CITY', 'OWNER_ADDRESS', 'SITUS_CITY']), { city: 'SITUS_CITY' }, 'the mailing or owner address is not where the building is');
    assert.equal(guessMapping('places', ['STREET_NAME', 'Full Road Name']).name, undefined, 'a street name is not a place name');
    assert.deepEqual(guessMapping('intersections', ['CrossStreet1', 'CrossStreet2']), {}, 'the cross streets of a place are not an intersection');
    assert.equal(guessMapping('places', ['EmergencyLocatorID']).name, 'EmergencyLocatorID', 'unless the guess itself carries the word');
});

test('guessKind: address points with one full address column, and files that only look like another kind', () => {
    assert.equal(guessKind(['STNUM', 'PREDIR', 'NAME', 'TYPE', 'SUFDIR', 'ADDRESS', 'CITY']), 'points', 'a house number beside a full address');
    assert.equal(guessKind(['Number', 'Name', 'Address']), 'places', 'a numbered list of places');
    assert.equal(guessKind(['ADDRESS', 'PREFIX_DIRECTION', 'STREET_NAME', 'STREET_TYPE']), 'points', 'a street beside an address: the house number is left to pick');
    assert.equal(guessKind(['CommonPlaceName', 'CrossStreet1', 'CrossStreet2', 'Latitude', 'Longitude', 'Location']), 'places');
    assert.equal(guessKind(['STREET_NAME', 'SPEED_LIMIT']), null);
});

test('missingFields: a house number and one full address column are enough for address points', () => {
    const m = guessMapping('points', ['STNUM', 'ADDRESS', 'LAT', 'LON']);
    assert.deepEqual(missingFields('points', m), []);
});

test('guessMapping: intersections and places as other agencies name them', () => {
    assert.deepEqual(guessMapping('intersections', ['FIRST STREET NAME', 'SECOND STREET NAME', 'THIRD STREET NAME', 'FOURTH STREET NAME']),
        { street1: 'FIRST STREET NAME', street2: 'SECOND STREET NAME', street3: 'THIRD STREET NAME', street4: 'FOURTH STREET NAME' });
    assert.equal(guessKind(['FROM_ST', 'TO_ST', 'ZIP_CODE']), 'intersections');
    assert.equal(guessKind(['street_name_first', 'street_name_second', 'street_name_third', 'the_geom']), 'intersections');
    assert.deepEqual(guessMapping('intersections', ['FROM_ST', 'TO_ST', 'ZIP_CODE']), { street1: 'FROM_ST', street2: 'TO_ST', zip: 'ZIP_CODE' });
    assert.deepEqual(guessMapping('places', ['LANDMARKTYPE', 'TYPEDESC', 'LANDMARKNAME', 'CITY']), { name: 'LANDMARKNAME', category: 'TYPEDESC', city: 'CITY' });
    assert.deepEqual(guessMapping('places', ['name', 'factype', 'fulladdr', 'municipality']), { name: 'name', category: 'factype', address: 'fulladdr', city: 'municipality' });
    assert.deepEqual(guessMapping('places', ['NAME', 'Classify', 'Address']), { name: 'NAME', category: 'Classify', address: 'Address' });
});

test('parseFile: a CSV column of POINT (lon lat) text is the geometry', () => {
    const f = parseFile('the_geom,House Number,Street Name,LAT,LONG\n"POINT (-123.2 44.5)",123,Main St,518036.6,3668672.3\nPOINT(-123.21 44.51),125,Main St,,\n,127,Main St,,\n');
    assert.equal(f.hasGeometry, true);
    assert.deepEqual([f.rows[0].__lat, f.rows[0].__lon], [44.5, -123.2]);
    assert.deepEqual([f.rows[1].__lat, f.rows[1].__lon], [44.51, -123.21]);
    assert.equal(f.rows[2].__lat, undefined);
    const m = initialMapping('points', f);
    assert.deepEqual([m.lat, m.lon], ['__lat', '__lon'], 'the geometry wins over LAT / LONG columns that hold something else');
    assert.equal(parseFile('name,note\nOld Mill Diner,POINT OF INTEREST\n').hasGeometry, false);
});

test('guessMapping is the same code in the browser and on the server', () => {
    const cut = (file: string) => {
        const t = readFileSync(new URL(file, import.meta.url), 'utf8');
        const a = t.indexOf('const QUALIFIERS');
        return t.slice(a, t.indexOf('\n}\n', t.indexOf('export function guessMapping', a)));
    };
    assert.ok(cut('../lib/address-parse.ts').includes('export function guessMapping'));
    assert.equal(cut('../lib/address-parse.ts'), cut('../../server/plugin-addressing.ts'));
});

// ── What the incident form does with a chosen address (lib/address-form.ts) ───────────────────

test('streetWithUnit: the unit is added unless the line already ends with it, never lost to a letter inside the line', () => {
    assert.equal(streetWithUnit('125 N MAIN ST', '1'), '125 N MAIN ST #1', 'the 1 in 125 is not the unit');
    assert.equal(streetWithUnit('125 N MAIN ST', 'A'), '125 N MAIN ST #A', 'the A in MAIN is not the unit');
    assert.equal(streetWithUnit('125 N MAIN ST', '4B'), '125 N MAIN ST #4B', 'a bare unit gets the # sign');
    assert.equal(streetWithUnit('125 N MAIN ST', 'Apt 4'), '125 N MAIN ST Apt 4', 'a unit typed with its word stays as typed');
    assert.equal(streetWithUnit('125 N MAIN ST', '#4'), '125 N MAIN ST #4');
    assert.equal(streetWithUnit('125 N MAIN ST', 'Rear'), '125 N MAIN ST Rear');
    assert.equal(streetWithUnit('125 N Main St APT 1', '1'), '125 N Main St APT 1');
    assert.equal(streetWithUnit('9 Lake Shore Pkwy #B', 'b'), '9 Lake Shore Pkwy #B');
    assert.equal(streetWithUnit('9 Lake Shore Pkwy STE B', '#B'), '9 Lake Shore Pkwy STE B');
    assert.equal(streetWithUnit('400 Oak Ave NW', ''), '400 Oak Ave NW');
    assert.equal(streetWithUnit('', '4'), '#4');
});

test('unitChoices: six buttons at most, narrowing to what is typed in the Unit box', () => {
    const units = ['101', '102', '103', '104', '105', '106', '107', '201', '202', '2', 'B'].map(unit => ({ unit }));
    assert.equal(UNIT_CHOICES, 6);
    assert.deepEqual(unitChoices(units, ''), { shown: units.slice(0, 6), more: 5 }, 'nothing typed: the first six as given');
    assert.deepEqual(unitChoices(units, '2').shown.map(u => u.unit), ['2', '201', '202'], 'the exact unit first, then those that start with it');
    assert.equal(unitChoices(units, '2').more, 0);
    assert.deepEqual(unitChoices(units, '10'), { shown: units.slice(0, 6), more: 1 });
    assert.deepEqual(unitChoices(units, ' #b ').shown, [{ unit: 'B' }], 'case, spaces and a leading # do not matter');
    assert.deepEqual(unitChoices(units, '9'), { shown: [], more: 0 }, 'a unit the data does not have: no buttons, it is typed by hand');
    assert.deepEqual(unitChoices([], ''), { shown: [], more: 0 });
});

test('unitNamed: only the exact unit has its own point', () => {
    const units = [{ unit: '2', lat: 44.5001 }, { unit: '201', lat: 44.5002 }, { unit: 'B', lat: 44.5003 }];
    assert.equal(unitNamed(units, '2')?.lat, 44.5001);
    assert.equal(unitNamed(units, '20'), undefined, 'part of a unit is not that unit');
    assert.equal(unitNamed(units, '#b')?.lat, 44.5003);
    assert.equal(unitNamed(units, ''), undefined);
});

test('a # typed in the Unit box is ignored: #421, # 421 and 421 are the same unit', () => {
    const units = ['420', '421', '422'].map(unit => ({ unit }));
    for (const typed of ['421', '#421', '# 421', ' #421 ']) {
        assert.equal(unitNamed(units, typed)?.unit, '421', typed);
        assert.deepEqual(unitChoices(units, typed).shown, [{ unit: '421' }], typed);
        assert.ok(sameUnit(typed, '421'), `${typed}: its button is the chosen one`);
        assert.equal(streetWithUnit('100 MAIN ST', typed), '100 MAIN ST #421', `${typed}: one # on the saved line`);
    }
    assert.equal(streetWithUnit('100 MAIN ST', '#'), '100 MAIN ST', 'a # alone is no unit');
    assert.deepEqual(unitChoices(units, '#'), { shown: units, more: 0 });
    assert.equal(sameUnit('', ''), false);
    assert.equal(sameUnit('#', ''), false);
    assert.equal(streetWithUnit('100 MAIN ST', '#Apt 4'), '100 MAIN ST #Apt 4');
});

test('detailsWithPlace: the first line names the place chosen now, and goes when the choice is not a place', () => {
    assert.equal(detailsWithPlace('', 'Central High School'), 'Common Place Name: Central High School');
    assert.equal(detailsWithPlace('Caller reports smoke', 'Central High School'), 'Common Place Name: Central High School\nCaller reports smoke');
    const first = detailsWithPlace('Caller reports smoke', 'Central High School');
    assert.equal(detailsWithPlace(first, 'Central High School'), first, 'the same place twice changes nothing');
    assert.equal(detailsWithPlace(first, 'Riverside Park'), 'Common Place Name: Riverside Park\nCaller reports smoke');
    assert.equal(detailsWithPlace(first, null), 'Caller reports smoke', 'an address chosen after a place takes the place line out');
    assert.equal(detailsWithPlace('Common Place Name: Central High School', undefined), '');
    assert.equal(detailsWithPlace('Caller reports smoke', ''), 'Caller reports smoke');
});

test('the tag on a search result is one short word: the narrow pane has no room for a date', () => {
    const client = readFileSync(new URL('../lib/addressing.ts', import.meta.url), 'utf8');
    const badge = client.slice(client.indexOf('export function badgeFor'), client.indexOf('export function distanceText'));
    assert.deepEqual([...badge.matchAll(/text: ('[^']*')/g)].map(m => m[1]), ["'Place'", "'Verified'", "'OpenStreetMap'"]);
});

test('the coordinates warning clears when coordinates arrive, without pressing Create Incident again', () => {
    const form = readFileSync(new URL('../components/IncidentForm.vue', import.meta.url), 'utf8');
    assert.ok(form.includes('saveError.value = NEED_COORDS;'), 'the warning is the one the watcher knows');
    assert.match(form, /watch\(\(\) => form\.lat != null && form\.lon != null, \(has\) => \{\s+if \(has && saveError\.value === NEED_COORDS\) saveError\.value = '';/);
});
