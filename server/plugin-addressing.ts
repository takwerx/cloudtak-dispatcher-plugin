// Local address data for the standalone Dispatcher: verified address points, street intersections
// and common place names loaded by a CloudTAK admin (file upload, or a web address the server
// pulls from on a schedule), searched first; the public OpenStreetMap geocoder stays as the
// fallback. Lives in CloudTAK's own Postgres beside the dispatcher tables, so every dispatcher on
// this CloudTAK shares one list.
//
// Same house rules as plugin-dispatcher.ts: opted out of CloudTAK's lint, raw drizzle SQL, tables
// bootstrapped with CREATE TABLE IF NOT EXISTS, CloudTAK >= 13.45. No PostGIS and no extension
// is required: nearest-point lookups use a bounding box over plain lat/lon columns plus the
// haversine formula, which is exact enough at the 50-150 m radii dispatch needs.
/* eslint-disable */
import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';

// ── Pure helpers (also exercised by plugin/test/addressing-server.test.ts) ───────────────────
// <addressing-pure>

export type SourceKind = 'points' | 'intersections' | 'places';
export const SOURCE_KINDS: SourceKind[] = ['points', 'intersections', 'places'];

// Street type words to one short form, so "MAIN STREET", "MAIN ST" and "Main St." all match.
const STREET_TYPES: Record<string, string> = {
    ALLEY: 'ALY', ALY: 'ALY', AVENUE: 'AVE', AV: 'AVE', AVE: 'AVE', BEND: 'BND', BND: 'BND',
    BOULEVARD: 'BLVD', BLVD: 'BLVD', BRANCH: 'BR', BR: 'BR', BRIDGE: 'BRG', BRG: 'BRG', BYPASS: 'BYP',
    BYP: 'BYP', CANYON: 'CYN', CYN: 'CYN', CENTER: 'CTR', CTR: 'CTR', CIRCLE: 'CIR', CIR: 'CIR', CIRC: 'CIR', CRCL: 'CIR',
    COURT: 'CT', CT: 'CT', CRT: 'CT', COVE: 'CV', CV: 'CV', CREEK: 'CRK', CRK: 'CRK', CRESCENT: 'CRES', CRES: 'CRES',
    CROSSING: 'XING', XING: 'XING', DRIVE: 'DR', DR: 'DR', ESTATES: 'ESTS', ESTS: 'ESTS',
    EXPRESSWAY: 'EXPY', EXPY: 'EXPY', EXTENSION: 'EXT', EXT: 'EXT', FREEWAY: 'FWY', FWY: 'FWY',
    GARDENS: 'GDNS', GDNS: 'GDNS', GLEN: 'GLN', GLN: 'GLN', GROVE: 'GRV', GRV: 'GRV',
    HARBOR: 'HBR', HBR: 'HBR', HEIGHTS: 'HTS', HTS: 'HTS', HIGHWAY: 'HWY', HWY: 'HWY', HILL: 'HL',
    HL: 'HL', HILLS: 'HLS', HLS: 'HLS', HOLLOW: 'HOLW', HOLW: 'HOLW', ISLAND: 'IS', IS: 'IS',
    JUNCTION: 'JCT', JCT: 'JCT', KNOLL: 'KNL', KNL: 'KNL', LAKE: 'LK', LK: 'LK', LANDING: 'LNDG',
    LNDG: 'LNDG', LANE: 'LN', LN: 'LN', LOOP: 'LOOP', MANOR: 'MNR', MNR: 'MNR', MEADOWS: 'MDWS',
    MDWS: 'MDWS', MOUNTAIN: 'MTN', MTN: 'MTN', PARK: 'PARK', PARKWAY: 'PKWY', PKWY: 'PKWY', PKY: 'PKWY',
    PASS: 'PASS', PATH: 'PATH', PIKE: 'PIKE', PLACE: 'PL', PL: 'PL', PLAZA: 'PLZ', PLZ: 'PLZ',
    POINT: 'PT', PT: 'PT', RIDGE: 'RDG', RDG: 'RDG', ROAD: 'RD', RD: 'RD', ROUTE: 'RTE', RTE: 'RTE',
    ROW: 'ROW', RUN: 'RUN', SPUR: 'SPUR', SQUARE: 'SQ', SQ: 'SQ', STREET: 'ST', ST: 'ST', STR: 'ST',
    TERRACE: 'TER', TER: 'TER', TERR: 'TER', TRACE: 'TRCE', TRCE: 'TRCE', TRAIL: 'TRL', TRL: 'TRL',
    TURNPIKE: 'TPKE', TPKE: 'TPKE', VALLEY: 'VLY', VLY: 'VLY', VIEW: 'VW', VW: 'VW', VILLAGE: 'VLG',
    VLG: 'VLG', VISTA: 'VIS', VIS: 'VIS', WALK: 'WALK', WAY: 'WAY',
};
const DIRECTIONS: Record<string, string> = {
    NORTH: 'N', N: 'N', SOUTH: 'S', S: 'S', EAST: 'E', E: 'E', WEST: 'W', W: 'W',
    NORTHEAST: 'NE', NE: 'NE', NORTHWEST: 'NW', NW: 'NW', SOUTHEAST: 'SE', SE: 'SE', SOUTHWEST: 'SW', SW: 'SW',
};
const DIR_SHORT = new Set(Object.values(DIRECTIONS));
const TYPE_SHORT = new Set(Object.values(STREET_TYPES));
const UNIT_WORDS = new Set(['APT', 'APARTMENT', 'UNIT', 'STE', 'SUITE', 'LOT', 'RM', 'ROOM', 'BLDG', 'SPC', 'SPACE', 'TRLR', 'FL', 'FLOOR', '#']);

// Upper-case, drop punctuation, one space between words.
export function normText(s: unknown): string {
    return String(s ?? '').toUpperCase().replace(/[^A-Z0-9#&/@|]+/g, ' ').trim().replace(/\s+/g, ' ');
}

// A street name in its one normalised form: "North Main Street" → "N MAIN ST". Only the ends of
// the name are touched: a direction first or last, a street type last (or just before a trailing
// direction). Words inside the name stay, so "Lake Shore Pkwy" keeps its LAKE and "Park Ave" its PARK.
// The one exception is a type that comes before a route number: "Highway 191" → "HWY 191".
export function normStreet(s: unknown): string {
    const w = normText(s).split(' ').filter(Boolean);
    if (!w.length) return '';
    if (w.length > 1 && DIRECTIONS[w[0]]) w[0] = DIRECTIONS[w[0]];
    let last = w.length - 1;
    if (last > 0 && DIRECTIONS[w[last]]) { w[last] = DIRECTIONS[w[last]]; last--; }
    if (last > 0 && STREET_TYPES[w[last]]) w[last] = STREET_TYPES[w[last]];
    for (let i = 0; i < last; i++) if (STREET_TYPES[w[i]] && /^\d+[A-Z]?$/.test(w[i + 1])) w[i] = STREET_TYPES[w[i]];
    return w.join(' ');
}

// Street text from its parts or one full field. The parts are the direction, then what the NENA
// layout calls the pre-modifier and pre-type ("Old", "Highway"), the name, its type and a trailing
// direction: N + Old + Highway + 50 → "N OLD HWY 50".
export function streetFromParts(r: { prefix_dir?: unknown; pre_mod?: unknown; pre_type?: unknown; street_name?: unknown; street_type?: unknown; suffix_dir?: unknown; full_street?: unknown }): string {
    const parts = [r.prefix_dir, r.pre_mod, r.pre_type, r.street_name, r.street_type, r.suffix_dir].map(normText).filter(Boolean);
    if (parts.length && normText(r.street_name)) return normStreet(parts.join(' '));
    return normStreet(r.full_street);
}

export interface ParsedQuery {
    kind: 'address' | 'intersection' | 'text';
    number: number | null;
    unit: string | null;
    street: string;       // normalised street text (address) or free text
    street2: string;      // second street for an intersection
    words: string[];
}

// What the dispatcher typed, sorted into an address ("123 N Main St Apt 4"), an intersection
// ("Main & 5th", "Main St and 5th Ave", "Main / 5th", "Main at 5th") or free text.
export function parseQuery(raw: string): ParsedQuery {
    // "120 1/2 Main St": the fraction belongs to the house number and its slash is not an intersection.
    const q = normText(raw).replace(/^(\d+[A-Z]?) \d+\/\d+ /, '$1 ');
    const inter = q.split(/\s*(?:&|\/|@| AND | AT )\s*/).map(s => s.trim()).filter(Boolean);
    if (inter.length === 2) {
        return { kind: 'intersection', number: null, unit: null, street: normStreet(inter[0]), street2: normStreet(inter[1]), words: q.split(' ') };
    }
    const toks = q.split(' ').filter(Boolean);
    if (toks.length && /^\d+[A-Z]?$/.test(toks[0]) && toks.length > 1) {
        const number = parseInt(toks[0], 10);
        let unit: string | null = null;
        const streetToks: string[] = [];
        for (let i = 1; i < toks.length; i++) {
            const t = toks[i];
            if (UNIT_WORDS.has(t) || t.startsWith('#')) {
                unit = t.startsWith('#') && t.length > 1 ? t.slice(1) : (toks[i + 1] ?? null);
                break;
            }
            streetToks.push(t);
        }
        return { kind: 'address', number, unit, street: normStreet(streetToks.join(' ')), street2: '', words: toks };
    }
    return { kind: 'text', number: null, unit: null, street: normStreet(q), street2: '', words: toks };
}

// How well a stored street ("W 32ND AVE") answers what was typed ("32ND", "32ND AVE", "W 32ND"):
// lower is better, 9 is no match. A leading direction is optional when typing, so "32nd" finds
// "W 32nd Ave"; a street whose whole name was typed beats one that merely starts with it, so "C"
// puts "C St" ahead of "Cedar Dr". A typed direction that disagrees with the stored one costs a little.
export function streetScore(stored: string, typed: string): number {
    if (!stored || !typed) return 9;
    const split = (v: string) => {
        const w = v.split(' ');
        const dir = w.length > 1 && DIR_SHORT.has(w[0]) ? w.shift()! : '';
        return { dir, rest: w.join(' ') };
    };
    const a = split(stored), b = split(typed);
    // A bare number is the numbered street: "32" means "32ND", and "3" means "3RD" before "30TH".
    if (/^\d+( |$)/.test(b.rest)) a.rest = a.rest.replace(/^(\d+)(ST|ND|RD|TH)\b/, '$1');
    let score: number;
    if (a.rest === b.rest) score = 0;
    else if (a.rest.startsWith(b.rest + ' ')) {
        // The typed text is the whole name when only a street type and/or a trailing direction follows.
        const tail = a.rest.slice(b.rest.length + 1).split(' ');
        score = tail.every(t => TYPE_SHORT.has(t) || DIR_SHORT.has(t)) ? 1 : 2;
    } else if (a.rest.startsWith(b.rest)) score = 3;
    else return 9;
    if (b.dir && a.dir !== b.dir) score += 0.5;
    return score;
}

// Best total score of an intersection's streets for the two typed streets (each typed street
// must be answered by a different stored street); 99 when either has no answer.
export function intersectionScore(streets: string[], a: string, b: string): number {
    let best = 99;
    streets.forEach((s1, i) => streets.forEach((s2, j) => {
        if (i === j) return;
        const x = streetScore(s1, a), y = streetScore(s2, b);
        if (x < 9 && y < 9) best = Math.min(best, x + y);
    }));
    return best;
}

// Metres between two points (haversine).
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (d: number) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// Bounding box (degrees) around a point for a radius in metres: the cheap pre-filter.
export function bbox(lat: number, lon: number, radiusM: number): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
    const dLat = radiusM / 111320;
    const dLon = radiusM / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
    return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

export interface AddressSettings {
    enabled: boolean;
    radius_point: number;        // m: nearest address point counts within this
    radius_intersection: number; // m: nearest intersection counts within this
    radius_place: number;        // m: a place is offered as the top alternate within this
    radius_giveup: number;       // m: beyond this, fall back to the public geocoder
    min_chars: number;           // typed characters before place / local search starts
    result_limit: number;        // suggestions shown
    osm_limit: boolean;          // keep typed public (OpenStreetMap) results inside a circle
    osm_lat: number | null;      // the circle's centre
    osm_lon: number | null;
    osm_radius_km: number;       // and its radius
    default_country: string;     // local data carries no country: this fills it
}

export const ADDRESS_SETTINGS_DEFAULT: AddressSettings = {
    enabled: false, radius_point: 60, radius_intersection: 40, radius_place: 30, radius_giveup: 150,
    min_chars: 2, result_limit: 5,
    osm_limit: false, osm_lat: null, osm_lon: null, osm_radius_km: 50,
    default_country: '',
};

export const ADDRESS_SETTINGS_KEY = 'local_addressing';

// Settings as stored, with every missing or bad value replaced by its default and numbers kept
// inside sane bounds, so a half-written row can never break a lookup.
export function normAddressSettings(v: unknown): AddressSettings {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const num = (k: keyof AddressSettings, min: number, max: number) => {
        const n = Number(o[k]);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : ADDRESS_SETTINGS_DEFAULT[k] as number;
    };
    const coord = (k: 'osm_lat' | 'osm_lon', max: number): number | null => {
        if (o[k] == null || o[k] === '') return null;
        const n = Number(o[k]);
        return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
    };
    const osm_lat = coord('osm_lat', 90), osm_lon = coord('osm_lon', 180);
    return {
        enabled: o.enabled === true,
        radius_point: num('radius_point', 5, 2000),
        radius_intersection: num('radius_intersection', 5, 2000),
        radius_place: num('radius_place', 5, 2000),
        radius_giveup: num('radius_giveup', 10, 5000),
        min_chars: num('min_chars', 1, 10),
        result_limit: num('result_limit', 3, 15),
        // The limit only counts with a centre: a switch left on without one would hide every result.
        osm_limit: o.osm_limit === true && osm_lat != null && osm_lon != null,
        osm_lat, osm_lon,
        osm_radius_km: num('osm_radius_km', 1, 2000),
        default_country: typeof o.default_country === 'string' ? o.default_country.trim().slice(0, 60) : '',
    };
}

// The public search area as Nominatim wants it (viewbox = left,top,right,bottom with bounded=1),
// or null when the limit is off. The box is the square around the circle; osmInArea trims the corners.
export function osmViewbox(s: AddressSettings): string | null {
    if (!s.osm_limit || s.osm_lat == null || s.osm_lon == null) return null;
    const b = bbox(s.osm_lat, s.osm_lon, s.osm_radius_km * 1000);
    return [b.minLon, b.maxLat, b.maxLon, b.minLat].map(n => n.toFixed(6)).join(',');
}

// Whether a public result may be shown: always when the limit is off, else only inside the circle.
export function osmInArea(s: AddressSettings, lat: number, lon: number): boolean {
    if (!s.osm_limit || s.osm_lat == null || s.osm_lon == null) return true;
    return distanceM(s.osm_lat, s.osm_lon, lat, lon) <= s.osm_radius_km * 1000;
}

// One row as the client sends it after field mapping (file upload) or as the server maps it
// from a web pull. Everything optional: the kind decides what is required.
export interface InRow {
    house_number?: unknown; prefix_dir?: unknown; pre_mod?: unknown; pre_type?: unknown; street_name?: unknown; street_type?: unknown;
    suffix_dir?: unknown; full_street?: unknown; unit_type?: unknown; unit?: unknown;
    city?: unknown; state?: unknown; zip?: unknown; full_address?: unknown; status?: unknown;
    street1?: unknown; street2?: unknown; street3?: unknown; street4?: unknown; city_state_zip?: unknown;
    name?: unknown; aliases?: unknown; category?: unknown; address?: unknown;
    lat?: unknown; lon?: unknown;
}

// A row ready for the table, or null when it cannot be used (and why).
export interface DbRow {
    kind: SourceKind;
    label: string;
    search: string;
    street: string | null;
    house_number: number | null;
    unit: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    streets: string[] | null;
    name: string | null;
    aliases: string | null;
    category: string | null;
    address: string | null;
    lat: number | null;
    lon: number | null;
    resolved: string | null;
}

const str = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number | null => {
    if (v == null || (typeof v === 'string' && !v.trim())) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
// A house number as the whole number it starts with: 123, "123A", "123 1/2" and "12-14" are all
// kept under their first number, so the address is found by it and not left out.
// A number too large for the table's integer column is not a house number (a parcel or record id
// mapped by mistake): the row is left out instead of failing the whole upload.
const houseNum = (v: unknown): number | null => {
    const n = num(v);
    const m = n != null ? null : /^\s*(\d+)/.exec(String(v ?? ''));
    const house = n != null ? Math.trunc(n) : m ? parseInt(m[1], 10) : null;
    return house != null && Math.abs(house) <= 2147483647 ? house : null;
};

// The street out of a whole address line that starts with its house number:
// "123 N Main St Apt 4, Springfield" → "N MAIN ST". '' when the line does not start that way.
export function streetOfAddress(address: unknown, houseNumber: unknown): string {
    const text = str(address).split(',')[0];
    const lead = str(houseNumber);
    if (!lead || !text.toUpperCase().startsWith(`${lead.toUpperCase()} `)) return '';
    const toks = normText(text.slice(lead.length)).split(' ').filter(Boolean);
    if (/^\d+\/\d+$/.test(toks[0] ?? '')) toks.shift();
    const cut = toks.findIndex(t => UNIT_WORDS.has(t) || t.startsWith('#'));
    return normStreet((cut >= 0 ? toks.slice(0, cut) : toks).join(' '));
}

// A point written as text in one CSV cell, the way open-data portals export it: "POINT (-123.2 44.5)".
export function wktPoint(v: unknown): { type: 'Point'; coordinates: [number, number] } | null {
    const m = /^\s*POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$/i.exec(String(v ?? ''));
    return m ? { type: 'Point', coordinates: [Number(m[1]), Number(m[2])] } : null;
}

// The CSV column that holds such points, if any (looked for in the first rows).
export function wktColumn(columns: string[], rows: Record<string, unknown>[]): string | null {
    const head = rows.slice(0, 20);
    return columns.find(c => head.some(r => wktPoint(r[c]))) ?? null;
}

export function toDbRow(kind: SourceKind, r: InRow): { row: DbRow | null; reason?: string } {
    const lat = num(r.lat), lon = num(r.lon);
    const hasPt = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    // Numbers that cannot be degrees (state plane feet, metres) get their own reason: the file has
    // coordinates, only not ones that can be used.
    const noPt = lat != null && lon != null && !(lat === 0 && lon === 0) ? 'coordinates are not latitude and longitude' : 'no coordinates';
    if (kind === 'points') {
        // With no street column mapped, a full address that starts with the house number gives the street.
        const street = streetFromParts(r) || streetOfAddress(r.full_address, r.house_number);
        const house = houseNum(r.house_number);
        if (!street) return { row: null, reason: 'no street name' };
        if (house == null) return { row: null, reason: 'no house number' };
        if (!hasPt) return { row: null, reason: noPt };
        const unit = str(r.unit) || null;
        const unitType = str(r.unit_type);
        const label = str(r.full_address) || [
            `${num(r.house_number) != null ? house : str(r.house_number)} ${[r.pre_mod, r.prefix_dir, r.pre_type, r.street_name, r.street_type, r.suffix_dir].map(str).filter(Boolean).join(' ') || str(r.full_street)}`,
            unit ? `${unitType ? unitType + ' ' : ''}${unit}` : '',
        ].filter(Boolean).join(' ');
        return { row: {
            kind, label, search: normText(label), street, house_number: house, unit,
            city: str(r.city) || null, state: str(r.state) || null, zip: str(r.zip) || null,
            streets: null, name: null, aliases: null, category: null, address: null, lat, lon, resolved: 'given',
        } };
    }
    if (kind === 'intersections') {
        const streets = [r.street1, r.street2, r.street3, r.street4].map(normStreet).filter(Boolean);
        if (streets.length < 2) return { row: null, reason: 'fewer than two street names' };
        if (!hasPt) return { row: null, reason: noPt };
        const label = [r.street1, r.street2, r.street3, r.street4].map(str).filter(Boolean).join(' & ');
        const csz = str(r.city_state_zip);
        return { row: {
            kind, label, search: normText(label), street: null, house_number: null, unit: null,
            city: str(r.city) || csz || null, state: str(r.state) || null, zip: str(r.zip) || null,
            streets, name: null, aliases: null, category: null, address: null, lat, lon, resolved: 'given',
        } };
    }
    const name = str(r.name);
    if (!name) return { row: null, reason: 'no name' };
    const address = str(r.address);
    if (!address && !hasPt) return { row: null, reason: 'no address and no coordinates' };
    const aliases = str(r.aliases).split(/[;|]/).map(s => s.trim()).filter(Boolean);
    // "Station 08" is also found by "station 8": numbers are searchable without their leading zeros.
    const plain = [name, ...aliases].map(t => t.replace(/\b0+(\d)/g, '$1')).filter(t => t !== name && !aliases.includes(t));
    return { row: {
        kind, label: name, search: normText([name, ...aliases, ...plain].join(' | ')), street: null, house_number: null,
        unit: str(r.unit) || null, city: str(r.city) || null, state: str(r.state) || null, zip: str(r.zip) || null,
        streets: null, name, aliases: aliases.join('; ') || null, category: str(r.category) || null,
        address: address || null, lat: hasPt ? lat : null, lon: hasPt ? lon : null, resolved: hasPt ? 'given' : null,
    } };
}

// What one lookup answer looks like, for every source.
export interface Suggestion {
    source: 'place' | 'local' | 'osm';
    kind: 'point' | 'intersection' | 'place' | 'osm';
    label: string;
    lat: number;
    lon: number;
    streetName: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    unit?: string | null;
    units?: { unit: string; label: string; lat: number; lon: number }[];
    placeName?: string | null;
    category?: string | null;
    asOf?: string | null;
    distance?: number;
}

// Address-point rows that share one base address collapse into one suggestion carrying the
// units, so "123 MAIN ST" with forty apartments is one line and not forty.
export function collapseUnits(rows: (DbRow & { as_of?: string | null; dist?: number })[]): Suggestion[] {
    const groups = new Map<string, (DbRow & { as_of?: string | null; dist?: number })[]>();
    for (const r of rows) {
        const k = `${r.house_number}|${r.street}|${r.city ?? ''}`;
        const g = groups.get(k);
        if (g) g.push(r); else groups.set(k, [r]);
    }
    const out: Suggestion[] = [];
    for (const g of groups.values()) {
        const base = g.find(r => !r.unit) ?? g[0];
        const units = g.filter(r => r.unit);
        // The base address without any unit: the unit-less row's label, else house + street.
        const baseLabel = base.unit ? `${base.house_number} ${base.street}` : base.label;
        const s: Suggestion = {
            source: 'local', kind: 'point',
            label: units.length > 1 ? `${baseLabel} (${units.length} units)` : base.label,
            lat: base.lat!, lon: base.lon!,
            streetName: baseLabel.replace(/,.*$/, ''), city: base.city ?? '', state: base.state ?? '', zipCode: base.zip ?? '', country: '',
            unit: units.length === 1 && base.unit ? base.unit : null,
            asOf: base.as_of ?? null,
        };
        if (units.length > 1 || (units.length === 1 && !base.unit)) {
            s.units = units.map(u => ({ unit: u.unit!, label: u.label, lat: u.lat!, lon: u.lon! }));
        }
        const d = g.map(r => r.dist).filter((n): n is number => typeof n === 'number');
        if (d.length) s.distance = Math.min(...d);
        out.push(s);
    }
    return out;
}

// A place or intersection often comes without a city, state or ZIP of its own. Fill the blanks
// from the verified address point it sits at (never over a value the source gave), and the
// country from the admin's default, since local data has no country. Once a place has all three,
// its street line drops the "…, City, ST 12345" tail it was imported with.
export function fillBlanks(s: Suggestion, from: { city?: string | null; state?: string | null; zip?: string | null } | null, country: string): Suggestion {
    if (s.source === 'osm') return s;
    const out: Suggestion = { ...s };
    if (from) {
        if (!out.city) out.city = from.city ?? '';
        if (!out.state) out.state = from.state ?? '';
        if (!out.zipCode) out.zipCode = from.zip ?? '';
    }
    if (out.kind === 'place' && out.city && out.state && out.zipCode && out.streetName.includes(',')) {
        out.streetName = out.streetName.split(',')[0].trim();
    }
    if (!out.country) out.country = country;
    return out;
}

// Which nearby thing a map click means. Intersections sit in the road centre and address points
// on the lot, so an intersection inside its radius that is at least as close wins; otherwise the
// nearest address point inside its radius; a place inside its radius is offered first among the
// alternates but never applied by itself.
export function chooseReverse(
    cand: { point?: Suggestion | null; intersection?: Suggestion | null; place?: Suggestion | null; others: Suggestion[] },
    s: AddressSettings
): { best: Suggestion | null; alternates: Suggestion[] } {
    const p = cand.point && cand.point.distance! <= s.radius_point ? cand.point : null;
    const x = cand.intersection && cand.intersection.distance! <= s.radius_intersection ? cand.intersection : null;
    const pl = cand.place && cand.place.distance! <= s.radius_place ? cand.place : null;
    let best: Suggestion | null = null;
    if (x && (!p || x.distance! <= p.distance!)) best = x;
    else if (p) best = p;
    const alternates: Suggestion[] = [];
    if (pl) alternates.push(pl);
    // The nearest point and intersection are offered even when outside their own radius, as
    // long as they are inside the give-up distance: the dispatcher may know better.
    for (const o of [cand.intersection, cand.point, ...cand.others]) {
        if (!o || o === best || alternates.includes(o)) continue;
        if (o.distance! > s.radius_giveup) continue;
        alternates.push(o);
        if (alternates.length >= 4) break;
    }
    return { best, alternates };
}

// Column names a file is likely to use for each field, checked case-insensitively (exact, then
// contains). Shared with the browser (plugin/lib/address-parse.ts keeps the same table).
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

// Apply a mapping to one record's properties (plus GeoJSON geometry when present).
export function applyMapping(mapping: Record<string, string>, props: Record<string, unknown>, geom?: { type?: string; coordinates?: unknown } | null): InRow {
    const row: Record<string, unknown> = {};
    for (const [field, col] of Object.entries(mapping)) {
        if (col && col in props) row[field] = props[col];
    }
    if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
        row.lon = geom.coordinates[0];
        row.lat = geom.coordinates[1];
    }
    return row as InRow;
}

// Small CSV reader (quoted fields, embedded newlines, CRLF). Returns header + rows as objects.
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

// Whether a web source should be pulled now: its interval after the last good pull has passed, and
// a pull that failed is not tried again for an hour (not on the very next lookup).
export const PULL_RETRY_MS = 3600_000;
export function pullDue(lastRefreshMs: number, lastFailMs: number, refreshHours: number, now: number): boolean {
    if (now - lastRefreshMs < Math.max(1, refreshHours) * 3600_000) return false;
    return now - lastFailMs >= PULL_RETRY_MS;
}

// What tells one page of features from the next (its first and last feature), to notice a
// service that ignores the page offset and sends the same page again.
export function pageKey(feats: unknown[]): string {
    return feats.length ? `${JSON.stringify(feats[0])}|${JSON.stringify(feats[feats.length - 1])}` : '';
}

// A FeatureServer / MapServer layer URL (".../FeatureServer/0"), with a trailing /query and any
// query string removed. A service address with no layer number means its first layer.
export function esriLayerUrl(url: string): string | null {
    const m = /^(https?:\/\/[^?#]+?\/(?:FeatureServer|MapServer))(?:\/(\d+))?(?:\/query)?\/?(?:\?.*)?$/i.exec(url.trim());
    return m ? `${m[1]}/${m[2] ?? '0'}` : null;
}

// </addressing-pure>

// ── DB helpers ───────────────────────────────────────────────────────────────────────────────

interface SourceRow {
    id: string;
    kind: SourceKind;
    name: string;
    mode: 'file' | 'url';
    url: string | null;
    refresh_hours: number;
    mapping: Record<string, string>;
    status_keep: string[] | null;
    data_as_of: string | null;
    last_refresh: string | null;
    record_count: number;
    dropped_count: number;
    unresolved_count: number;
    last_error: string | null;
    status: string;
    created_at: string;
}

// The JSON goes in as text and Postgres makes the jsonb (`::text::jsonb`). A parameter cast straight
// to jsonb makes CloudTAK's driver JSON-encode the text a second time, so the column would hold a
// JSON string and jsonb_array_elements_text() on it would fail. Same rule as plugin-dispatcher.ts.
async function query<T>(config: ConfigStateless, statement: ReturnType<typeof sql>): Promise<T[]> {
    const result = await config.pg.execute(statement);
    return result as unknown as T[];
}

function unwrap<T>(v: unknown, fallback: T): T {
    let x: unknown = v;
    for (let i = 0; i < 4 && typeof x === 'string'; i++) {
        try { x = JSON.parse(x); } catch { break; }
    }
    return (x == null ? fallback : x) as T;
}

function sourceOut(r: SourceRow): SourceRow {
    return { ...r, mapping: unwrap(r.mapping, {}), status_keep: unwrap(r.status_keep, null) };
}

async function sources(config: ConfigStateless): Promise<SourceRow[]> {
    const rows = await query<SourceRow>(config, sql`
        SELECT id, kind, name, mode, url, refresh_hours, mapping, status_keep, data_as_of, last_refresh,
               record_count, dropped_count, unresolved_count, last_error, status, created_at
        FROM dispatcher_address_sources ORDER BY created_at
    `);
    return rows.map(sourceOut);
}

async function sourceById(config: ConfigStateless, id: string): Promise<SourceRow> {
    const rows = await query<SourceRow>(config, sql`
        SELECT id, kind, name, mode, url, refresh_hours, mapping, status_keep, data_as_of, last_refresh,
               record_count, dropped_count, unresolved_count, last_error, status, created_at
        FROM dispatcher_address_sources WHERE id = ${id}
    `);
    if (!rows.length) throw new Err(404, null, 'Address source not found');
    return sourceOut(rows[0]);
}

async function readSettings(config: ConfigStateless): Promise<AddressSettings> {
    const rows = await query<{ value: unknown }>(config, sql`
        SELECT value FROM dispatcher_settings WHERE key = ${ADDRESS_SETTINGS_KEY}
    `);
    return normAddressSettings(rows.length ? unwrap(rows[0].value, {}) : {});
}

async function requireAdmin(config: ConfigStateless, req: any): Promise<void> {
    const user = await Auth.as_user(config, req);
    if (!user.is_admin()) throw new Err(403, null, 'Only a CloudTAK system admin can change local address data');
}

const ROW_COLS = sql`kind, label, search, street, house_number, unit, city, state, zip, streets, name, aliases, category, address, lat, lon, resolved`;

async function insertRows(config: ConfigStateless, sourceId: string, loadId: string, rows: DbRow[]): Promise<void> {
    // Batches of 500 keep each statement small enough for the driver.
    for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const values = chunk.map(r => sql`(
            ${sourceId}, ${loadId}, false, ${r.kind}, ${r.label}, ${r.search}, ${r.street}, ${r.house_number}, ${r.unit},
            ${r.city}, ${r.state}, ${r.zip}, ${r.streets ? JSON.stringify(r.streets) : null}::text::jsonb,
            ${r.name}, ${r.aliases}, ${r.category}, ${r.address}, ${r.lat}, ${r.lon}, ${r.resolved}
        )`);
        await config.pg.execute(sql`
            INSERT INTO dispatcher_address_rows (source_id, load_id, active, ${ROW_COLS})
            VALUES ${sql.join(values, sql`, `)}
        `);
    }
}

// Resolve places that came without coordinates against the loaded address points: the places of
// one load, or (null) every live place still without a location.
async function resolvePlaces(config: ConfigStateless, loadId: string | null): Promise<{ matched: number; unresolved: number }> {
    const rows = await query<{ id: number; address: string }>(config, sql`
        SELECT id, address FROM dispatcher_address_rows
        WHERE ${loadId ? sql`load_id = ${loadId}` : sql`active`} AND kind = 'places' AND lat IS NULL AND address IS NOT NULL
    `);
    let matched = 0;
    for (const r of rows) {
        const pq = parseQuery(r.address);
        if (pq.kind !== 'address' || pq.number == null || !pq.street) continue;
        const hit = await query<{ lat: number; lon: number }>(config, sql`
            SELECT lat, lon FROM dispatcher_address_rows
            WHERE active AND kind = 'points' AND house_number = ${pq.number} AND ${streetLike(sql`street`, pq.street)}
            ORDER BY (street = ${pq.street}) DESC, length(street), unit NULLS FIRST LIMIT 1
        `);
        if (hit.length) {
            await config.pg.execute(sql`
                UPDATE dispatcher_address_rows SET lat = ${hit[0].lat}, lon = ${hit[0].lon}, resolved = 'matched' WHERE id = ${r.id}
            `);
            matched++;
        }
    }
    return { matched, unresolved: rows.length - matched };
}

// Make a staged load the live data for its source and drop the old rows (the staging swap).
async function commitLoad(config: ConfigStateless, src: SourceRow, loadId: string, dataAsOf: string | null, dropped: number): Promise<SourceRow> {
    const cnt = await query<{ n: number }>(config, sql`
        SELECT count(*)::int AS n FROM dispatcher_address_rows WHERE load_id = ${loadId}
    `);
    const n = cnt[0]?.n ?? 0;
    if (n === 0) throw new Err(400, null, 'The load has no usable rows; the previous data is kept');
    let unresolved = 0;
    if (src.kind === 'places') {
        unresolved = (await resolvePlaces(config, loadId)).unresolved;
    }
    await config.pg.execute(sql`
        UPDATE dispatcher_address_rows SET active = true WHERE load_id = ${loadId}
    `);
    await config.pg.execute(sql`
        DELETE FROM dispatcher_address_rows WHERE source_id = ${src.id} AND load_id <> ${loadId}
    `);
    // New address points can locate places that were loaded before them.
    if (src.kind === 'points') {
        await resolvePlaces(config, null);
        await config.pg.execute(sql`
            UPDATE dispatcher_address_sources s
            SET unresolved_count = (SELECT count(*)::int FROM dispatcher_address_rows r WHERE r.source_id = s.id AND r.active AND r.lat IS NULL)
            WHERE s.kind = 'places'
        `);
    }
    await config.pg.execute(sql`
        UPDATE dispatcher_address_sources
        SET record_count = ${n}, dropped_count = ${dropped}, unresolved_count = ${unresolved},
            data_as_of = ${dataAsOf ?? src.data_as_of ?? new Date().toISOString()}::timestamptz,
            last_refresh = now(), last_error = NULL, status = 'ok'
        WHERE id = ${src.id}
    `);
    return sourceById(config, src.id);
}

async function failLoad(config: ConfigStateless, srcId: string, loadId: string | null, message: string): Promise<void> {
    if (loadId) {
        await config.pg.execute(sql`DELETE FROM dispatcher_address_rows WHERE load_id = ${loadId} AND NOT active`);
    }
    await config.pg.execute(sql`
        UPDATE dispatcher_address_sources
        SET status = CASE WHEN record_count > 0 THEN 'ok' ELSE 'failed' END, last_error = ${message.slice(0, 500)}
        WHERE id = ${srcId}
    `);
}

// ── Public geocoder fallback (OpenStreetMap Nominatim, same service the TAK-CAD proxy uses) ──

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const NOMINATIM_HEADERS = { 'User-Agent': 'infra-TAK-dispatcher/1.0 (contact@takwerx.com)' };
const OSM_TIMEOUT_MS = 6000;

type NominatimFeature = { display_name: string; lat: string; lon: string; address: Record<string, string> };

function osmToSuggestion(f: NominatimFeature): Suggestion {
    const a = f.address || {};
    const street = [a.house_number, a.road || a.pedestrian || a.footway || a.path].filter(Boolean).join(' ');
    return {
        source: 'osm', kind: 'osm', label: f.display_name || '',
        lat: parseFloat(f.lat), lon: parseFloat(f.lon),
        streetName: street || '', city: a.city || a.town || a.village || a.hamlet || a.county || '',
        state: a.state || '', zipCode: a.postcode || '', country: a.country || '',
    };
}

async function osmSuggest(q: string, limit: number, settings: AddressSettings): Promise<Suggestion[]> {
    try {
        const qs = new URLSearchParams({ q, format: 'json', addressdetails: '1', limit: String(limit) });
        const viewbox = osmViewbox(settings);
        if (viewbox) { qs.set('viewbox', viewbox); qs.set('bounded', '1'); }
        const r = await fetch(`${NOMINATIM_BASE}/search?${qs.toString()}`, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(OSM_TIMEOUT_MS) });
        if (!r.ok) return [];
        const json = await r.json() as NominatimFeature[];
        return (Array.isArray(json) ? json : []).map(osmToSuggestion).filter(s => osmInArea(settings, s.lat, s.lon));
    } catch {
        return [];
    }
}

async function osmReverse(lat: number, lon: number): Promise<Suggestion | null> {
    try {
        const qs = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'json', addressdetails: '1' });
        const r = await fetch(`${NOMINATIM_BASE}/reverse?${qs.toString()}`, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(OSM_TIMEOUT_MS) });
        if (!r.ok) return null;
        const f = await r.json() as NominatimFeature;
        return f && f.lat ? osmToSuggestion(f) : null;
    } catch {
        return null;
    }
}

// ── Web pulls (ArcGIS Feature Service pages, or a plain GeoJSON / CSV file) ──────────────────

const PULL_TIMEOUT_MS = 30000;
const PULL_MAX_BYTES = 80 * 1024 * 1024;

async function fetchText(url: string): Promise<string> {
    const r = await fetch(url, { signal: AbortSignal.timeout(PULL_TIMEOUT_MS), headers: { 'Accept': 'application/json, text/csv, */*' } });
    if (!r.ok) throw new Err(502, null, `The web address answered ${r.status}`);
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > PULL_MAX_BYTES) throw new Err(400, null, 'The file is larger than 80 MB; load it by pages (Feature Service) instead');
    const text = await r.text();
    if (text.length > PULL_MAX_BYTES) throw new Err(400, null, 'The file is larger than 80 MB; load it by pages (Feature Service) instead');
    return text;
}

interface Probe {
    type: 'esri' | 'geojson' | 'csv';
    columns: string[];
    sample: Record<string, unknown>[];
    count: number | null;
    lastEdit: string | null;
    geometry: boolean;
}

// Look at a web address once: what columns it has and a few rows, so the admin can map fields.
async function probeUrl(url: string): Promise<Probe> {
    const layer = esriLayerUrl(url);
    if (layer) {
        const meta = await (await fetch(`${layer}?f=pjson`, { signal: AbortSignal.timeout(PULL_TIMEOUT_MS) })).json() as any;
        if (meta?.error) throw new Err(400, null, `The service answered: ${meta.error.message ?? 'error'}`);
        const columns = (meta.fields ?? []).map((f: any) => String(f.name));
        let count: number | null = null;
        try {
            const c = await (await fetch(`${layer}/query?where=1%3D1&returnCountOnly=true&f=json`, { signal: AbortSignal.timeout(PULL_TIMEOUT_MS) })).json() as any;
            if (typeof c?.count === 'number') count = c.count;
        } catch { /* count is a nicety */ }
        const s = await (await fetch(`${layer}/query?where=1%3D1&outFields=*&resultRecordCount=3&f=geojson`, { signal: AbortSignal.timeout(PULL_TIMEOUT_MS) })).json() as any;
        const sample = (s?.features ?? []).map((f: any) => ({ ...(f.properties ?? {}), __lon: f.geometry?.coordinates?.[0], __lat: f.geometry?.coordinates?.[1] }));
        const le = meta?.editingInfo?.lastEditDate;
        return {
            type: 'esri', columns, sample, count,
            lastEdit: typeof le === 'number' ? new Date(le).toISOString() : null,
            geometry: String(meta.geometryType ?? '').toLowerCase().includes('point'),
        };
    }
    const text = await fetchText(url);
    if (text.trimStart().startsWith('{')) {
        const gj = JSON.parse(text);
        const feats: any[] = Array.isArray(gj?.features) ? gj.features : [];
        const columns = Array.from(new Set(feats.slice(0, 50).flatMap(f => Object.keys(f.properties ?? {}))));
        const sample = feats.slice(0, 3).map(f => ({ ...(f.properties ?? {}), __lon: f.geometry?.coordinates?.[0], __lat: f.geometry?.coordinates?.[1] }));
        return { type: 'geojson', columns, sample, count: feats.length, lastEdit: null, geometry: feats.some(f => f.geometry?.type === 'Point') };
    }
    const csv = parseCsv(text);
    const wkt = wktColumn(csv.columns, csv.rows);
    const sample = csv.rows.slice(0, 3).map(r => { const g = wkt ? wktPoint(r[wkt]) : null; return g ? { ...r, __lon: g.coordinates[0], __lat: g.coordinates[1] } : r; });
    return { type: 'csv', columns: csv.columns, sample, count: csv.rows.length, lastEdit: null, geometry: !!wkt };
}

const refreshing = new Set<string>();
const pullFailedAt = new Map<string, number>();
let lastDueCheck = 0;

// Pull a URL source into a staged load and commit it. Serialised per source.
async function pullSource(config: ConfigStateless, src: SourceRow): Promise<SourceRow> {
    if (!src.url) throw new Err(400, null, 'This source has no web address');
    if (refreshing.has(src.id)) throw new Err(409, null, 'This source is already refreshing');
    refreshing.add(src.id);
    const loadId = randomUUID();
    let dropped = 0;
    try {
        await config.pg.execute(sql`UPDATE dispatcher_address_sources SET status = 'loading', last_error = NULL WHERE id = ${src.id}`);
        const keep = src.status_keep && src.status_keep.length ? new Set(src.status_keep.map(normText)) : null;
        const take = async (props: Record<string, unknown>[], geoms: (any | null)[]) => {
            const rows: DbRow[] = [];
            props.forEach((p, i) => {
                const inRow = applyMapping(src.mapping, p, geoms[i]);
                if (keep && src.mapping.status && !keep.has(normText(inRow.status))) { dropped++; return; }
                const { row } = toDbRow(src.kind, inRow);
                if (row) rows.push(row); else dropped++;
            });
            if (rows.length) await insertRows(config, src.id, loadId, rows);
        };
        let dataAsOf: string | null = null;
        const layer = esriLayerUrl(src.url);
        if (layer) {
            const meta = await (await fetch(`${layer}?f=pjson`, { signal: AbortSignal.timeout(PULL_TIMEOUT_MS) })).json() as any;
            if (meta?.error) throw new Err(502, null, `The service answered: ${meta.error.message ?? 'error'}`);
            const le = meta?.editingInfo?.lastEditDate;
            if (typeof le === 'number') dataAsOf = new Date(le).toISOString();
            const page = Math.min(2000, Number(meta?.maxRecordCount) || 1000);
            let offset = 0;
            let lastPage = '';
            for (let guard = 0; guard < 2000; guard++) {
                const qs = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', resultOffset: String(offset), resultRecordCount: String(page) });
                const r = await fetch(`${layer}/query?${qs.toString()}`, { signal: AbortSignal.timeout(PULL_TIMEOUT_MS) });
                if (!r.ok) throw new Err(502, null, `The service answered ${r.status} while paging`);
                const gj = await r.json() as any;
                if (gj?.error) throw new Err(502, null, `The service answered: ${gj.error.message ?? 'error'}`);
                const feats: any[] = gj?.features ?? [];
                // A layer that cannot page answers every request with its first rows.
                const key = pageKey(feats);
                if (key && key === lastPage) throw new Err(502, null, 'The service sends the same rows for every page, so it cannot be read in pages. Load the data from a file instead');
                lastPage = key;
                await take(feats.map(f => f.properties ?? {}), feats.map(f => f.geometry ?? null));
                offset += feats.length;
                const more = gj?.exceededTransferLimit === true || gj?.properties?.exceededTransferLimit === true;
                if (!feats.length || (!more && feats.length < page)) break;
            }
        } else {
            const text = await fetchText(src.url);
            if (text.trimStart().startsWith('{')) {
                const gj = JSON.parse(text);
                const feats: any[] = Array.isArray(gj?.features) ? gj.features : [];
                for (let i = 0; i < feats.length; i += 2000) {
                    const chunk = feats.slice(i, i + 2000);
                    await take(chunk.map(f => f.properties ?? {}), chunk.map(f => f.geometry ?? null));
                }
            } else {
                const csv = parseCsv(text);
                const wkt = wktColumn(csv.columns, csv.rows);
                for (let i = 0; i < csv.rows.length; i += 2000) {
                    const chunk = csv.rows.slice(i, i + 2000);
                    await take(chunk, chunk.map(r => wkt ? wktPoint(r[wkt]) : null));
                }
            }
        }
        // A source with no edit date of its own (a plain file, a layer without edit tracking) is as
        // of this pull, not of the first one.
        const done = await commitLoad(config, src, loadId, dataAsOf ?? new Date().toISOString(), dropped);
        pullFailedAt.delete(src.id);
        return done;
    } catch (err) {
        pullFailedAt.set(src.id, Date.now());
        await failLoad(config, src.id, loadId, err instanceof Error ? err.message : String(err));
        throw err;
    } finally {
        refreshing.delete(src.id);
    }
}

// Lazy refresh: when a lookup arrives and a URL source is past its interval, refresh it in the
// background. The lookup is answered from the current data. Checked at most once a minute.
function maybeRefreshDue(config: ConfigStateless): void {
    const now = Date.now();
    if (now - lastDueCheck < 60_000) return;
    lastDueCheck = now;
    void (async () => {
        try {
            for (const s of await sources(config)) {
                if (s.mode !== 'url' || !s.url || refreshing.has(s.id)) continue;
                const last = s.last_refresh ? new Date(s.last_refresh).getTime() : 0;
                if (pullDue(last, pullFailedAt.get(s.id) ?? 0, s.refresh_hours, now)) {
                    pullSource(config, s).catch(err => console.warn('[dispatcher] address refresh failed', s.name, err?.message ?? err));
                }
            }
        } catch (err) {
            console.warn('[dispatcher] address refresh check failed', err);
        }
    })();
}

// ── Lookups ──────────────────────────────────────────────────────────────────────────────────

type RowOut = DbRow & { id: number; as_of: string | null; dist?: number };

function rowToSuggestion(r: RowOut): Suggestion {
    if (r.kind === 'places') {
        return {
            source: 'place', kind: 'place', label: r.label, lat: r.lat ?? 0, lon: r.lon ?? 0,
            streetName: r.address ?? '', city: r.city ?? '', state: r.state ?? '', zipCode: r.zip ?? '', country: '',
            unit: r.unit, placeName: r.name, category: r.category, asOf: r.as_of, distance: r.dist,
        };
    }
    if (r.kind === 'intersections') {
        return {
            source: 'local', kind: 'intersection', label: r.label, lat: r.lat!, lon: r.lon!,
            streetName: r.label, city: r.city ?? '', state: r.state ?? '', zipCode: r.zip ?? '', country: '',
            asOf: r.as_of, distance: r.dist,
        };
    }
    return collapseUnits([r])[0];
}

const SELECT_ROW = sql`
    r.id, r.kind, r.label, r.search, r.street, r.house_number, r.unit, r.city, r.state, r.zip, r.streets,
    r.name, r.aliases, r.category, r.address, r.lat, r.lon, r.resolved, s.data_as_of AS as_of
`;

// SQL: the column starts with the typed street, with or without a one- or two-letter direction
// in front ("32ND" finds "W 32ND AVE", "NE 32ND ST"). Ranking is done after, by streetScore.
function streetLike(col: ReturnType<typeof sql>, typed: string) {
    return sql`(${col} LIKE ${typed + '%'} OR ${col} LIKE ${'_ ' + typed + '%'} OR ${col} LIKE ${'__ ' + typed + '%'})`;
}

const streetsOf = (r: { streets: unknown }): string[] => unwrap<string[]>(r.streets, []);

async function localSuggest(config: ConfigStateless, raw: string, settings: AddressSettings): Promise<Suggestion[]> {
    const pq = parseQuery(raw);
    const lim = settings.result_limit;
    const out: Suggestion[] = [];
    if (pq.kind === 'address' && pq.street) {
        // At the same house number the typed street may also start at a later word of the stored
        // one, so "Highway 191" finds "Kentucky Highway 191". Those come after the closer matches.
        const rows = await query<RowOut>(config, sql`
            SELECT ${SELECT_ROW} FROM dispatcher_address_rows r JOIN dispatcher_address_sources s ON s.id = r.source_id
            WHERE r.active AND r.kind = 'points' AND r.house_number = ${pq.number}
              AND (${streetLike(sql`r.street`, pq.street)} OR r.street LIKE ${'% ' + pq.street + '%'})
              ${pq.unit ? sql`AND (r.unit IS NULL OR upper(r.unit) = ${pq.unit})` : sql``}
            ORDER BY length(r.street), r.unit NULLS FIRST LIMIT 400
        `);
        rows.sort((a, b) => streetScore(a.street ?? '', pq.street) - streetScore(b.street ?? '', pq.street));
        for (const s of collapseUnits(rows)) { if (out.length < lim) out.push(s); }
        return out;
    }
    // Places: name or alias starts with the text, then a word starts with it, then every typed word
    // starts some word. A typed word only ever matches the start of a word: "ACE" finds "Ace
    // Hardware", not "Market Place". A place with no location yet cannot be dispatched to: left out.
    const words = pq.words.filter(Boolean);
    if (!words.length) return out;
    const q = normText(raw);
    const all = sql.join(words.map(w => sql`(' ' || r.search) LIKE ${'% ' + w + '%'}`), sql` AND `);
    const places = await query<RowOut & { rank: number }>(config, sql`
        SELECT ${SELECT_ROW},
               CASE WHEN r.search LIKE ${q + '%'} THEN 1
                    WHEN r.search LIKE ${'% ' + q + '%'} OR r.search LIKE ${'%| ' + q + '%'} THEN 2
                    ELSE 3 END AS rank
        FROM dispatcher_address_rows r JOIN dispatcher_address_sources s ON s.id = r.source_id
        WHERE r.active AND r.kind = 'places' AND r.lat IS NOT NULL AND ${all}
        ORDER BY rank, r.name LIMIT ${lim}
    `);
    for (const p of places) out.push(rowToSuggestion(p));
    // Text with "and", "at", "&" or "/" in it reads as two streets, but a place name can hold those
    // too ("Fifth and Main Diner"), so the places above come first and the intersections after.
    if (pq.kind === 'intersection') {
        if (out.length >= lim) return out;
        const rows = await query<RowOut>(config, sql`
            SELECT ${SELECT_ROW} FROM dispatcher_address_rows r JOIN dispatcher_address_sources s ON s.id = r.source_id
            WHERE r.active AND r.kind = 'intersections'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.streets) t WHERE ${streetLike(sql`t`, pq.street)})
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.streets) t WHERE ${streetLike(sql`t`, pq.street2)})
            ORDER BY length(r.label) LIMIT 400
        `);
        return out.concat(rows
            .map(r => ({ r, score: intersectionScore(streetsOf(r), pq.street, pq.street2) }))
            .filter(x => x.score < 99)
            .sort((x, y) => x.score - y.score || x.r.label.length - y.r.label.length)
            .slice(0, lim - out.length)
            .map(x => rowToSuggestion(x.r)));
    }
    // Free text: after the places, intersections where a street starts with it.
    if (out.length < lim && pq.street) {
        const inter = await query<RowOut>(config, sql`
            SELECT ${SELECT_ROW} FROM dispatcher_address_rows r JOIN dispatcher_address_sources s ON s.id = r.source_id
            WHERE r.active AND r.kind = 'intersections'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.streets) t WHERE ${streetLike(sql`t`, pq.street)})
            ORDER BY length(r.label) LIMIT 200
        `);
        const best = (r: RowOut) => Math.min(...streetsOf(r).map(t => streetScore(t, pq.street)));
        inter.sort((a, b) => best(a) - best(b) || a.label.length - b.label.length);
        for (const r of inter.slice(0, lim - out.length)) out.push(rowToSuggestion(r));
    }
    return out;
}

async function nearest(config: ConfigStateless, kind: SourceKind, lat: number, lon: number, radiusM: number, limit: number): Promise<RowOut[]> {
    const b = bbox(lat, lon, radiusM);
    const rows = await query<RowOut>(config, sql`
        SELECT ${SELECT_ROW} FROM dispatcher_address_rows r JOIN dispatcher_address_sources s ON s.id = r.source_id
        WHERE r.active AND r.kind = ${kind} AND r.lat IS NOT NULL
          AND r.lat BETWEEN ${b.minLat} AND ${b.maxLat} AND r.lon BETWEEN ${b.minLon} AND ${b.maxLon}
        ORDER BY power(r.lat - ${lat}, 2) + power((r.lon - ${lon}) * ${Math.cos(lat * Math.PI / 180)}, 2)
        LIMIT 400
    `);
    return rows
        .map(r => ({ ...r, dist: distanceM(lat, lon, r.lat!, r.lon!) }))
        .filter(r => r.dist! <= radiusM)
        .sort((a, b2) => a.dist! - b2.dist!)
        .slice(0, limit);
}

async function localReverse(config: ConfigStateless, lat: number, lon: number, s: AddressSettings): Promise<{ best: Suggestion | null; alternates: Suggestion[] }> {
    const R = s.radius_giveup;
    const [pts, xs, pls] = await Promise.all([
        nearest(config, 'points', lat, lon, R, 60),
        nearest(config, 'intersections', lat, lon, R, 3),
        nearest(config, 'places', lat, lon, R, 3),
    ]);
    // Points: collapse units at the same base address; each keeps the distance of its nearest row.
    const pointSugs = collapseUnits(pts).sort((a, b2) => a.distance! - b2.distance!);
    const xSugs = xs.map(rowToSuggestion);
    const plSugs = pls.map(rowToSuggestion);
    return chooseReverse({
        point: pointSugs[0] ?? null,
        intersection: xSugs[0] ?? null,
        place: plSugs[0] ?? null,
        others: [...pointSugs.slice(1, 4), ...xSugs.slice(1), ...plSugs.slice(1)].sort((a, b2) => a.distance! - b2.distance!),
    }, s);
}

// A place with an address line is matched to the address point with that house number and street
// (the nearest one, and only within this distance when the place has its own location: the same
// number and street can exist in two towns). Anything else takes the nearest address point.
const SAME_ADDRESS_MAX_M = 1000;

type Parts = { city: string | null; state: string | null; zip: string | null; lat: number; lon: number };

async function verifiedParts(config: ConfigStateless, s: Suggestion, settings: AddressSettings): Promise<Parts | null> {
    const hasPt = Number.isFinite(s.lat) && Number.isFinite(s.lon) && !(s.lat === 0 && s.lon === 0);
    if (s.kind === 'place' && s.streetName) {
        const pq = parseQuery(s.streetName.split(',')[0]);
        if (pq.kind === 'address' && pq.number != null && pq.street) {
            const hits = await query<Parts>(config, sql`
                SELECT city, state, zip, lat, lon FROM dispatcher_address_rows
                WHERE active AND kind = 'points' AND house_number = ${pq.number} AND ${streetLike(sql`street`, pq.street)}
                ORDER BY (street = ${pq.street}) DESC, length(street), unit NULLS FIRST LIMIT 40
            `);
            if (hits.length && !hasPt) return hits[0];
            const near = hits
                .map(h => ({ h, d: distanceM(s.lat, s.lon, h.lat, h.lon) }))
                .filter(x => x.d <= SAME_ADDRESS_MAX_M)
                .sort((a, b) => a.d - b.d)[0];
            if (near) return near.h;
        }
    }
    if (!hasPt) return null;
    const n = await nearest(config, 'points', s.lat, s.lon, settings.radius_giveup, 1);
    return n.length ? { city: n[0].city, state: n[0].state, zip: n[0].zip, lat: n[0].lat!, lon: n[0].lon! } : null;
}

// Fill what the local results are missing (see fillBlanks). A failed lookup leaves a result as it was.
async function fillLocal(config: ConfigStateless, list: Suggestion[], settings: AddressSettings): Promise<Suggestion[]> {
    return await Promise.all(list.map(async (s) => {
        if (s.source === 'osm') return s;
        let from: Parts | null = null;
        if (s.kind !== 'point' && !(s.city && s.state && s.zipCode)) {
            try { from = await verifiedParts(config, s, settings); }
            catch (err) { console.warn('[dispatcher] address fill failed', err); }
        }
        return fillBlanks(s, from, settings.default_country);
    }));
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────

export default async function router(schema: Schema, config: ConfigStateless) {
    try {
        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS dispatcher_address_sources (
                id               TEXT PRIMARY KEY,
                kind             TEXT NOT NULL,
                name             TEXT NOT NULL,
                mode             TEXT NOT NULL DEFAULT 'file',
                url              TEXT,
                refresh_hours    INTEGER NOT NULL DEFAULT 24,
                mapping          JSONB NOT NULL DEFAULT '{}'::jsonb,
                status_keep      JSONB,
                data_as_of       TIMESTAMPTZ,
                last_refresh     TIMESTAMPTZ,
                record_count     INTEGER NOT NULL DEFAULT 0,
                dropped_count    INTEGER NOT NULL DEFAULT 0,
                unresolved_count INTEGER NOT NULL DEFAULT 0,
                last_error       TEXT,
                status           TEXT NOT NULL DEFAULT 'empty',
                created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS dispatcher_address_rows (
                id           BIGSERIAL PRIMARY KEY,
                source_id    TEXT NOT NULL REFERENCES dispatcher_address_sources(id) ON DELETE CASCADE,
                load_id      TEXT NOT NULL,
                active       BOOLEAN NOT NULL DEFAULT false,
                kind         TEXT NOT NULL,
                label        TEXT NOT NULL,
                search       TEXT NOT NULL,
                street       TEXT,
                house_number INTEGER,
                unit         TEXT,
                city         TEXT,
                state        TEXT,
                zip          TEXT,
                streets      JSONB,
                name         TEXT,
                aliases      TEXT,
                category     TEXT,
                address      TEXT,
                lat          DOUBLE PRECISION,
                lon          DOUBLE PRECISION,
                resolved     TEXT
            )
        `);
        await config.pg.execute(sql`CREATE INDEX IF NOT EXISTS dispatcher_address_rows_addr ON dispatcher_address_rows (kind, house_number, street) WHERE active`);
        await config.pg.execute(sql`CREATE INDEX IF NOT EXISTS dispatcher_address_rows_geo ON dispatcher_address_rows (kind, lat, lon) WHERE active`);
        await config.pg.execute(sql`CREATE INDEX IF NOT EXISTS dispatcher_address_rows_search ON dispatcher_address_rows (kind, search text_pattern_ops) WHERE active`);
        await config.pg.execute(sql`CREATE INDEX IF NOT EXISTS dispatcher_address_rows_load ON dispatcher_address_rows (load_id)`);
    } catch (err) {
        console.error('[dispatcher] address table bootstrap failed', err);
    }

    // ── Settings (one JSON blob under dispatcher_settings; admin-only to write) ──────────────

    await schema.get('/dispatcher/address/settings', {
        name: 'Get Local Addressing Settings',
        group: 'Dispatcher',
        description: 'The local address data switch and match distances',
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.is_auth(config, req);
            res.json({ settings: await readSettings(config) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.put('/dispatcher/address/settings', {
        name: 'Put Local Addressing Settings',
        group: 'Dispatcher',
        description: 'Change the local address data switch and match distances (CloudTAK system admin only)',
        body: Type.Object({ settings: Type.Any() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            const next = normAddressSettings({ ...(await readSettings(config)), ...(req.body.settings ?? {}) });
            const encoded = JSON.stringify(next);
            await config.pg.execute(sql`
                INSERT INTO dispatcher_settings (key, value) VALUES (${ADDRESS_SETTINGS_KEY}, ${encoded}::text::jsonb)
                ON CONFLICT (key) DO UPDATE SET value = ${encoded}::text::jsonb
            `);
            res.json({ settings: next });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // ── Sources ─────────────────────────────────────────────────────────────────────────────

    await schema.get('/dispatcher/address/sources', {
        name: 'List Address Sources',
        group: 'Dispatcher',
        description: 'Loaded local address data: kind, how loaded, counts, dates, status',
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.is_auth(config, req);
            res.json({ sources: await sources(config), refreshing: Array.from(refreshing) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/dispatcher/address/sources', {
        name: 'Create Address Source',
        group: 'Dispatcher',
        description: 'Add a local address data source (admin only). File sources are then filled with loads.',
        body: Type.Object({
            kind: Type.Union([Type.Literal('points'), Type.Literal('intersections'), Type.Literal('places')]),
            name: Type.String({ minLength: 1, maxLength: 120 }),
            mode: Type.Union([Type.Literal('file'), Type.Literal('url')]),
            url: Type.Optional(Type.String({ maxLength: 2000 })),
            refresh_hours: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 90 })),
            mapping: Type.Optional(Type.Record(Type.String(), Type.String())),
            status_keep: Type.Optional(Type.Array(Type.String())),
            data_as_of: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            const b = req.body;
            if (b.mode === 'url' && !b.url) throw new Err(400, null, 'A web address is required for a web source');
            if (b.url && !/^https?:\/\//i.test(b.url)) throw new Err(400, null, 'The web address must start with http:// or https://');
            const id = randomUUID();
            await config.pg.execute(sql`
                INSERT INTO dispatcher_address_sources (id, kind, name, mode, url, refresh_hours, mapping, status_keep, data_as_of)
                VALUES (${id}, ${b.kind}, ${b.name.trim()}, ${b.mode}, ${b.url ?? null}, ${b.refresh_hours ?? 24},
                        ${JSON.stringify(b.mapping ?? {})}::text::jsonb, ${b.status_keep ? JSON.stringify(b.status_keep) : null}::text::jsonb,
                        ${b.data_as_of ?? null}::timestamptz)
            `);
            res.json({ source: await sourceById(config, id) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/dispatcher/address/sources/:sourceid', {
        name: 'Update Address Source',
        group: 'Dispatcher',
        description: 'Change a source\'s name, web address, interval, mapping or as-of date (admin only)',
        params: Type.Object({ sourceid: Type.String() }),
        body: Type.Object({
            name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
            url: Type.Optional(Type.String({ maxLength: 2000 })),
            refresh_hours: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 90 })),
            mapping: Type.Optional(Type.Record(Type.String(), Type.String())),
            status_keep: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
            data_as_of: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            const cur = await sourceById(config, req.params.sourceid);
            const b = req.body;
            if (b.url !== undefined && b.url && !/^https?:\/\//i.test(b.url)) throw new Err(400, null, 'The web address must start with http:// or https://');
            await config.pg.execute(sql`
                UPDATE dispatcher_address_sources SET
                    name = ${b.name?.trim() ?? cur.name},
                    url = ${b.url !== undefined ? b.url : cur.url},
                    refresh_hours = ${b.refresh_hours ?? cur.refresh_hours},
                    mapping = ${JSON.stringify(b.mapping ?? cur.mapping)}::text::jsonb,
                    status_keep = ${b.status_keep !== undefined ? (b.status_keep ? JSON.stringify(b.status_keep) : null) : (cur.status_keep ? JSON.stringify(cur.status_keep) : null)}::text::jsonb,
                    data_as_of = ${b.data_as_of ?? cur.data_as_of}::timestamptz
                WHERE id = ${cur.id}
            `);
            res.json({ source: await sourceById(config, cur.id) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/dispatcher/address/sources/:sourceid', {
        name: 'Delete Address Source',
        group: 'Dispatcher',
        description: 'Remove a source and all its rows (admin only)',
        params: Type.Object({ sourceid: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            await sourceById(config, req.params.sourceid);
            await config.pg.execute(sql`DELETE FROM dispatcher_address_sources WHERE id = ${req.params.sourceid}`);
            res.json({ ok: true });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // ── File loads: start → rows (in batches) → commit. Rows arrive already mapped by the
    //    browser, which parsed the file and showed the admin the mapping. ─────────────────────

    await schema.post('/dispatcher/address/sources/:sourceid/loads', {
        name: 'Start Address Load',
        group: 'Dispatcher',
        description: 'Begin a staged load for a file source (admin only)',
        params: Type.Object({ sourceid: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            const src = await sourceById(config, req.params.sourceid);
            const loadId = randomUUID();
            await config.pg.execute(sql`UPDATE dispatcher_address_sources SET status = 'loading', last_error = NULL WHERE id = ${src.id}`);
            res.json({ load_id: loadId });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/dispatcher/address/sources/:sourceid/loads/:loadid/rows', {
        name: 'Add Address Load Rows',
        group: 'Dispatcher',
        description: 'Add a batch of mapped rows to a staged load (admin only, up to 2000 per call)',
        params: Type.Object({ sourceid: Type.String(), loadid: Type.String() }),
        body: Type.Object({ rows: Type.Array(Type.Any(), { maxItems: 2000 }) }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            const src = await sourceById(config, req.params.sourceid);
            const rows: DbRow[] = [];
            const reasons: Record<string, number> = {};
            for (const r of req.body.rows) {
                const { row, reason } = toDbRow(src.kind, (r ?? {}) as InRow);
                if (row) rows.push(row);
                else reasons[reason ?? 'unusable'] = (reasons[reason ?? 'unusable'] ?? 0) + 1;
            }
            if (rows.length) await insertRows(config, src.id, req.params.loadid, rows);
            res.json({ accepted: rows.length, dropped: req.body.rows.length - rows.length, reasons });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/dispatcher/address/sources/:sourceid/loads/:loadid/commit', {
        name: 'Commit Address Load',
        group: 'Dispatcher',
        description: 'Make the staged load live and drop the previous rows (admin only)',
        params: Type.Object({ sourceid: Type.String(), loadid: Type.String() }),
        body: Type.Object({
            data_as_of: Type.Optional(Type.String()),
            dropped: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            const src = await sourceById(config, req.params.sourceid);
            try {
                const out = await commitLoad(config, src, req.params.loadid, req.body.data_as_of ?? null, req.body.dropped ?? 0);
                const unresolved = src.kind === 'places' ? await query<{ label: string; address: string | null }>(config, sql`
                    SELECT label, address FROM dispatcher_address_rows
                    WHERE source_id = ${src.id} AND active AND kind = 'places' AND lat IS NULL
                    ORDER BY label LIMIT 50
                `) : [];
                res.json({ source: out, unresolved });
            } catch (err) {
                await failLoad(config, src.id, req.params.loadid, err instanceof Error ? err.message : String(err));
                throw err;
            }
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/dispatcher/address/sources/:sourceid/loads/:loadid/abort', {
        name: 'Abort Address Load',
        group: 'Dispatcher',
        description: 'Throw away a staged load (admin only)',
        params: Type.Object({ sourceid: Type.String(), loadid: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            await failLoad(config, req.params.sourceid, req.params.loadid, 'Upload cancelled');
            res.json({ ok: true });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // ── Web sources ─────────────────────────────────────────────────────────────────────────

    await schema.post('/dispatcher/address/probe', {
        name: 'Probe Address URL',
        group: 'Dispatcher',
        description: 'Read a web address once: columns, a few sample rows, count and last edit (admin only)',
        body: Type.Object({ url: Type.String({ maxLength: 2000 }), kind: Type.Optional(Type.String()) }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            if (!/^https?:\/\//i.test(req.body.url)) throw new Err(400, null, 'The web address must start with http:// or https://');
            const probe = await probeUrl(req.body.url);
            const kind = SOURCE_KINDS.includes(req.body.kind as SourceKind) ? req.body.kind as SourceKind : 'points';
            const mapping = guessMapping(kind, probe.columns);
            if (probe.geometry || probe.sample.some(s => s.__lat != null)) { mapping.lat = '__lat'; mapping.lon = '__lon'; }
            res.json({ probe, mapping });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/dispatcher/address/sources/:sourceid/refresh', {
        name: 'Refresh Address Source',
        group: 'Dispatcher',
        description: 'Pull a web source now (admin only)',
        params: Type.Object({ sourceid: Type.String() }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await requireAdmin(config, req);
            const src = await sourceById(config, req.params.sourceid);
            if (src.mode !== 'url') throw new Err(400, null, 'Only web sources can be refreshed; upload the file again instead');
            res.json({ source: await pullSource(config, src) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // ── Lookups used by the incident form ───────────────────────────────────────────────────

    await schema.get('/dispatcher/address/suggest', {
        name: 'Address Suggest',
        group: 'Dispatcher',
        description: 'Suggestions for typed text: local places, verified addresses and intersections first, public geocoder after',
        query: Type.Object({
            q: Type.String(),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 15 })),
            local_only: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.is_auth(config, req);
            const settings = await readSettings(config);
            const q = String(req.query.q ?? '').trim();
            const lim = req.query.limit ?? settings.result_limit;
            let local: Suggestion[] = [];
            if (settings.enabled && q.length >= settings.min_chars) {
                maybeRefreshDue(config);
                try { local = await fillLocal(config, (await localSuggest(config, q, { ...settings, result_limit: lim })).slice(0, lim), settings); }
                catch (err) { console.warn('[dispatcher] local suggest failed', err); }
            }
            let osm: Suggestion[] = [];
            if (local.length < lim && q.length >= 4 && req.query.local_only !== '1') {
                osm = await osmSuggest(q, lim - local.length, settings);
            }
            const seen = new Set(local.map(s => normText(s.label)));
            const merged = [...local, ...osm.filter(s => !seen.has(normText(s.label)))].slice(0, lim);
            res.json({ suggestions: merged, settings: { enabled: settings.enabled, min_chars: settings.min_chars } });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/dispatcher/address/reverse', {
        name: 'Address Reverse',
        group: 'Dispatcher',
        description: 'The address for a map point: nearest verified point or intersection within the match distances, public geocoder beyond',
        query: Type.Object({
            lat: Type.Number(),
            lon: Type.Number(),
            local_only: Type.Optional(Type.String()),
        }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.is_auth(config, req);
            const settings = await readSettings(config);
            let best: Suggestion | null = null;
            let alternates: Suggestion[] = [];
            if (settings.enabled) {
                maybeRefreshDue(config);
                try {
                    ({ best, alternates } = await localReverse(config, req.query.lat, req.query.lon, settings));
                    if (best) [best] = await fillLocal(config, [best], settings);
                    alternates = await fillLocal(config, alternates, settings);
                }
                catch (err) { console.warn('[dispatcher] local reverse failed', err); }
            }
            if (!best && req.query.local_only !== '1') {
                best = await osmReverse(req.query.lat, req.query.lon);
                if (best) best.distance = distanceM(req.query.lat, req.query.lon, best.lat, best.lon);
            }
            res.json({ suggestion: best, alternates, settings: { enabled: settings.enabled } });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
