<template>
    <div>
        <div class='small text-muted fw-semibold text-uppercase mb-1 d-flex align-items-center gap-2'>
            Local Address Data
            <span
                class='badge bg-secondary text-white fw-normal'
                title='Only a CloudTAK system admin can change this'
            >CloudTAK admin only</span>
        </div>
        <div class='card border'>
            <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                <!-- Switch + distances -->
                <div class='form-check form-switch mb-0'>
                    <input
                        id='addrEnabled'
                        v-model='settings.enabled'
                        class='form-check-input'
                        type='checkbox'
                        data-test='addr-enabled'
                        :disabled='!isAdmin || savingSettings'
                        @change='saveSettings({ enabled: settings.enabled })'
                    >
                    <label
                        class='form-check-label'
                        for='addrEnabled'
                    >Use local address data first (public OpenStreetMap stays as the fallback)</label>
                </div>
                <div class='text-muted small'>
                    Verified address points, street intersections and common place names loaded here are
                    searched before the public geocoder when a dispatcher types an address or clicks the map.
                    Loaded data is shared by every dispatcher on this CloudTAK.
                </div>
                <label class='text-muted mb-0'>Default country
                    <input
                        v-model.trim='settings.default_country'
                        type='text'
                        maxlength='60'
                        class='form-control form-control-sm border'
                        style='max-width:16rem'
                        placeholder='e.g. United States'
                        data-test='addr-country'
                        :disabled='!isAdmin || savingSettings'
                        @change='saveSettings({ default_country: settings.default_country })'
                    >
                </label>
                <div class='text-muted small'>
                    Local data has no country column, so this goes in the Country box of every local result.
                    A place or intersection with no city, state or ZIP of its own takes them from the verified
                    address it sits at.
                </div>
                <details class='small'>
                    <summary class='text-muted'>
                        Match distances and search behaviour
                    </summary>
                    <div class='row g-2 mt-1'>
                        <div
                            v-for='f in RADII'
                            :key='f.key'
                            class='col-6'
                        >
                            <label class='text-muted mb-0 w-100'>{{ f.label }}
                                <div class='input-group input-group-sm'>
                                    <input
                                        v-model.number='settings[f.key]'
                                        type='number'
                                        min='5'
                                        class='form-control form-control-sm border'
                                        :disabled='!isAdmin || savingSettings'
                                    >
                                    <span class='input-group-text'>{{ f.unit }}</span>
                                </div>
                            </label>
                        </div>
                        <div class='col-12'>
                            <button
                                class='btn btn-sm btn-outline-secondary'
                                type='button'
                                :disabled='!isAdmin || savingSettings'
                                @click='saveSettings(settings)'
                            >
                                <span
                                    v-if='savingSettings'
                                    class='spinner-border spinner-border-sm me-1'
                                />{{ settingsSaved ? 'Saved ✓' : 'Save distances' }}
                            </button>
                        </div>
                    </div>
                </details>
                <!-- Public (OpenStreetMap) search area -->
                <div class='form-check form-switch mb-0'>
                    <input
                        id='addrOsmLimit'
                        v-model='settings.osm_limit'
                        class='form-check-input'
                        type='checkbox'
                        data-test='addr-osm-limit'
                        :disabled='!isAdmin || savingSettings || !osmCentreSet'
                        @change='saveSettings(osmPatch())'
                    >
                    <label
                        class='form-check-label'
                        for='addrOsmLimit'
                    >Only show OpenStreetMap results within my coverage area</label>
                </div>
                <div class='row g-2 align-items-end'>
                    <div class='col-6'>
                        <label class='text-muted mb-0 w-100'>Centre latitude
                            <input
                                v-model.number='settings.osm_lat'
                                type='number'
                                step='any'
                                class='form-control form-control-sm border'
                                data-test='addr-osm-lat'
                                :disabled='!isAdmin || savingSettings'
                            >
                        </label>
                    </div>
                    <div class='col-6'>
                        <label class='text-muted mb-0 w-100'>Centre longitude
                            <input
                                v-model.number='settings.osm_lon'
                                type='number'
                                step='any'
                                class='form-control form-control-sm border'
                                data-test='addr-osm-lon'
                                :disabled='!isAdmin || savingSettings'
                            >
                        </label>
                    </div>
                    <div class='col-6'>
                        <label class='text-muted mb-0 w-100'>Radius
                            <div class='input-group input-group-sm'>
                                <input
                                    v-model.number='settings.osm_radius_km'
                                    type='number'
                                    min='1'
                                    class='form-control form-control-sm border'
                                    :disabled='!isAdmin || savingSettings'
                                >
                                <span class='input-group-text'>km</span>
                            </div>
                        </label>
                    </div>
                    <div class='col-12 d-flex flex-wrap gap-2'>
                        <button
                            class='btn btn-sm btn-outline-secondary'
                            type='button'
                            title='Fill the centre from the middle of the map as it is now'
                            :disabled='!isAdmin || savingSettings'
                            @click='useMapCentre'
                        >
                            Use map centre
                        </button>
                        <button
                            class='btn btn-sm btn-outline-secondary'
                            type='button'
                            data-test='addr-osm-save'
                            :disabled='!isAdmin || savingSettings || !osmCentreSet'
                            @click='saveSettings(osmPatch())'
                        >
                            Save area
                        </button>
                    </div>
                </div>
                <div class='text-muted small'>
                    Typed address searches that fall back to OpenStreetMap only return places inside this circle
                    ({{ osmMiles }} mi). Works with local address data on or off. A map click is not affected.
                    Set a centre to turn it on.
                </div>
                <div
                    v-if='settingsError'
                    class='text-danger small'
                >
                    {{ settingsError }}
                </div>

                <hr class='my-1'>

                <!-- Sources -->
                <div class='d-flex align-items-center justify-content-between'>
                    <span class='fw-semibold'>Sources</span>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        type='button'
                        data-test='addr-add'
                        :disabled='!isAdmin'
                        @click='openAdd()'
                    >
                        Add source
                    </button>
                </div>
                <div
                    v-if='!sources.length'
                    class='text-muted'
                >
                    No local address data loaded yet.
                </div>
                <div
                    v-for='s in sources'
                    :key='s.id'
                    class='border rounded px-2 py-1'
                    data-test='addr-source'
                >
                    <div class='d-flex align-items-start justify-content-between gap-2'>
                        <span class='fw-semibold text-break'>{{ s.name }}</span>
                        <span
                            class='badge flex-shrink-0'
                            :class='statusClass(s)'
                            :title='statusText(s).title'
                        >{{ statusText(s).text }}</span>
                    </div>
                    <div>
                        {{ KIND_LABEL[s.kind] }} · {{ s.record_count.toLocaleString() }} records
                        <span
                            v-if='s.dropped_count'
                            class='text-muted'
                        >· {{ s.dropped_count }} dropped</span>
                        <span
                            v-if='s.unresolved_count'
                            class='text-muted'
                        >· {{ s.unresolved_count }} unresolved</span>
                    </div>
                    <div class='text-muted'>
                        {{ s.mode === 'url' ? `Web, every ${s.refresh_hours} h` : 'File' }}
                        · data as of {{ day(s.data_as_of) }} · loaded {{ when(s.last_refresh) }}
                    </div>
                    <div
                        v-if='s.last_error'
                        class='text-danger text-break'
                        :title='s.last_error'
                    >
                        {{ s.last_error.slice(0, 80) }}
                    </div>
                    <div class='d-flex gap-3'>
                        <button
                            v-if='s.mode === "url"'
                            class='btn btn-sm btn-link p-0'
                            type='button'
                            :disabled='!isAdmin || refreshing.includes(s.id)'
                            @click='refreshNow(s)'
                        >
                            Refresh now
                        </button>
                        <button
                            v-else
                            class='btn btn-sm btn-link p-0'
                            type='button'
                            :disabled='!isAdmin'
                            @click='openAdd(s)'
                        >
                            Replace file
                        </button>
                        <button
                            class='btn btn-sm btn-link p-0 text-danger'
                            type='button'
                            :disabled='!isAdmin'
                            @click='remove(s)'
                        >
                            Remove
                        </button>
                    </div>
                </div>
                <div
                    v-if='listError'
                    class='text-danger small'
                >
                    {{ listError }}
                </div>

                <!-- Add / replace -->
                <div
                    v-if='add.open'
                    class='border rounded p-2 d-flex flex-column gap-2'
                    data-test='addr-add-form'
                >
                    <div class='fw-semibold'>
                        {{ add.replace ? `Replace file for "${add.replace.name}"` : 'Add source' }}
                    </div>
                    <div>
                        <div class='text-muted'>
                            What is each row in your file? Pick the one that looks like it.
                        </div>
                        <label
                            v-for='k in KINDS'
                            :key='k.kind'
                            class='d-flex align-items-start gap-2 border rounded px-2 py-1 mt-1 mb-0'
                            :class='{ "border-primary": add.kind === k.kind }'
                        >
                            <input
                                v-model='add.kind'
                                type='radio'
                                class='form-check-input flex-shrink-0'
                                data-test='addr-kind'
                                :value='k.kind'
                                :disabled='!!add.replace || add.busy'
                                @change='onKindChange'
                            >
                            <span class='text-break'>
                                <span class='fw-semibold'>{{ k.title }}</span> {{ k.what }}
                                <span class='d-block font-monospace text-muted'>{{ k.looks }}</span>
                            </span>
                        </label>
                    </div>
                    <div class='addr-grid'>
                        <div>
                            <label class='text-muted mb-0 w-100'>Name
                                <input
                                    v-model='add.name'
                                    type='text'
                                    class='form-control form-control-sm border'
                                    placeholder='e.g. County address points'
                                    :disabled='!!add.replace || add.busy'
                                >
                            </label>
                        </div>
                        <div>
                            <label class='text-muted mb-0 w-100'>Load from
                                <select
                                    v-model='add.mode'
                                    class='form-select form-select-sm border'
                                    :disabled='!!add.replace || add.busy'
                                >
                                    <option value='file'>A file (CSV or GeoJSON)</option>
                                    <option value='url'>A web address, pulled on a schedule</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <div
                        v-if='add.detected'
                        class='text-success'
                        data-test='addr-detected'
                    >
                        {{ add.detected }}
                    </div>

                    <!-- File -->
                    <div
                        v-if='add.mode === "file"'
                        class='d-flex flex-column gap-2'
                    >
                        <input
                            type='file'
                            accept='.csv,.geojson,.json,text/csv,application/json,application/geo+json'
                            class='form-control form-control-sm border'
                            data-test='addr-file'
                            :disabled='add.busy'
                            @change='onFile'
                        >
                        <div class='d-flex align-items-center flex-wrap gap-2'>
                            <button
                                class='btn btn-sm btn-outline-secondary'
                                type='button'
                                data-test='addr-example'
                                @click='downloadExample'
                            >
                                Download example CSV
                            </button>
                            <span class='text-muted'>
                                {{ EXAMPLE_HINT[add.kind] }}
                            </span>
                        </div>
                        <div
                            v-if='add.file'
                            class='text-muted'
                        >
                            {{ add.file.rows.length.toLocaleString() }} rows, {{ add.file.columns.length }} columns
                            ({{ add.file.type === 'geojson' ? 'GeoJSON' : 'CSV' }}{{ add.file.hasGeometry ? ', point geometry' : '' }})
                        </div>
                        <label class='text-muted mb-0'>Data as of
                            <input
                                v-model='add.asOf'
                                type='date'
                                class='form-control form-control-sm border'
                                style='max-width:12rem'
                                :disabled='add.busy'
                            >
                        </label>
                    </div>

                    <!-- URL -->
                    <div
                        v-else
                        class='d-flex flex-column gap-2'
                    >
                        <div class='input-group input-group-sm'>
                            <input
                                v-model='add.url'
                                type='url'
                                class='form-control form-control-sm border'
                                placeholder='https://…/FeatureServer/0  or a GeoJSON / CSV file address'
                                :disabled='add.busy'
                            >
                            <button
                                class='btn btn-outline-secondary'
                                type='button'
                                :disabled='!add.url.trim() || add.busy'
                                @click='probe'
                            >
                                <span
                                    v-if='add.probing'
                                    class='spinner-border spinner-border-sm me-1'
                                />Read columns
                            </button>
                        </div>
                        <div
                            v-if='add.probe'
                            class='text-muted'
                        >
                            {{ add.probe.type === 'esri' ? 'ArcGIS Feature Service' : add.probe.type.toUpperCase() }}
                            <span v-if='add.probe.count != null'>· {{ add.probe.count.toLocaleString() }} records</span>
                            <span v-if='add.probe.lastEdit'>· last edited {{ day(add.probe.lastEdit) }}</span>
                        </div>
                        <label class='text-muted mb-0'>Refresh every
                            <div
                                class='input-group input-group-sm'
                                style='max-width:12rem'
                            >
                                <input
                                    v-model.number='add.refreshHours'
                                    type='number'
                                    min='1'
                                    max='2160'
                                    class='form-control form-control-sm border'
                                    :disabled='add.busy'
                                >
                                <span class='input-group-text'>hours</span>
                            </div>
                        </label>
                    </div>

                    <!-- Mapping -->
                    <div
                        v-if='add.columns.length'
                        class='d-flex flex-column gap-1'
                    >
                        <div class='fw-semibold'>
                            Field mapping
                        </div>
                        <div class='addr-grid'>
                            <div
                                v-for='f in KIND_FIELDS[add.kind]'
                                :key='f.key'
                            >
                                <div class='text-muted'>
                                    {{ f.label }}<span
                                        v-if='f.required'
                                        class='text-danger'
                                    > *</span>
                                </div>
                                <ColumnPick
                                    v-model='add.mapping[f.key]'
                                    :options='columnOptions(f.key)'
                                    :disabled='add.busy'
                                />
                                <div
                                    v-if='f.hint'
                                    class='text-muted'
                                    style='font-size:11px'
                                >
                                    {{ f.hint }}
                                </div>
                            </div>
                        </div>
                        <div
                            v-if='add.kind === "points" && add.mapping.status && statusValues.length'
                            class='mt-1'
                        >
                            <div class='text-muted'>
                                Rows to load, by the value in the file's "{{ add.mapping.status }}" column.
                                Untick a value to leave those rows out.
                            </div>
                            <div class='d-flex flex-wrap gap-3'>
                                <label
                                    v-for='v in statusValues'
                                    :key='v.value'
                                    class='mb-0'
                                >
                                    <input
                                        v-model='add.statusKeep'
                                        type='checkbox'
                                        data-test='addr-status'
                                        :value='v.value'
                                        :disabled='add.busy'
                                    > {{ v.value }} ({{ v.count.toLocaleString() }} rows)
                                </label>
                            </div>
                            <div
                                v-if='!add.statusKeep.length'
                                class='text-warning'
                            >
                                Tick at least one value, or there is nothing to load.
                            </div>
                            <div
                                v-else-if='statusLeftOut'
                                class='text-muted'
                            >
                                {{ statusLeftOut.toLocaleString() }} rows will be left out.
                            </div>
                        </div>
                        <div
                            v-if='missing.length'
                            class='text-warning'
                        >
                            Still needed: {{ missing.join(', ') }}
                        </div>
                        <div
                            v-if='preview.length'
                            class='text-muted'
                        >
                            <div>Preview (as the plugin will read it):</div>
                            <div
                                v-for='(p, i) in preview'
                                :key='i'
                                class='font-monospace'
                                style='font-size:11px'
                            >
                                {{ p }}
                            </div>
                        </div>
                    </div>

                    <div
                        v-if='add.progress'
                        class='text-muted'
                    >
                        {{ add.progress }}
                    </div>
                    <div
                        v-if='add.result'
                        class='text-success'
                    >
                        {{ add.result }}
                    </div>
                    <div
                        v-if='add.unresolved.length'
                        class='text-warning'
                    >
                        Places with no location (fix the address and upload again):
                        <div
                            v-for='u in add.unresolved'
                            :key='u.label'
                            class='font-monospace'
                            style='font-size:11px'
                        >
                            {{ u.label }} — {{ u.address || 'no address' }}
                        </div>
                    </div>
                    <div
                        v-if='add.error'
                        class='text-danger'
                    >
                        {{ add.error }}
                    </div>
                    <div class='d-flex gap-2'>
                        <button
                            class='btn btn-sm btn-primary'
                            type='button'
                            data-test='addr-load'
                            :disabled='!canLoad || add.busy'
                            @click='load'
                        >
                            <span
                                v-if='add.busy'
                                class='spinner-border spinner-border-sm me-1'
                            />{{ add.mode === 'file' ? 'Upload' : 'Save and pull now' }}
                        </button>
                        <button
                            class='btn btn-sm btn-outline-secondary'
                            type='button'
                            :disabled='add.busy'
                            @click='add.open = false'
                        >
                            {{ add.result ? 'Close' : 'Cancel' }}
                        </button>
                    </div>
                </div>

                <hr class='my-1'>

                <!-- Try it -->
                <div class='fw-semibold'>
                    Try it
                </div>
                <div class='text-muted'>
                    See exactly what a dispatcher would get, with the local data only (no public fallback).
                </div>
                <div class='row g-2'>
                    <div class='col-12'>
                        <div class='input-group input-group-sm'>
                            <input
                                v-model='tryText'
                                type='text'
                                class='form-control form-control-sm border'
                                placeholder='Type an address, intersection or place…'
                                data-test='addr-try-text'
                                @input='onTryInput'
                                @keyup.enter='tryTyped'
                            >
                            <button
                                class='btn btn-outline-secondary'
                                type='button'
                                @click='tryTyped'
                            >
                                Search
                            </button>
                        </div>
                        <div
                            v-for='(s, i) in tryResults'
                            :key='i'
                            class='d-flex align-items-center gap-2 py-1 border-bottom'
                        >
                            <span
                                class='badge flex-shrink-0'
                                :class='badgeFor(s).cls'
                            >{{ badgeFor(s).text }}</span>
                            <span>{{ s.label }}</span>
                            <span
                                v-if='s.category'
                                class='text-muted'
                            >· {{ s.category }}</span>
                            <span
                                v-if='s.kind === "place" && s.streetName'
                                class='text-muted'
                            >· {{ s.streetName }}</span>
                            <span
                                v-if='s.units'
                                class='text-muted'
                            >· {{ s.units.length }} units</span>
                        </div>
                        <div
                            v-if='tryTextDone && !tryResults.length'
                            class='text-muted'
                        >
                            No local match.
                        </div>
                    </div>
                    <div class='col-12'>
                        <div class='input-group input-group-sm'>
                            <input
                                v-model='tryLat'
                                type='text'
                                class='form-control form-control-sm border'
                                placeholder='lat'
                            >
                            <input
                                v-model='tryLon'
                                type='text'
                                class='form-control form-control-sm border'
                                placeholder='lon'
                            >
                            <button
                                class='btn btn-outline-secondary'
                                type='button'
                                :disabled='!tryLat || !tryLon'
                                @click='tryPoint'
                            >
                                Reverse
                            </button>
                        </div>
                        <div
                            v-if='tryReverse'
                            class='mt-1'
                        >
                            <div v-if='tryReverse.suggestion'>
                                <span
                                    class='badge me-1'
                                    :class='badgeFor(tryReverse.suggestion).cls'
                                >{{ badgeFor(tryReverse.suggestion).text }}</span>
                                {{ tryReverse.suggestion.label }}
                                <span class='text-muted'>· {{ distanceText(tryReverse.suggestion.distance) }} away</span>
                            </div>
                            <div
                                v-else
                                class='text-muted'
                            >
                                Nothing within the give-up distance.
                            </div>
                            <div
                                v-for='(a, i) in tryReverse.alternates'
                                :key='i'
                                class='text-muted'
                            >
                                alt: {{ a.label }} · {{ distanceText(a.distance) }}
                            </div>
                        </div>
                    </div>
                </div>
                <div
                    v-if='tryError'
                    class='text-danger small'
                >
                    {{ tryError }}
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import {
    getAddressSettings, putAddressSettings, listAddressSources, createAddressSource, patchAddressSource,
    deleteAddressSource, refreshAddressSource, probeAddressUrl, startAddressLoad, pushAddressRows,
    commitAddressLoad, abortAddressLoad, suggestAddress, reverseAddress, badgeFor, distanceText,
    ADDRESS_SETTINGS_DEFAULT, LOAD_BATCH,
} from '../lib/addressing.ts';
import type { AddressSettings, AddressSource, AddressSuggestion, ReverseResult, UrlProbe } from '../lib/addressing.ts';
import { KIND_FIELDS, parseFile, initialMapping, guessMapping, guessKind, applyMapping, missingFields, valueCounts, localDay, exampleCsv, exampleCsvName } from '../lib/address-parse.ts';
import ColumnPick from './ColumnPick.vue';
import { downloadFile } from '../lib/report.ts';
import type { SourceKind, ParsedFile } from '../lib/address-parse.ts';
import { useMapStore } from '../../../src/stores/map.ts';

const props = defineProps<{ isAdmin: boolean }>();
const isAdmin = computed(() => props.isAdmin);

// The three kinds as an admin would recognise them in their own file: what one row is, and a
// made-up row that looks like it.
const KINDS: { kind: SourceKind; title: string; what: string; looks: string }[] = [
    { kind: 'points', title: 'Address points:', what: 'each row is one address, with a house number and a street.', looks: '123 | MAIN ST | APT 4 | SPRINGFIELD' },
    { kind: 'intersections', title: 'Street intersections:', what: 'each row is two or more streets that cross.', looks: 'MAIN ST | 2ND AVE' },
    { kind: 'places', title: 'Common places:', what: 'each row is a named location.', looks: 'Central High School | 400 Oak St' },
];
const KIND_LABEL: Record<SourceKind, string> = { points: 'Address points', intersections: 'Intersections', places: 'Places' };
const RADII: { key: 'radius_point' | 'radius_intersection' | 'radius_place' | 'radius_giveup' | 'min_chars' | 'result_limit'; label: string; unit: string }[] = [
    { key: 'radius_point',        label: 'Address point within', unit: 'm' },
    { key: 'radius_intersection', label: 'Intersection within',  unit: 'm' },
    { key: 'radius_place',        label: 'Place within',         unit: 'm' },
    { key: 'radius_giveup',       label: 'Give up beyond',       unit: 'm' },
    { key: 'min_chars',           label: 'Search from',          unit: 'chars' },
    { key: 'result_limit',        label: 'Results shown',        unit: '' },
];

// ── Settings ────────────────────────────────────────────────────────────────────────────────
const settings       = reactive<AddressSettings>({ ...ADDRESS_SETTINGS_DEFAULT });
const savingSettings = ref(false);
const settingsSaved  = ref(false);
const settingsError  = ref('');

// ── Public search area ──────────────────────────────────────────────────────────────────────
const mapStore = useMapStore();
const isCoord = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
const osmCentreSet = computed(() => isCoord(settings.osm_lat, 90) && isCoord(settings.osm_lon, 180));
const osmMiles = computed(() => Math.round((Number(settings.osm_radius_km) || 0) * 0.621371));

function osmPatch(): Partial<AddressSettings> {
    return { osm_limit: settings.osm_limit, osm_lat: settings.osm_lat, osm_lon: settings.osm_lon, osm_radius_km: settings.osm_radius_km };
}

function useMapCentre() {
    const c = mapStore.map?.getCenter();
    if (!c) { settingsError.value = 'The map is not available to read its centre'; return; }
    settings.osm_lat = Number(c.lat.toFixed(5));
    settings.osm_lon = Number(c.lng.toFixed(5));
}

async function saveSettings(patch: Partial<AddressSettings>) {
    savingSettings.value = true;
    settingsError.value = '';
    try {
        Object.assign(settings, await putAddressSettings({ ...patch }));
        settingsSaved.value = true;
        setTimeout(() => { settingsSaved.value = false; }, 1500);
    } catch (e) {
        settingsError.value = e instanceof Error ? e.message : String(e);
        try { Object.assign(settings, await getAddressSettings()); } catch { /* keep */ }
    } finally {
        savingSettings.value = false;
    }
}

// ── Sources ─────────────────────────────────────────────────────────────────────────────────
const sources    = ref<AddressSource[]>([]);
const refreshing = ref<string[]>([]);
const listError  = ref('');
let poll: ReturnType<typeof setInterval> | null = null;

async function reload() {
    try {
        const r = await listAddressSources();
        sources.value = r.sources;
        refreshing.value = r.refreshing;
        listError.value = '';
        const busy = r.refreshing.length > 0 || r.sources.some(s => s.status === 'loading');
        if (busy && !poll) poll = setInterval(reload, 5000);
        if (!busy && poll) { clearInterval(poll); poll = null; }
    } catch (e) {
        listError.value = e instanceof Error ? e.message : String(e);
    }
}

// The source's state in plain words, with the longer meaning on hover.
function statusText(s: AddressSource): { text: string; title: string } {
    if (refreshing.value.includes(s.id)) return { text: 'Updating…', title: 'Pulling a fresh copy now. Searches use the previous copy until it finishes.' };
    if (s.status === 'ok') return { text: 'Loaded', title: 'This data is loaded and is searched when local address data is switched on.' };
    if (s.status === 'loading') return { text: 'Loading…', title: 'An upload is in progress. Nothing from it is searched until it finishes.' };
    if (s.status === 'failed') return { text: 'Load failed', title: 'The last load did not finish, so this source has no data. See the message below it.' };
    return { text: 'No data yet', title: 'Nothing has been loaded into this source.' };
}

function statusClass(s: AddressSource): string {
    if (refreshing.value.includes(s.id) || s.status === 'loading') return 'bg-azure text-white';
    if (s.status === 'ok') return 'bg-green text-white';
    if (s.status === 'failed') return 'bg-red text-white';
    return 'bg-secondary text-white';
}

function day(iso: string | null): string { return localDay(iso) || '—'; }
function when(iso: string | null): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; }
}

async function refreshNow(s: AddressSource) {
    listError.value = '';
    refreshing.value = [...refreshing.value, s.id];
    try { await refreshAddressSource(s.id); }
    catch (e) { listError.value = e instanceof Error ? e.message : String(e); }
    finally { await reload(); }
}

async function remove(s: AddressSource) {
    if (!confirm(`Remove "${s.name}" and its ${s.record_count.toLocaleString()} records?`)) return;
    try { await deleteAddressSource(s.id); }
    catch (e) { listError.value = e instanceof Error ? e.message : String(e); }
    await reload();
}

// ── Add / replace ───────────────────────────────────────────────────────────────────────────
const add = reactive({
    open: false,
    replace: null as AddressSource | null,
    kind: 'points' as SourceKind,
    name: '',
    mode: 'file' as 'file' | 'url',
    url: '',
    refreshHours: 24,
    asOf: localDay(new Date()),
    file: null as ParsedFile | null,
    probe: null as UrlProbe | null,
    probing: false,
    columns: [] as string[],
    hasGeometry: false,
    mapping: {} as Record<string, string>,
    statusKeep: [] as string[],
    detected: '',
    busy: false,
    progress: '',
    result: '',
    error: '',
    unresolved: [] as { label: string; address: string | null }[],
});

function openAdd(replace: AddressSource | null = null) {
    Object.assign(add, {
        open: true, replace, kind: replace?.kind ?? 'points', name: replace?.name ?? '', mode: 'file', url: '',
        refreshHours: 24, asOf: localDay(new Date()), file: null, probe: null, probing: false,
        columns: [], hasGeometry: false, mapping: {}, statusKeep: [], detected: '', busy: false, progress: '', result: '', error: '', unresolved: [],
    });
}

// What the example file for each kind shows, in a few words beside the button.
const EXAMPLE_HINT: Record<SourceKind, string> = {
    points: 'One row per address. A unit gets its own row. Columns can be in any order; extra columns are ignored.',
    intersections: 'One row per intersection, two to four street names. Extra columns are ignored.',
    places: 'One row per place. Give an address, coordinates, or both. Aliases are separated by ; or |.',
};

function downloadExample() {
    downloadFile(exampleCsvName(add.kind), 'text/csv', exampleCsv(add.kind));
}

function onKindChange() {
    add.detected = '';
    remap();
}

// The column for each field, guessed again for the kind now chosen.
function remap() {
    if (add.file) add.mapping = initialMapping(add.kind, add.file);
    else if (add.probe) {
        const m = guessMapping(add.kind, add.columns);
        if (add.hasGeometry) { m.lat = '__lat'; m.lon = '__lon'; }
        add.mapping = m;
    }
}

// Set the kind from the columns just read, and say so. Never when replacing a file: that source's
// kind is fixed.
function detectKind() {
    add.detected = '';
    if (add.replace) return;
    const k = guessKind(add.columns);
    if (!k) return;
    add.kind = k;
    const m = guessMapping(k, add.columns);
    const by = (k === 'points' ? [m.house_number, m.street_name || m.full_street || m.full_address] : k === 'intersections' ? [m.street1, m.street2] : [m.name]).filter(Boolean);
    add.detected = `Picked for you: ${KIND_LABEL[k]}, because this file has ${by.length > 1 ? 'the columns' : 'the column'} ${by.join(' and ')}. Pick another above if that is wrong.`;
}

function onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    add.error = ''; add.result = ''; add.unresolved = [];
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = parseFile(String(reader.result ?? ''));
            if (!parsed.rows.length) throw new Error('The file has no rows');
            add.file = parsed;
            add.columns = parsed.columns;
            add.hasGeometry = parsed.hasGeometry;
            detectKind();
            add.mapping = initialMapping(add.kind, parsed);
            add.statusKeep = [];
            if (!add.name) add.name = f.name.replace(/\.[^.]+$/, '');
        } catch (e) {
            add.file = null; add.columns = [];
            add.error = `Could not read the file: ${e instanceof Error ? e.message : String(e)}`;
        }
    };
    reader.onerror = () => { add.error = 'Could not read the file'; };
    reader.readAsText(f);
}

async function probe() {
    add.probing = true; add.error = ''; add.probe = null; add.columns = [];
    try {
        const r = await probeAddressUrl(add.url.trim(), add.kind);
        add.probe = r.probe;
        add.columns = r.probe.columns;
        add.hasGeometry = r.probe.geometry || r.probe.sample.some(s => s.__lat != null);
        add.mapping = r.mapping;
        detectKind();
        remap();
        if (!add.name) {
            const m = /\/services\/([^/]+)\/(?:Feature|Map)Server/i.exec(add.url) ?? /\/([^/?#]+)[^/]*$/.exec(add.url);
            add.name = m ? decodeURIComponent(m[1]).replace(/[_-]+/g, ' ') : 'Web source';
        }
    } catch (e) {
        add.error = e instanceof Error ? e.message : String(e);
    } finally {
        add.probing = false;
    }
}

// Every value in the file's status column, all ticked to start with: nothing is left out unless
// the admin unticks it.
const statusValues = computed(() => add.file && add.kind === 'points' && add.mapping.status ? valueCounts(add.file.rows, add.mapping.status) : []);
watch(statusValues, (vals) => { add.statusKeep = vals.map(v => v.value); });
const statusLeftOut = computed(() => statusValues.value.filter(v => !add.statusKeep.includes(v.value)).reduce((n, v) => n + v.count, 0));
// The choices for one field's column: none, the GeoJSON geometry for a coordinate, then every column.
function columnOptions(key: string): { value: string; label: string }[] {
    const out = [{ value: '', label: '— not in file —' }];
    if (add.hasGeometry && (key === 'lat' || key === 'lon')) out.push({ value: key === 'lat' ? '__lat' : '__lon', label: 'from geometry' });
    return out.concat(add.columns.map(c => ({ value: c, label: c })));
}

const missing = computed(() => add.columns.length ? missingFields(add.kind, add.mapping) : []);
const canLoad = computed(() => {
    if (!add.name.trim() || !add.columns.length || missing.value.length) return false;
    if (statusValues.value.length && !add.statusKeep.length) return false;
    return add.mode === 'file' ? !!add.file : !!add.probe;
});
const preview = computed(() => {
    const rows = add.file?.rows ?? add.probe?.sample ?? [];
    return rows.slice(0, 3).map(r => {
        const m = applyMapping(add.mapping, r);
        return Object.entries(m).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${String(v)}`).join('  ');
    });
});

async function load() {
    add.busy = true; add.error = ''; add.result = ''; add.unresolved = []; add.progress = '';
    let sourceId = add.replace?.id ?? '';
    let loadId = '';
    try {
        const statusKeep = statusLeftOut.value ? add.statusKeep : undefined;
        if (add.replace) {
            await patchAddressSource(sourceId, { mapping: add.mapping, status_keep: statusKeep ?? null });
        } else {
            const src = await createAddressSource({
                kind: add.kind, name: add.name.trim(), mode: add.mode,
                url: add.mode === 'url' ? add.url.trim() : undefined,
                refresh_hours: add.mode === 'url' ? add.refreshHours : undefined,
                mapping: add.mapping, status_keep: statusKeep,
                data_as_of: add.mode === 'file' && add.asOf ? new Date(add.asOf + 'T12:00:00').toISOString() : undefined,
            });
            sourceId = src.id;
        }
        if (add.mode === 'url') {
            add.progress = 'Pulling from the web address…';
            const src = await refreshAddressSource(sourceId);
            add.result = `Loaded ${src.record_count.toLocaleString()} records (${src.dropped_count} dropped).`;
        } else {
            const file = add.file!;
            const keep = statusKeep ? new Set(statusKeep.map(v => v.toUpperCase())) : null;
            loadId = await startAddressLoad(sourceId);
            let accepted = 0, dropped = 0;
            const reasons: Record<string, number> = {};
            for (let i = 0; i < file.rows.length; i += LOAD_BATCH) {
                const batch: Record<string, unknown>[] = [];
                for (const r of file.rows.slice(i, i + LOAD_BATCH)) {
                    const m = applyMapping(add.mapping, r);
                    if (keep && !keep.has(String(m.status ?? '').trim().toUpperCase())) { dropped++; reasons['status filtered'] = (reasons['status filtered'] ?? 0) + 1; continue; }
                    batch.push(m);
                }
                if (batch.length) {
                    const r = await pushAddressRows(sourceId, loadId, batch);
                    accepted += r.accepted; dropped += r.dropped;
                    for (const [k, v] of Object.entries(r.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
                }
                add.progress = `Uploading… ${Math.min(i + LOAD_BATCH, file.rows.length).toLocaleString()} of ${file.rows.length.toLocaleString()} rows`;
            }
            add.progress = 'Checking and making it live…';
            const done = await commitAddressLoad(sourceId, loadId, {
                data_as_of: add.asOf ? new Date(add.asOf + 'T12:00:00').toISOString() : undefined,
                dropped,
            });
            loadId = '';
            const why = Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join(', ');
            add.result = `Loaded ${accepted.toLocaleString()} records${dropped ? `, ${dropped.toLocaleString()} dropped (${why})` : ''}.`
                + (done.source.unresolved_count ? ` ${done.source.unresolved_count} places have no location yet.` : '');
            add.unresolved = done.unresolved;
        }
        add.progress = '';
        add.file = null;
        await reload();
    } catch (e) {
        add.error = e instanceof Error ? e.message : String(e);
        add.progress = '';
        if (loadId) { try { await abortAddressLoad(sourceId, loadId); } catch { /* best effort */ } }
        await reload();
    } finally {
        add.busy = false;
    }
}

// ── Try it ──────────────────────────────────────────────────────────────────────────────────
const tryText     = ref('');
const tryResults  = ref<AddressSuggestion[]>([]);
const tryTextDone = ref(false);
const tryLat      = ref('');
const tryLon      = ref('');
const tryReverse  = ref<ReverseResult | null>(null);
const tryError    = ref('');
let tryDebounce: ReturnType<typeof setTimeout>;

function onTryInput() {
    clearTimeout(tryDebounce);
    if (tryText.value.trim().length < Math.max(1, settings.min_chars)) { tryResults.value = []; tryTextDone.value = false; return; }
    tryDebounce = setTimeout(tryTyped, 250);
}

async function tryTyped() {
    if (!tryText.value.trim()) return;
    tryError.value = '';
    try {
        tryResults.value = (await suggestAddress(tryText.value.trim(), { localOnly: true, limit: settings.result_limit })).suggestions;
        tryTextDone.value = true;
    } catch (e) {
        tryError.value = e instanceof Error ? e.message : String(e);
    }
}

async function tryPoint() {
    tryError.value = '';
    const lat = Number(tryLat.value), lon = Number(tryLon.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { tryError.value = 'Enter a numeric latitude and longitude'; return; }
    try { tryReverse.value = await reverseAddress(lat, lon, { localOnly: true }); }
    catch (e) { tryError.value = e instanceof Error ? e.message : String(e); }
}

onMounted(async () => {
    try { Object.assign(settings, await getAddressSettings()); } catch { /* older server: defaults */ }
    await reload();
});
onUnmounted(() => { if (poll) clearInterval(poll); });
</script>

<style scoped>
/* Columns follow the panel's own width (the Dispatcher can be a narrow column on a wide screen). */
.addr-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
}
</style>
