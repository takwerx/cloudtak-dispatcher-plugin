// File parsing and field mapping for local address data, done in the browser so the admin sees
// the columns and a preview before anything is uploaded. No CloudTAK imports: plain functions,
// tested directly by plugin/test/address-parse.test.ts. The column guesses are the same table
// the server uses for web pulls (server/plugin-addressing.ts, FIELD_GUESSES); keep them equal.

export type SourceKind = 'points' | 'intersections' | 'places';

export interface FieldDef {
    key: string;
    label: string;
    required?: boolean;
    hint?: string;
}

// The plugin's own fields per kind, in the order the mapping screen shows them.
export const KIND_FIELDS: Record<SourceKind, FieldDef[]> = {
    points: [
        { key: 'house_number', label: 'House number', required: true },
        { key: 'prefix_dir',   label: 'Prefix direction', hint: 'N, S, E, W…' },
        { key: 'pre_mod',      label: 'Street pre-modifier', hint: 'Old, Business, Alternate…' },
        { key: 'pre_type',     label: 'Street pre-type', hint: 'Highway, County Road… before the name' },
        { key: 'street_name',  label: 'Street name', required: true, hint: 'or map one full street field below' },
        { key: 'street_type',  label: 'Street type', hint: 'ST, AVE, RD…' },
        { key: 'suffix_dir',   label: 'Suffix direction' },
        { key: 'full_street',  label: 'Full street (one field)', hint: 'used when the name parts above are not mapped' },
        { key: 'unit_type',    label: 'Unit type', hint: 'APT, STE…' },
        { key: 'unit',         label: 'Unit' },
        { key: 'city',         label: 'City' },
        { key: 'state',        label: 'State' },
        { key: 'zip',          label: 'ZIP' },
        { key: 'full_address', label: 'Full address text', hint: 'shown as the label when present' },
        { key: 'status',       label: 'Status', hint: 'optional: lets you leave out rows by status' },
        { key: 'lat',          label: 'Latitude', hint: 'GeoJSON: from the geometry' },
        { key: 'lon',          label: 'Longitude', hint: 'GeoJSON: from the geometry' },
    ],
    intersections: [
        { key: 'street1', label: 'Street 1', required: true },
        { key: 'street2', label: 'Street 2', required: true },
        { key: 'street3', label: 'Street 3' },
        { key: 'street4', label: 'Street 4' },
        { key: 'city_state_zip', label: 'City / state / ZIP (one field)' },
        { key: 'city',  label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'zip',   label: 'ZIP' },
        { key: 'lat',   label: 'Latitude', hint: 'GeoJSON: from the geometry' },
        { key: 'lon',   label: 'Longitude', hint: 'GeoJSON: from the geometry' },
    ],
    places: [
        { key: 'name',     label: 'Place name', required: true },
        { key: 'aliases',  label: 'Aliases', hint: 'separated by ; or |' },
        { key: 'category', label: 'Category' },
        { key: 'address',  label: 'Street address', required: true, hint: 'required unless coordinates are given' },
        { key: 'unit',     label: 'Unit' },
        { key: 'city',     label: 'City' },
        { key: 'state',    label: 'State' },
        { key: 'zip',      label: 'ZIP' },
        { key: 'lat',      label: 'Latitude', hint: 'optional: matched from the address when missing' },
        { key: 'lon',      label: 'Longitude' },
    ],
};

export const FIELD_GUESSES: Record<SourceKind, Record<string, string[]>> = {
    points: {
        house_number: ['house_number', 'housenumber', 'house_num', 'housenum', 'house_no', 'houseno', 'hse_nbr', 'addr_num', 'addrnum', 'address_number', 'addressnumber', 'address_num', 'add_number', 'addnum', 'add_num',
            'st_num', 'stnum', 'st_no', 'stno', 'street_number', 'streetnumber', 'street_num', 'street_no', 'civic_number', 'civicnumber', 'civic_num', 'civic_no', '=number', '=house'],
        prefix_dir:   ['prefix_directional', 'prefix_direction', 'prefix_dir', 'predir', 'pre_dir', 'pre_directional', 'predirectional', 'pre_direction', 'st_predir', 'street_prefix_direction',
            'street_name_pre_directional', 'st_prefix', 'street_prefix', 'dir_prefix', '=prefix'],
        pre_mod:      ['st_premod', 'pre_mod', 'premod', 'pre_modifier', 'premodifier', 'street_name_pre_modifier'],
        pre_type:     ['st_pretyp', 'pre_type', 'pretype', 'pre_typ', 'prefix_type', 'street_pre_type', 'street_name_pre_type'],
        street_name:  ['street_name', 'streetname', 'st_name', 'stname', 'str_name', 'strname', 'street_nm', 'str_nm', 'street', 'road_name', 'roadname', 'rd_name'],
        street_type:  ['street_type', 'streettype', 'st_type', 'sttype', 'str_type', 'strtype', 'st_postyp', 'st_postype', 'post_type', 'posttype', 'street_name_post_type', 'street_suffix', 'st_suffix', 'str_suffix', '=suffix'],
        suffix_dir:   ['suffix_directional', 'suffix_direction', 'suffix_dir', 'sufdir', 'suf_dir', 'post_dir', 'postdir', 'post_directional', 'postdirectional', 'post_direction', 'st_posdir', 'street_post_direction',
            'street_name_post_directional', 'dir_suffix', 'quadrant'],
        full_street:  ['street_address', 'full_street', 'fullstreet', 'street_full', 'stfull', 'full_street_name', 'fullstreetname', 'full_road_name', 'fullrdname', 'full_name', 'fullname', 'complete_street_name', 'primaryname', 'stnamecom'],
        unit_type:    ['unit_type', 'unittype', 'subaddress_type', 'address_unit_type'],
        unit:         ['unit_id', 'unit', 'unitid', 'unit_num', 'unitnum', 'unit_number', 'unit_no', 'address_unit_number', 'apt', 'apartment', 'suite', 'subaddress', 'subaddress_id', 'subaddress_identifier'],
        city:         ['city', 'municipality', 'post_comm', 'postal_community', 'postal_city', 'post_city', 'usps_city', 'city_name', 'cityname', 'community', 'town', 'townname', 'town_name', 'inc_muni', 'msagcomm', 'locality', 'suburb'],
        state:        ['state', '=st', 'state_abbr', 'state_code', 'province', 'prov'],
        zip:          ['zipcode', 'zip', 'zip_code', 'zip5', 'postal', 'postal_code', 'postalcode', 'postcode', 'post_code'],
        full_address: ['full_address', 'fulladdress', 'full_addr', 'fulladdr', 'fulladd', 'full_add', 'address', 'addr', 'situs', 'site_address', 'siteaddress', 'site_addr', 'siteaddr', 'primaryaddress', 'primary_address',
            'complete_address', 'address_full', 'addr_full', 'civic_address', 'property_address', 'location_address', 'lsn', 'label'],
        status:       ['status', 'addr_status', 'address_status'],
        lat:          ['lat', 'latitude', 'y', 'ycoord', 'gpsy'],
        lon:          ['lon', 'lng', 'long', 'longitude', 'x', 'xcoord', 'gpsx'],
    },
    intersections: {
        street1: ['street1', 'street_1', 'st1', 'street_a', 'from_street', 'from_st', 'first_street', 'first_street_name', 'street_name_first', 'street_name_1', 'street_name1', 'streetname1', 'st_name1', 'stname1', 'str1', 'primary_street', 'road1', 'road_1', 'name1', 'name_1'],
        street2: ['street2', 'street_2', 'st2', 'street_b', 'to_street', 'to_st', 'second_street', 'second_street_name', 'street_name_second', 'street_name_2', 'street_name2', 'streetname2', 'st_name2', 'stname2', 'str2', 'secondary_street', 'road2', 'road_2', 'name2', 'name_2'],
        street3: ['street3', 'street_3', 'st3', 'third_street', 'third_street_name', 'street_name_third', 'street_name_3', 'street_name3', 'streetname3', 'st_name3', 'stname3', 'str3'],
        street4: ['street4', 'street_4', 'st4', 'fourth_street', 'fourth_street_name', 'street_name_fourth', 'street_name_4', 'street_name4', 'streetname4', 'st_name4', 'stname4', 'str4'],
        city_state_zip: ['citystatezip', 'city_state_zip', 'csz'],
        city: ['city', 'municipality', 'community', 'town', 'post_comm'],
        state: ['state', '=st', 'province'],
        zip: ['zipcode', 'zip', 'zip_code', 'postal_code', 'postcode', 'post_code'],
        lat: ['lat', 'latitude', 'y', 'ycoord', 'gpsy'],
        lon: ['lon', 'lng', 'long', 'longitude', 'x', 'xcoord', 'gpsx'],
    },
    places: {
        name:     ['name', 'place', 'place_name', 'placename', 'common_name', 'commonname', 'common_place', 'commonplace', 'landmark_name', 'landmarkname', 'landmkname', 'poi_name', 'poiname', 'facility_name', 'facilityname',
            'fac_name', 'facname', 'site_name', 'sitename', 'feature_name', 'featurename', 'business_name', 'businessname', 'building_name', 'location_name', 'title', 'facility', 'landmark', 'locator_id'],
        aliases:  ['aliases', 'alias', 'aka', 'also_known_as', 'other_names', 'other_name', 'nicknames', 'alt_name', 'altname', 'alternate_name', 'short_name', 'shortname', 'abbreviation', 'acronym'],
        category: ['category', 'type', 'class', 'kind', 'feature_type', 'type_desc', 'typedesc', 'type_description', 'classify', 'classification', 'factype', 'fac_type', 'landmark_type', 'landmarktype', 'place_type', 'placetype', 'subtype'],
        address:  ['address', 'street_address', 'full_address', 'fulladdress', 'full_addr', 'fulladdr', 'addr', 'site_address', 'siteaddress', 'physical_address', 'location_address', 'address1', 'address_1', 'situs', 'location', 'street'],
        unit:     ['unit', 'suite', 'apt'],
        city:     ['city', 'town', 'townname', 'municipality', 'post_comm', 'usps_city', 'city_name', 'area', 'community', 'neighborhood', 'neighbourhood', 'district'],
        state:    ['state', '=st', 'state_abbr', 'province'],
        zip:      ['zipcode', 'zip', 'zip_code', 'zip5', 'postal', 'postal_code', 'postcode', 'post_code'],
        lat:      ['lat', 'latitude', 'y', 'ycoord', 'gpsy'],
        lon:      ['lon', 'lng', 'long', 'longitude', 'x', 'xcoord', 'gpsx'],
    },
};

// Words that turn a column into something else: HAS_UNIT is not the unit, ADDRESS_TYPE not the
// address, CrossStreet1 not an intersection's own street, MAIL_CITY not where the building is.
const QUALIFIERS = new Set(['has', 'is', 'count', 'id', 'key', 'code', 'date', 'source', 'type', 'status', 'prefix', 'suffix', 'range',
    'cross', 'dir', 'direction', 'street', 'st', 'str', 'road', 'mail', 'mailing', 'owner', 'url', 'by']);

// Best guess at which column holds each field: the whole column name first, then a column that
// holds the guess as whole words. A guess written "=st" only ever matches the whole name.
export function guessMapping(kind: SourceKind, columns: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    const lower = columns.map(c => c.toLowerCase());
    // Each column as whole words ("TrailSystem", "POINT_Y" → "_trail_system_", "_point_y_"): a guess
    // has to match whole words, so "y" finds POINT_Y and not every column with a y in it.
    const words = columns.map(c => `_${c.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_`.replace(/_+/g, '_'));
    // A longer column name counts only when none of its other words is a qualifier.
    const within = (w: string, n: string) => w.includes(`_${n}_`) && !w.split('_').some(p => QUALIFIERS.has(p) && !n.split('_').includes(p));
    const used = new Set<string>();
    for (const [field, all] of Object.entries(FIELD_GUESSES[kind])) {
        const names = all.map(n => n.replace(/^=/, ''));
        let hit = -1;
        for (const n of names) { hit = lower.findIndex((c, i) => (c === n || words[i] === `_${n}_`) && !used.has(columns[i])); if (hit >= 0) break; }
        if (hit < 0) for (const n of all) { if (n.startsWith('=')) continue; hit = words.findIndex((w, i) => within(w, n) && !used.has(columns[i])); if (hit >= 0) break; }
        if (hit >= 0) { out[field] = columns[hit]; used.add(columns[hit]); }
    }
    return out;
}

// Small CSV reader (quoted fields, embedded newlines, CRLF, a leading BOM).
export function parseCsv(text: string): { columns: string[]; rows: Record<string, string>[] } {
    const records: string[][] = [];
    let field = '', rec: string[] = [], inQ = false;
    const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inQ) {
            if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
            else field += c;
        } else if (c === '"') inQ = true;
        else if (c === ',') { rec.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && src[i + 1] === '\n') i++;
            rec.push(field); field = '';
            if (rec.length > 1 || rec[0] !== '') records.push(rec);
            rec = [];
        } else field += c;
    }
    if (field !== '' || rec.length) { rec.push(field); records.push(rec); }
    // Note rows above the column names (first cell starts with #), as in the example files.
    while (records.length && records[0][0].trim().startsWith('#')) records.shift();
    if (!records.length) return { columns: [], rows: [] };
    const columns = records[0].map(c => c.trim());
    const rows = records.slice(1).map(r => {
        const o: Record<string, string> = {};
        columns.forEach((c, i) => { o[c] = r[i] ?? ''; });
        return o;
    });
    return { columns, rows };
}

export interface ParsedFile {
    type: 'csv' | 'geojson';
    columns: string[];
    // Each record's properties; point geometry (GeoJSON, or a CSV column of "POINT (lon lat)" text)
    // is added as __lat / __lon.
    rows: Record<string, unknown>[];
    hasGeometry: boolean;
}

// A file as text (CSV, or a GeoJSON FeatureCollection) to columns + rows.
export function parseFile(text: string): ParsedFile {
    const t = text.trimStart();
    if (t.startsWith('{') || t.startsWith('[')) {
        const gj = JSON.parse(t);
        const feats: unknown[] = Array.isArray(gj) ? gj : (Array.isArray(gj?.features) ? gj.features : []);
        let hasGeometry = false;
        let shapes = 0;
        const rows = feats.map((f0) => {
            const f = f0 as { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } };
            const row: Record<string, unknown> = { ...(f.properties ?? {}) };
            const g = f.geometry;
            if (g && g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
                row.__lon = g.coordinates[0];
                row.__lat = g.coordinates[1];
                hasGeometry = true;
            } else if (g && g.type) {
                shapes++;
            }
            return row;
        });
        const columns = Array.from(new Set(rows.flatMap(r => Object.keys(r).filter(k => !k.startsWith('__')))));
        // Lines or areas (trails, streets, districts) and no points: nothing here can be placed.
        if (shapes && !hasGeometry) throw new Error('it holds lines or areas, not points. Only point data can be imported');
        return { type: 'geojson', columns, rows, hasGeometry };
    }
    const csv = parseCsv(text);
    // A CSV from an open-data portal carries each point as text in one column: "POINT (-123.2 44.5)".
    const point = (v: unknown) => /^\s*POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$/i.exec(String(v ?? ''));
    const wkt = csv.columns.find(c => csv.rows.slice(0, 20).some(r => point(r[c])));
    if (!wkt) return { type: 'csv', columns: csv.columns, rows: csv.rows, hasGeometry: false };
    const rows = csv.rows.map((r): Record<string, unknown> => {
        const m = point(r[wkt]);
        return m ? { ...r, __lon: Number(m[1]), __lat: Number(m[2]) } : r;
    });
    return { type: 'csv', columns: csv.columns, rows, hasGeometry: true };
}

// A mapping with the geometry columns filled in when the file carries point geometry.
export function initialMapping(kind: SourceKind, file: ParsedFile): Record<string, string> {
    const m = guessMapping(kind, file.columns);
    if (file.hasGeometry) { m.lat = '__lat'; m.lon = '__lon'; }
    return m;
}

// Which kind of data a file is, from its column names alone, so the admin does not have to say.
// Two street columns: intersections. A house number with a street or a full address: address
// points (checked before places, because an address file often has a NAME column too; a column
// called just "Number" is not proof enough with only an address beside it). A name: places.
// A street beside a full address and nothing else: still address points, the house number is
// then the one field left to pick. null when nothing fits; the admin's own choice then stands.
export function guessKind(columns: string[]): SourceKind | null {
    const x = guessMapping('intersections', columns);
    if (x.street1 && x.street2) return 'intersections';
    const p = guessMapping('points', columns);
    const street = p.street_name || p.full_street;
    if (p.house_number && street) return 'points';
    if (p.house_number && p.full_address && !/^(number|house)$/i.test(p.house_number)) return 'points';
    if (guessMapping('places', columns).name) return 'places';
    if (street && p.full_address) return 'points';
    return null;
}

// One record as the server wants it: plugin field → value from the mapped column.
export function applyMapping(mapping: Record<string, string>, row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [field, col] of Object.entries(mapping)) {
        if (col && col in row) out[field] = row[col];
    }
    return out;
}

// Which required fields the mapping still lacks (for the Upload button to refuse).
export function missingFields(kind: SourceKind, mapping: Record<string, string>): string[] {
    const out: string[] = [];
    for (const f of KIND_FIELDS[kind]) {
        if (!f.required || mapping[f.key]) continue;
        if (kind === 'points' && f.key === 'street_name' && (mapping.full_street || mapping.full_address)) continue;
        if (kind === 'places' && f.key === 'address' && mapping.lat && mapping.lon) continue;
        out.push(f.label);
    }
    if (kind !== 'places' && !(mapping.lat && mapping.lon)) out.push('Latitude and longitude');
    return out;
}

// Distinct values of one column (for the status filter), capped.
export function distinctValues(rows: Record<string, unknown>[], col: string, cap = 30): string[] {
    const seen = new Map<string, number>();
    for (const r of rows) {
        const v = String(r[col] ?? '').trim();
        if (!v) continue;
        seen.set(v, (seen.get(v) ?? 0) + 1);
        if (seen.size > cap) break;
    }
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

// A date as YYYY-MM-DD on this computer's clock, not UTC: late in the day the UTC date is
// already tomorrow west of Greenwich. '' when there is no usable date.
export function localDay(d: Date | string | null | undefined): string {
    if (d == null || d === '') return '';
    const t = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(t.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

// Every value in one column with its row count, most common first. Empty when the column has more
// than `cap` different values: that is not a status column, so there is nothing to choose from.
export function valueCounts(rows: Record<string, unknown>[], col: string, cap = 30): { value: string; count: number }[] {
    const seen = new Map<string, number>();
    for (const r of rows) {
        const v = String(r[col] ?? '').trim();
        if (!v) continue;
        seen.set(v, (seen.get(v) ?? 0) + 1);
        if (seen.size > cap) return [];
    }
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}

// An example file per kind for the admin to download: the column names the mapping recognises with
// no manual step, and a few made-up rows showing each case (a unit, a missing optional value,
// a place located by its address or by coordinates). Every row here loads cleanly.
const EXAMPLE_ROWS: Record<SourceKind, string[][]> = {
    points: [
        ['house_number', 'prefix_dir', 'street_name', 'street_type', 'suffix_dir', 'unit_type', 'unit', 'city', 'state', 'zip', 'status', 'lat', 'lon'],
        ['123', 'N', 'Main', 'St', '', '', '', 'Springfield', 'ST', '12345', 'Active', '44.500120', '-123.200450'],
        ['125', 'N', 'Main', 'St', '', 'APT', '1', 'Springfield', 'ST', '12345', 'Active', '44.500310', '-123.200450'],
        ['125', 'N', 'Main', 'St', '', 'APT', '2', 'Springfield', 'ST', '12345', 'Active', '44.500310', '-123.200450'],
        ['400', '', 'Oak', 'Ave', 'NW', '', '', 'Springfield', 'ST', '12345', 'Active', '44.503900', '-123.207800'],
        ['9', '', 'Lake Shore', 'Pkwy', '', 'STE', 'B', 'Springfield', 'ST', '12346', 'Retired', '44.510200', '-123.195100'],
    ],
    intersections: [
        ['street1', 'street2', 'street3', 'street4', 'city', 'state', 'zip', 'lat', 'lon'],
        ['N Main St', 'W 5th Ave', '', '', 'Springfield', 'ST', '12345', '44.500900', '-123.200400'],
        ['Oak Ave NW', 'Lake Shore Pkwy', '', '', 'Springfield', 'ST', '12345', '44.504400', '-123.201900'],
        ['N Main St', 'Old Mill Hwy', 'Harbor View Blvd', '', 'Springfield', 'ST', '12346', '44.512000', '-123.200400'],
    ],
    places: [
        ['name', 'aliases', 'category', 'address', 'unit', 'city', 'state', 'zip', 'lat', 'lon'],
        ['Fire Station 3', 'Station 3; FS3', 'Station', '123 N Main St', '', 'Springfield', 'ST', '12345', '44.500120', '-123.200450'],
        ['Central High School', 'CHS; the high school', 'School', '400 Oak Ave NW', '', 'Springfield', 'ST', '12345', '', ''],
        ['Riverside Park', '', 'Park', '', '', 'Springfield', 'ST', '12345', '44.507700', '-123.214300'],
        ['Lakeside Dental, Suite B', 'the dentist', 'Medical', '9 Lake Shore Pkwy', 'STE B', 'Springfield', 'ST', '12346', '44.510200', '-123.195100'],
    ],
};

// What goes in each column of an example file, in the words an agency's GIS staff would need to
// reshape their own export. Written into the file itself as note rows.
const LAT_NOTE = 'Latitude in decimal degrees (WGS84), such as 44.500120. Not degrees-minutes-seconds and not state plane feet.';
const LON_NOTE = 'Longitude in decimal degrees (WGS84), such as -123.200450. Negative in North and South America.';
const EXAMPLE_NOTES: Record<SourceKind, Record<string, string>> = {
    points: {
        house_number: 'REQUIRED. The house number only, such as 123. No letters, fractions or street name.',
        prefix_dir:   'Optional. A direction that comes before the street name: N, S, E, W, NE, NW, SE, SW.',
        street_name:  'REQUIRED. The street name only, without direction or type: Main, Lake Shore, 5th.',
        street_type:  'Optional. The street type: St, Ave, Rd, Dr, Pkwy. Short or spelled out both work.',
        suffix_dir:   'Optional. A direction that comes after the street type, as in Oak Ave NW.',
        unit_type:    'Optional. The kind of unit: APT, STE, UNIT, TRLR.',
        unit:         'Optional. The unit number or letter. Give every unit its own row, with the same house number and street.',
        city:         'Recommended. The postal city.',
        state:        'Recommended. The two-letter state or province.',
        zip:          'Recommended. The ZIP or postal code.',
        status:       'Optional. Any status word your office uses, such as Active or Retired. At import you choose which to leave out.',
        lat:          `REQUIRED. ${LAT_NOTE}`,
        lon:          `REQUIRED. ${LON_NOTE}`,
    },
    intersections: {
        street1: 'REQUIRED. The first street, written in full: N Main St.',
        street2: 'REQUIRED. The street it crosses, written in full: W 5th Ave.',
        street3: 'Optional. A third street at the same intersection.',
        street4: 'Optional. A fourth street at the same intersection.',
        city:    'Recommended. The city or community.',
        state:   'Recommended. The two-letter state or province.',
        zip:     'Recommended. The ZIP or postal code.',
        lat:     `REQUIRED. ${LAT_NOTE}`,
        lon:     `REQUIRED. ${LON_NOTE}`,
    },
    places: {
        name:     'REQUIRED. The name a dispatcher will type: Central High School.',
        aliases:  'Optional. Other names for the same place, separated by a semicolon: CHS; the high school.',
        category: 'Optional. A short type shown next to the name: School, Park, Station.',
        address:  'The street address, such as 400 Oak Ave NW. REQUIRED unless lat and lon are filled in.',
        unit:     'Optional. A suite or unit, such as STE B.',
        city:     'Recommended. The city.',
        state:    'Recommended. The two-letter state or province.',
        zip:      'Recommended. The ZIP or postal code.',
        lat:      `${LAT_NOTE} Leave lat and lon empty to have the place located from its address, using your address points.`,
        lon:      LON_NOTE,
    },
};

const csvCell = (v: string): string => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

// The example file: note rows first (what the file is and what goes in each column), then the
// column names, then the example rows. The note rows start with # and are skipped on import, so
// the file loads as it is, with or without them.
export function exampleCsv(kind: SourceKind): string {
    const [columns, ...rows] = EXAMPLE_ROWS[kind];
    const notes: string[][] = [
        ['# Rows that start with # are notes. They are ignored on import, so you can leave them in or delete them.'],
        ['# The first row after the notes holds the column names. Columns can be in any order and extra columns are ignored.'],
        ['# COLUMN', 'WHAT GOES IN IT'],
        ...columns.map(c => [`# ${c}`, EXAMPLE_NOTES[kind][c] ?? '']),
    ];
    return [...notes, columns, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function exampleCsvName(kind: SourceKind): string {
    return `dispatcher-example-${kind === 'points' ? 'address-points' : kind}.csv`;
}
