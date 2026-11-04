// Client for the local address data routes (server/plugin-addressing.ts): the lookups the
// incident form uses, and the admin calls the Manage panel uses to load and refresh sources.
import { std } from '../../../src/std.ts';
import type { SourceKind } from './address-parse.ts';

export type { SourceKind };

// One suggestion, from any source. `source` tells the form which badge to show.
export interface AddressSuggestion {
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

export interface AddressSettings {
    enabled: boolean;
    radius_point: number;
    radius_intersection: number;
    radius_place: number;
    radius_giveup: number;
    min_chars: number;
    result_limit: number;
    // Keep typed OpenStreetMap results inside a circle (centre + radius). Off = worldwide.
    osm_limit: boolean;
    osm_lat: number | null;
    osm_lon: number | null;
    osm_radius_km: number;
    // Local data carries no country: this fills it on every local result.
    default_country: string;
}

export const ADDRESS_SETTINGS_DEFAULT: AddressSettings = {
    enabled: false, radius_point: 60, radius_intersection: 40, radius_place: 30, radius_giveup: 150,
    min_chars: 2, result_limit: 5,
    osm_limit: false, osm_lat: null, osm_lon: null, osm_radius_km: 50,
    default_country: '',
};

export interface AddressSource {
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
    status: 'empty' | 'loading' | 'ok' | 'failed' | string;
    created_at: string;
}

export interface UrlProbe {
    type: 'esri' | 'geojson' | 'csv';
    columns: string[];
    sample: Record<string, unknown>[];
    count: number | null;
    lastEdit: string | null;
    geometry: boolean;
}

export interface SuggestResult {
    suggestions: AddressSuggestion[];
    settings: { enabled: boolean; min_chars: number };
}

export interface ReverseResult {
    suggestion: AddressSuggestion | null;
    alternates: AddressSuggestion[];
    settings: { enabled: boolean };
}

// ── Lookups ─────────────────────────────────────────────────────────────────────────────────

export async function suggestAddress(q: string, opts: { limit?: number; localOnly?: boolean } = {}): Promise<SuggestResult> {
    const qs = new URLSearchParams({ q });
    if (opts.limit) qs.set('limit', String(opts.limit));
    if (opts.localOnly) qs.set('local_only', '1');
    const r = await std(`/api/dispatcher/address/suggest?${qs.toString()}`, { method: 'GET' }) as Partial<SuggestResult>;
    return {
        suggestions: r.suggestions ?? [],
        settings: r.settings ?? { enabled: false, min_chars: 4 },
    };
}

export async function reverseAddress(lat: number, lon: number, opts: { localOnly?: boolean } = {}): Promise<ReverseResult> {
    const qs = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    if (opts.localOnly) qs.set('local_only', '1');
    const r = await std(`/api/dispatcher/address/reverse?${qs.toString()}`, { method: 'GET' }) as Partial<ReverseResult>;
    return {
        suggestion: r.suggestion ?? null,
        alternates: r.alternates ?? [],
        settings: r.settings ?? { enabled: false },
    };
}

// ── Settings ────────────────────────────────────────────────────────────────────────────────

export async function getAddressSettings(): Promise<AddressSettings> {
    const r = await std('/api/dispatcher/address/settings', { method: 'GET' }) as { settings?: AddressSettings };
    return { ...ADDRESS_SETTINGS_DEFAULT, ...(r.settings ?? {}) };
}

export async function putAddressSettings(patch: Partial<AddressSettings>): Promise<AddressSettings> {
    const r = await std('/api/dispatcher/address/settings', { method: 'PUT', body: { settings: patch } }) as { settings?: AddressSettings };
    return { ...ADDRESS_SETTINGS_DEFAULT, ...(r.settings ?? {}) };
}

// ── Sources ─────────────────────────────────────────────────────────────────────────────────

export async function listAddressSources(): Promise<{ sources: AddressSource[]; refreshing: string[] }> {
    const r = await std('/api/dispatcher/address/sources', { method: 'GET' }) as { sources?: AddressSource[]; refreshing?: string[] };
    return { sources: r.sources ?? [], refreshing: r.refreshing ?? [] };
}

export interface NewSource {
    kind: SourceKind;
    name: string;
    mode: 'file' | 'url';
    url?: string;
    refresh_hours?: number;
    mapping?: Record<string, string>;
    status_keep?: string[];
    data_as_of?: string;
}

export async function createAddressSource(body: NewSource): Promise<AddressSource> {
    const r = await std('/api/dispatcher/address/sources', { method: 'POST', body }) as { source: AddressSource };
    return r.source;
}

// status_keep: a list replaces the status filter, null clears it, leaving it out keeps it.
export async function patchAddressSource(id: string, body: Partial<Omit<NewSource, 'kind' | 'mode' | 'status_keep'>> & { status_keep?: string[] | null }): Promise<AddressSource> {
    const r = await std(`/api/dispatcher/address/sources/${encodeURIComponent(id)}`, { method: 'PATCH', body }) as { source: AddressSource };
    return r.source;
}

export async function deleteAddressSource(id: string): Promise<void> {
    await std(`/api/dispatcher/address/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function refreshAddressSource(id: string): Promise<AddressSource> {
    const r = await std(`/api/dispatcher/address/sources/${encodeURIComponent(id)}/refresh`, { method: 'POST' }) as { source: AddressSource };
    return r.source;
}

export async function probeAddressUrl(url: string, kind: SourceKind): Promise<{ probe: UrlProbe; mapping: Record<string, string> }> {
    return await std('/api/dispatcher/address/probe', { method: 'POST', body: { url, kind } }) as { probe: UrlProbe; mapping: Record<string, string> };
}

// ── File loads: start → rows in batches → commit ────────────────────────────────────────────

export const LOAD_BATCH = 2000;

export async function startAddressLoad(sourceId: string): Promise<string> {
    const r = await std(`/api/dispatcher/address/sources/${encodeURIComponent(sourceId)}/loads`, { method: 'POST' }) as { load_id: string };
    return r.load_id;
}

export async function pushAddressRows(sourceId: string, loadId: string, rows: Record<string, unknown>[]): Promise<{ accepted: number; dropped: number; reasons: Record<string, number> }> {
    return await std(`/api/dispatcher/address/sources/${encodeURIComponent(sourceId)}/loads/${encodeURIComponent(loadId)}/rows`, {
        method: 'POST', body: { rows },
    }) as { accepted: number; dropped: number; reasons: Record<string, number> };
}

export async function commitAddressLoad(sourceId: string, loadId: string, body: { data_as_of?: string; dropped?: number }): Promise<{ source: AddressSource; unresolved: { label: string; address: string | null }[] }> {
    return await std(`/api/dispatcher/address/sources/${encodeURIComponent(sourceId)}/loads/${encodeURIComponent(loadId)}/commit`, {
        method: 'POST', body,
    }) as { source: AddressSource; unresolved: { label: string; address: string | null }[] };
}

export async function abortAddressLoad(sourceId: string, loadId: string): Promise<void> {
    await std(`/api/dispatcher/address/sources/${encodeURIComponent(sourceId)}/loads/${encodeURIComponent(loadId)}/abort`, { method: 'POST' });
}

// ── Display helpers ─────────────────────────────────────────────────────────────────────────

export function badgeFor(s: AddressSuggestion): { text: string; cls: string } {
    if (s.source === 'place') return { text: 'Place', cls: 'bg-purple-lt' };
    if (s.source === 'local') return { text: 'Verified', cls: 'bg-green-lt' };
    return { text: 'OpenStreetMap', cls: 'bg-secondary-lt' };
}

export function distanceText(m: number | undefined): string {
    if (m == null || !Number.isFinite(m)) return '';
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
