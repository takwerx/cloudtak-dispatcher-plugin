<template>
    <form
        class='d-flex flex-column gap-3'
        @submit.prevent='submit'
    >
        <!-- Changing the location of an incident that already exists (prop `relocate`) shows the
             Location block alone: the rest of an incident is edited from its own detail. -->
        <!-- Incident Number (auto, read-only) -->
        <div v-if='incidentNumber && !relocate'>
            <label class='form-label small text-muted mb-1'>Incident #</label>
            <input
                :value='incidentNumber'
                type='text'
                readonly
                class='form-control form-control-sm border bg-transparent text-warning fw-semibold'
            >
        </div>

        <!-- Type — shared dropdown in both modes (custom types managed via the top
             bar's gear → Dispatcher Settings, not here mid-incident) -->
        <div v-if='!relocate'>
            <label class='form-label small text-muted mb-1'>Incident Type <span class='text-danger'>*</span></label>
            <select
                v-model='form.incidentType'
                required
                class='form-select form-select-sm border'
            >
                <option value=''>
                    — Select type —
                </option>
                <option
                    v-for='t in typeOptions'
                    :key='t'
                    :value='t'
                >
                    {{ t }}
                </option>
            </select>
        </div>

        <!-- Date/Time -->
        <div v-if='!relocate'>
            <label class='form-label small text-muted mb-1'>Incident Time <span class='text-danger'>*</span></label>
            <input
                v-model='form.incidentTimeLocal'
                type='datetime-local'
                required
                class='form-control form-control-sm border'
            >
        </div>

        <!-- Location -->
        <div>
            <label class='form-label small text-muted mb-1'>{{ relocate ? 'New location' : 'Location' }} <span class='text-danger'>*</span></label>
            <div class='input-group mb-1'>
                <!-- Down / Up move through the matches and Enter takes the marked one, so an address can be
                     chosen without the mouse. With no matches showing, Enter does what it always did. -->
                <input
                    ref='geoBox'
                    v-model='geoQuery'
                    type='text'
                    class='form-control form-control-sm border'
                    placeholder='Search address…'
                    @input='onGeoInput'
                    @keydown.down.prevent='geoMove(1)'
                    @keydown.up.prevent='geoMove(-1)'
                    @keydown.enter='geoEnter'
                >
                <button
                    type='button'
                    class='btn btn-sm btn-secondary'
                    :disabled='geocoding'
                    @click='doGeocode'
                >
                    <span
                        v-if='geocoding'
                        class='spinner-border spinner-border-sm'
                    />
                    <span v-else>Search</span>
                </button>
                <button
                    type='button'
                    class='btn btn-sm'
                    :class='picking ? "btn-warning" : "btn-outline-secondary"'
                    title='Click a point on the map to set the location'
                    @click='pickOnMap'
                >
                    📍
                </button>
            </div>
            <div
                v-if='geoFailed'
                class='small text-warning mb-1'
                data-test='search-unavailable'
            >
                Address search isn't available. Drop a pin and type the address.
            </div>
            <div
                v-if='picking'
                class='small text-warning mb-1'
            >
                Click a point on the map to set the incident location…
            </div>
            <div
                v-if='geoSuggestions.length'
                class='list-group mb-1'
            >
                <button
                    v-for='(s, i) in geoSuggestions'
                    :key='s.source + s.label'
                    type='button'
                    class='list-group-item list-group-item-action py-1 small d-flex align-items-center gap-2'
                    :class='{ active: i === geoMarked }'
                    data-test='geo-suggestion'
                    @click='applySuggestion(s)'
                >
                    <span
                        class='badge fw-normal flex-shrink-0'
                        :class='badgeFor(s).cls'
                    >{{ badgeFor(s).text }}</span>
                    <span class='text-truncate'>
                        {{ s.label }}<span
                            v-if='s.kind === "place"'
                            class='text-muted'
                        >{{ s.category ? ' · ' + s.category : '' }}{{ s.streetName ? ' · ' + s.streetName : '' }}</span>
                    </span>
                </button>
            </div>
            <!-- What the map click or chosen suggestion matched: source, distance, alternates, units -->
            <div
                v-if='match'
                class='border rounded px-2 py-1 mb-1 small d-flex flex-column gap-1'
                data-test='geo-match'
            >
                <div
                    v-if='match.best'
                    class='d-flex align-items-center flex-wrap gap-2'
                >
                    <span
                        class='badge fw-normal flex-shrink-0'
                        :class='badgeFor(match.best).cls'
                    >{{ badgeFor(match.best).text }}</span>
                    <span>{{ match.best.label }}</span>
                    <span
                        v-if='match.best.distance != null'
                        class='text-muted'
                    >· {{ distanceText(match.best.distance) }} from your click</span>
                </div>
                <div
                    v-else
                    class='text-muted'
                >
                    No address found near that point. Type the address, or pick one below.
                </div>
                <div
                    v-if='unitsOffered.shown.length'
                    class='d-flex align-items-center flex-wrap gap-1'
                    data-test='geo-units'
                >
                    <span class='text-muted'>Unit:</span>
                    <button
                        v-for='u in unitsOffered.shown'
                        :key='u.unit'
                        type='button'
                        class='btn btn-sm py-0'
                        :class='sameUnit(form.unit, u.unit) ? "btn-secondary" : "btn-outline-secondary"'
                        @click='form.unit = u.unit'
                    >
                        {{ u.unit }}
                    </button>
                    <span
                        v-if='unitsOffered.more'
                        class='text-muted'
                    >… {{ unitsOffered.more }} more, type it in the Unit box</span>
                </div>
                <div
                    v-if='match.alternates.length'
                    class='d-flex flex-column'
                >
                    <button
                        v-for='(a, i) in match.alternates'
                        :key='i'
                        type='button'
                        class='btn btn-link btn-sm p-0 text-decoration-none d-flex align-items-center justify-content-start gap-2'
                        @click='applyMatch(a)'
                    >
                        <span
                            class='badge fw-normal flex-shrink-0'
                            :class='badgeFor(a).cls'
                        >{{ badgeFor(a).text }}</span>
                        <span class='text-truncate'>{{ a.label }}<span
                            v-if='a.kind === "place" && a.streetName'
                            class='text-muted'
                        > · {{ a.streetName }}</span></span>
                        <span
                            v-if='a.distance != null'
                            class='text-muted flex-shrink-0'
                        >· {{ distanceText(a.distance) }}</span>
                    </button>
                </div>
            </div>
            <div class='row g-1'>
                <div :class='localAddressing ? "col-9" : "col-8"'>
                    <input
                        v-model='form.streetName'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='Street address'
                    >
                </div>
                <div
                    v-if='localAddressing'
                    class='col-3'
                >
                    <input
                        v-model='form.unit'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='Unit'
                        data-test='unit'
                    >
                </div>
                <div :class='boxCol'>
                    <input
                        v-model='form.city'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='City'
                    >
                </div>
                <div :class='boxCol'>
                    <input
                        v-model='form.state'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='State'
                    >
                </div>
                <div :class='boxCol'>
                    <input
                        v-model='form.zipCode'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='ZIP'
                    >
                </div>
                <div :class='boxCol'>
                    <input
                        v-model='form.country'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='Country'
                    >
                </div>
            </div>
            <div class='row g-1 mt-1'>
                <div class='col-6'>
                    <input
                        v-model.number='form.lat'
                        type='number'
                        step='any'
                        class='form-control form-control-sm border'
                        placeholder='Latitude'
                    >
                </div>
                <div class='col-6'>
                    <input
                        v-model.number='form.lon'
                        type='number'
                        step='any'
                        class='form-control form-control-sm border'
                        placeholder='Longitude'
                    >
                </div>
            </div>
        </div>

        <!-- Details -->
        <div v-if='!relocate'>
            <label class='form-label small text-muted mb-1'>Details</label>
            <textarea
                v-model='form.details'
                rows='3'
                class='form-control form-control-sm border'
                placeholder='Incident notes…'
            />
        </div>

        <!-- Report number (standalone only; optional, can also be added later), and the call taker's
             employee number when Dispatcher Settings → Employee Numbers is on -->
        <div
            v-if='serverMode === "standalone" && !relocate'
            class='d-flex flex-wrap gap-2'
        >
            <div class='flex-grow-1'>
                <label class='form-label small text-muted mb-1'>Report Number</label>
                <input
                    v-model='form.reportNumber'
                    type='text'
                    maxlength='64'
                    class='form-control form-control-sm border'
                    placeholder='Optional — can be added later'
                >
            </div>
            <!-- Pre-filled from the header; change it only when taking a call for someone else. Yellow when
                 empty, so a new user sees it; never required. -->
            <div
                v-if='dispatcherStore.operatorNumbers'
                style='width:110px'
            >
                <label class='form-label small text-muted mb-1'>Taken by #</label>
                <input
                    v-model='form.operator'
                    type='text'
                    inputmode='numeric'
                    :maxlength='OPERATOR_MAX'
                    class='form-control form-control-sm border'
                    :class='form.operator.trim() ? "" : "border-warning"'
                    placeholder='Employee #'
                    data-test='taken-by'
                >
            </div>
            <div
                v-if='dispatcherStore.operatorNumbers && !form.operator.trim()'
                class='w-100 small text-warning'
            >
                Sign in at the top, or enter the employee number of who took the call.
            </div>
        </div>

        <!-- Caller Info (collapsible; caller type is TAK-CAD only) -->
        <div v-if='!relocate'>
            <button
                type='button'
                class='btn btn-sm btn-link text-muted p-0 text-decoration-none'
                @click='showCaller = !showCaller'
            >
                {{ showCaller ? '▾' : '▸' }} Caller Info<span
                    v-if='serverMode === "standalone"'
                    class='ms-1'
                >(first caller; add more from the incident)</span>
            </button>
            <div
                v-if='showCaller'
                class='mt-2 d-flex flex-column gap-2'
            >
                <input
                    v-model='form.callerName'
                    type='text'
                    maxlength='120'
                    class='form-control form-control-sm border'
                    placeholder='Caller name'
                >
                <input
                    v-model='form.callerPhone'
                    type='tel'
                    maxlength='40'
                    class='form-control form-control-sm border'
                    placeholder='Phone number'
                >
                <select
                    v-if='serverMode === "takcad"'
                    v-model='form.callerType'
                    class='form-select form-select-sm border'
                >
                    <option value=''>
                        — Caller type —
                    </option>
                    <option value='PHONE'>
                        Phone
                    </option>
                    <option value='RADIO'>
                        Radio
                    </option>
                    <option value='OTHER'>
                        Other
                    </option>
                </select>
            </div>
        </div>

        <!-- Error -->
        <div
            v-if='saveError'
            class='alert alert-danger py-2 small'
        >
            {{ saveError }}
        </div>

        <!-- Submit -->
        <div class='d-flex gap-2'>
            <button
                type='submit'
                class='btn btn-sm btn-warning flex-grow-1'
                :disabled='saving'
            >
                <span
                    v-if='saving'
                    class='spinner-border spinner-border-sm me-1'
                />
                {{ relocate ? 'Save Location' : uid ? 'Save Changes' : 'Create Incident' }}
            </button>
            <button
                type='button'
                class='btn btn-sm btn-outline-secondary'
                @click='emit("cancel")'
            >
                Cancel
            </button>
        </div>
    </form>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useMapStore } from '../../../src/stores/map.ts';
import {
    getIncident, insertIncident, updateIncident,
    geocodeAddress, reverseGeocode,
    getNextIncidentNumber,
    DEFAULT_INCIDENT_TYPES,
} from '../lib/takcad-client.ts';
import type { GeocodeSuggestion, MissionRef } from '../lib/takcad-client.ts';
import { suggestAddress, reverseAddress, getAddressSettings, badgeFor, distanceText } from '../lib/addressing.ts';
import type { AddressSuggestion } from '../lib/addressing.ts';
import { streetWithUnit, detailsWithPlace, unitChoices, unitNamed, sameUnit, joinAddress, splitAddress } from '../lib/address-form.ts';
import type { IncidentRef, IncidentTypeRef } from '../lib/takcad-types.ts';
import { STATUS_ACTIVE } from '../lib/takcad-types.ts';
import { dropIncidentMarker, postMissionCallLog, postFeedChat } from '../lib/map-marker.ts';
import { showIncident } from '../lib/field-delivery.ts';
import { createIncident, getDispatcherSettings } from '../lib/events-client.ts';
import type { DispatcherIncident } from '../lib/events-client.ts';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import { parseOperator, OPERATOR_MAX } from '../lib/operator.ts';
import type { NewIncidentPrefill } from '../lib/command-state.ts';

const props = defineProps<{
    serverMode:    'detecting' | 'takcad' | 'standalone';
    uid?:          string;
    incidentTypes: IncidentTypeRef[];
    // TAK-CAD mode passes its locally-picked DataSync feed for marker/log routing.
    activeFeed?:   MissionRef | null;
    // Standalone: the incident whose location is being changed. The form then shows the Location
    // block alone, filled with where the incident is now, and hands the new place back (`relocated`).
    relocate?:     DispatcherIncident | null;
    // Standalone, from the command line's N: the type to start with and the address to search for.
    prefill?:      NewIncidentPrefill | null;
}>();

const emit = defineEmits<{
    (e: 'saved',            uid: string):              void;
    // `problems`: what did not go out after the incident was saved (marker, feed log, chat), or ''.
    (e: 'saved-standalone', inc: DispatcherIncident, problems: string): void;
    // The new place for the `relocate` incident. `details` carries the Common Place Name line.
    (e: 'relocated', to: { address: string; lat: number; lon: number; details: string }): void;
    (e: 'cancel'                          ):           void;
}>();

const saving         = ref(false);
const saveError      = ref('');
const showCaller     = ref(false);
const geocoding      = ref(false);
const mapStore       = useMapStore();
const picking        = ref(false);
const geoQuery       = ref('');
const geoSuggestions = ref<AddressSuggestion[]>([]);
const geoFailed      = ref(false);
const incidentNumber = ref('');
let geoDebounce: ReturnType<typeof setTimeout>;
const geoBox         = ref<HTMLInputElement | null>(null);
// The match Enter would take: the first, until Down / Up move it. -1 while none are showing.
const geoMarked      = ref(-1);
watch(geoSuggestions, (list) => { geoMarked.value = list.length ? 0 : -1; });

function geoMove(step: number) {
    const n = geoSuggestions.value.length;
    if (n) geoMarked.value = (geoMarked.value + step + n) % n;
}

// Enter with matches showing takes the marked one and stays in the form (a second Enter submits it).
function geoEnter(e: KeyboardEvent) {
    const s = geoSuggestions.value[geoMarked.value];
    if (!s) return;
    e.preventDefault();
    applySuggestion(s);
}

// Local address data (admin-loaded points, intersections, places). Read once per form; an older
// server without the route leaves the defaults, which are today's behaviour.
const addr = reactive({ enabled: false, minChars: 4 });

// What the last map click (or chosen suggestion with units) matched, for the line under the box.
interface Match {
    best: AddressSuggestion | null;
    alternates: AddressSuggestion[];
    clicked: boolean;   // from a map click: the point stays where the dispatcher clicked
}
const match = ref<Match | null>(null);

// Shared type list: TAK-CAD server types (names only) or default list
// Custom call types (standalone only): deployment-shared via dispatcher_settings,
// merged over the built-in defaults; edited in DispatcherSettings (top bar gear).
// TAK-CAD mode keeps its server-provided list.
const customTypes = ref<string[]>([]);

const typeOptions = computed<string[]>(() => {
    if (props.serverMode === 'takcad' && props.incidentTypes.length) {
        return props.incidentTypes.map(t => t.name);
    }
    const extra = customTypes.value
        .filter(t => !DEFAULT_INCIDENT_TYPES.includes(t))
        .sort();
    // Keep 'Other' at the bottom, custom types above it.
    const base = DEFAULT_INCIDENT_TYPES.filter(t => t !== 'Other');
    return [...base, ...extra, 'Other'];
});

const form = reactive({
    incidentType:      '',
    incidentTimeLocal: toLocalInput(new Date().toISOString()),
    streetName: '', city: '', state: '', zipCode: '', country: '',
    unit:       '',
    lat:        null as number | null,
    lon:        null as number | null,
    details:    '',
    reportNumber: '',
    operator:    dispatcherStore.operator ?? '',
    callerName:  '',
    callerPhone: '',
    callerType:  '',
});

// Taken by # follows whoever is signed in while this form is open (sign in, sign out, the next person
// signs in), unless someone typed a different number into the box themselves.
watch(() => dispatcherStore.operator, (id, before) => {
    const box = form.operator.trim();
    if (!box || box === (before ?? '')) form.operator = id ?? '';
});

function toLocalInput(iso: string): string {
    try {
        const d = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
}

// Local data searches from a short prefix (places narrow as more is typed); the public geocoder
// alone needs a few characters to be worth asking.
function onGeoInput() {
    clearTimeout(geoDebounce);
    const min = addr.enabled ? addr.minChars : 4;
    if (geoQuery.value.trim().length < min) { geoSuggestions.value = []; return; }
    geoDebounce = setTimeout(doGeocode, addr.enabled ? 250 : 500);
}

// Local address data is a standalone feature. TAK-CAD mode keeps the TAK-CAD proxy, and so does an
// older server without the local-address route (it answers 404).
const localAddressing = computed(() => props.serverMode === 'standalone');

// Standalone has a Unit box beside the street, so the four boxes under it share one row.
// TAK-CAD mode keeps its layout: street and city, then state, ZIP and country.
const boxCol = computed(() => localAddressing.value ? 'col-3' : 'col-4');

function fromLegacy(s: GeocodeSuggestion): AddressSuggestion {
    return { ...s, source: 'osm', kind: 'osm' };
}

async function legacySuggest(q: string): Promise<AddressSuggestion[]> {
    return q.length >= 4 ? (await geocodeAddress(q)).map(fromLegacy) : [];
}

// The server asks the public geocoder, so with no internet the search fails. Say so in one line under
// the box and keep the form: a failure thrown from here would replace the whole Dispatcher with the error
// (CadMain's onErrorCaptured) and lose what was typed.
async function doGeocode() {
    const q = geoQuery.value.trim();
    if (!q) return;
    geocoding.value = true;
    try {
        if (!localAddressing.value) {
            geoSuggestions.value = await legacySuggest(q);
        } else {
            try {
                const r = await suggestAddress(q);
                addr.enabled = r.settings.enabled;
                addr.minChars = r.settings.min_chars;
                // Answers can arrive out of order while typing: keep only the one for the current text.
                if (geoQuery.value.trim() === q) geoSuggestions.value = r.suggestions;
            } catch {
                geoSuggestions.value = await legacySuggest(q);
            }
        }
        geoFailed.value = false;
    } catch (e) {
        geoSuggestions.value = [];
        geoFailed.value = true;
        console.warn('[dispatcher] address search failed', e);
    } finally {
        geocoding.value = false;
    }
}

// Copy a suggestion's address fields into the form; coordinates too unless told to keep the click.
// keepStreet: a place with no address of its own keeps the street already in the form. Only right
// for a place offered beside a map-click match, where that street is the address it sits at.
function fillFrom(s: AddressSuggestion, withCoords: boolean, keepStreet = false) {
    form.streetName = s.streetName || (keepStreet && s.kind === 'place' ? form.streetName : '');
    form.city       = s.city;
    form.state      = s.state;
    form.zipCode    = s.zipCode;
    form.country    = s.country;
    form.unit       = s.unit ?? '';
    if (withCoords) {
        form.lat = s.lat;
        form.lon = s.lon;
    }
    // A public result with missing parts: parse its one-line label.
    if (s.source === 'osm' && (!form.city || !form.state) && s.label) {
        const parts = s.label.split(',').map((p: string) => p.trim());
        if (!form.streetName && parts[0]) form.streetName = parts[0];
        if (!form.city && parts[1])        form.city       = parts[1];
        if (parts[2]) {
            const sv = parts[2].split(' ').filter(Boolean);
            if (!form.state   && sv[0]) form.state   = sv[0];
            if (!form.zipCode && sv[1]) form.zipCode = sv[1];
        }
    }
    // A place goes at the top of the details, since the incident record keeps one address line;
    // choosing something that is not a place takes an earlier place's line out again.
    form.details = detailsWithPlace(form.details, s.placeName);
}

function applySuggestion(s: AddressSuggestion) {
    fillFrom(s, true);
    geoSuggestions.value = [];
    geoQuery.value = s.placeName ? `${s.placeName} · ${s.streetName}` : s.label;
    // Units to choose from, or nothing more to show for a typed pick.
    match.value = s.units && s.units.length
        ? { best: s, alternates: [], clicked: false }
        : null;
    void fillFromPublic(s);
}

// A local place or intersection with no verified address near it (a trail post, a milepost) still
// has no city or state: ask the public geocoder for those by location. Blank boxes only, and only
// while this is still the chosen location. Offline, the boxes stay blank.
async function fillFromPublic(s: AddressSuggestion) {
    if (s.source === 'osm' || (s.city && s.state)) return;
    try {
        const p = await reverseGeocode(s.lat, s.lon);
        if (!p || form.lat !== s.lat || form.lon !== s.lon) return;
        if (!form.city && p.city)       form.city    = p.city;
        if (!form.state && p.state)     form.state   = p.state;
        if (!form.zipCode && p.zipCode) form.zipCode = p.zipCode;
        if (!form.country && p.country) form.country = p.country;
    } catch { /* offline: leave the boxes blank */ }
}

// Use one of the other matches of a map click for the address. The point stays on the click.
function applyMatch(s: AddressSuggestion) {
    fillFrom(s, false, true);
    geoQuery.value = s.placeName ? `${s.placeName} · ${s.streetName}` : s.label;
    if (match.value) {
        match.value.best = s;
        match.value.alternates = match.value.alternates.filter(a => a !== s);
    }
}

// The unit buttons under a chosen address: a few, narrowing as the Unit box is typed in.
const unitsOffered = computed(() => unitChoices(match.value?.best?.units ?? [], form.unit));

// For a typed address the point follows the Unit box: a unit the data knows has its own point,
// anything else typed keeps the address's. After a map click the point stays on the click.
function placeUnit() {
    const m = match.value;
    if (!m?.best?.units?.length || m.clicked) return;
    const at = unitNamed(m.best.units, form.unit) ?? m.best;
    form.lat = at.lat;
    form.lon = at.lon;
}
watch(() => form.unit, placeUnit);

function pickOnMap() {
    const map = mapStore.map;
    if (!map) return;
    picking.value = true;
    map.getCanvas().style.cursor = 'crosshair';
    map.once('click', async (e: { lngLat: { lat: number; lng: number } }) => {
        map.getCanvas().style.cursor = '';
        picking.value = false;
        form.lat = Number(e.lngLat.lat.toFixed(6));
        form.lon = Number(e.lngLat.lng.toFixed(6));
        const clickLat = form.lat, clickLon = form.lon;
        match.value = null;
        geoSuggestions.value = [];
        try {
            let best: AddressSuggestion | null = null;
            let alternates: AddressSuggestion[] = [];
            const legacy = async () => {
                const s = await reverseGeocode(clickLat, clickLon);
                return s ? fromLegacy(s) : null;
            };
            if (!localAddressing.value) {
                best = await legacy();
            } else {
                try {
                    const r = await reverseAddress(clickLat, clickLon);
                    best = r.suggestion; alternates = r.alternates;
                    addr.enabled = r.settings.enabled;
                } catch {
                    best = await legacy();
                }
            }
            // A later click replaces this one: only report the match for the current point.
            if (form.lat !== clickLat || form.lon !== clickLon) return;
            match.value = { best, alternates, clicked: true };
            if (best) fillFrom(best, false);
            if (best) geoQuery.value = best.placeName ? `${best.placeName} · ${best.streetName}` : best.label;
        } catch { /* coords set regardless */ }
    });
}

onMounted(async () => {
    // Custom call types load best-effort — an older server without the settings route
    // just leaves the defaults.
    if (props.serverMode === 'standalone') {
        getDispatcherSettings().then((s) => {
            const list = s.incident_types;
            if (Array.isArray(list)) {
                customTypes.value = list.filter((t): t is string => typeof t === 'string');
            }
            dispatcherStore.callerOnMarkers = s.caller_on_markers !== false;
        }).catch(() => { /* defaults only */ });
        getAddressSettings().then((s) => {
            addr.enabled = s.enabled;
            addr.minChars = s.min_chars;
        }).catch(() => { /* older server: public geocoder only */ });
    }

    // TAK-CAD mode pre-generates a number from the feed's mission log. Standalone numbers are
    // assigned by the server on create (returned in the incident row), so we don't pre-gen them.
    if (props.serverMode === 'takcad' && props.activeFeed && !props.uid) {
        try { incidentNumber.value = await getNextIncidentNumber(props.activeFeed); }
        catch { incidentNumber.value = ''; }
    }

    if (props.relocate) {
        const at = props.relocate;
        Object.assign(form, splitAddress(at.address ?? ''), { lat: at.lat, lon: at.lon, details: at.details ?? '' });
        geoQuery.value = at.address ?? '';
    } else if (props.uid && props.serverMode === 'takcad') {
        try {
            const inc = await getIncident(props.uid);
            form.incidentType      = inc.incidentType?.name ?? '';
            form.incidentTimeLocal = toLocalInput(inc.incidentTime);
            form.streetName = inc.location?.address?.streetName ?? '';
            form.city       = inc.location?.address?.city       ?? '';
            form.state      = inc.location?.address?.state      ?? '';
            form.zipCode    = inc.location?.address?.zipCode    ?? '';
            form.country    = inc.location?.address?.country    ?? '';
            form.lat        = inc.location?.coords?.latitudeDeg  ?? null;
            form.lon        = inc.location?.coords?.longitudeDeg ?? null;
            form.details    = inc.details ?? '';
            const caller = inc.callerInfo?.[0];
            if (caller) {
                showCaller.value = true;
                form.callerName  = caller.name        ?? '';
                form.callerPhone = caller.phoneNumber ?? '';
                form.callerType  = caller.callerInfoType ?? '';
            }
        } catch (e) {
            saveError.value = e instanceof Error ? e.message : String(e);
        }
    } else if (typeOptions.value.length) {
        form.incidentType = typeOptions.value[0];
    }

    // Opened by the command line (N type, address): the type is set, the address is already being
    // searched, and the cursor is in the search box, so Down / Enter pick the match.
    if (props.prefill && !props.relocate) {
        if (props.prefill.type) form.incidentType = props.prefill.type;
        geoBox.value?.focus();
        if (props.prefill.address) {
            geoQuery.value = props.prefill.address;
            void doGeocode();
        }
    }
});

// The coordinates warning goes as soon as there are coordinates, not only at the next Create Incident.
const NEED_COORDS = 'Coordinates are required — use address search or enter lat/lon.';
watch(() => form.lat != null && form.lon != null, (has) => {
    if (has && saveError.value === NEED_COORDS) saveError.value = '';
});

async function submit() {
    saveError.value = '';
    if (form.lat == null || form.lon == null) {
        saveError.value = NEED_COORDS;
        return;
    }
    // The unit rides on the street line unless it is already in it.
    const street = streetWithUnit(form.streetName, form.unit);
    const address = joinAddress(street, form.city, form.state);
    if (props.relocate) {
        emit('relocated', { address, lat: form.lat, lon: form.lon, details: form.details });
    } else if (props.serverMode === 'standalone') {
        await submitStandalone(address);
    } else {
        await submitTakCad(address);
    }
}

async function submitStandalone(address: string) {
    if (!form.incidentType) { saveError.value = 'Select an incident type'; return; }

    const event = dispatcherStore.activeEvent;
    if (!event) { saveError.value = 'No event is open'; return; }

    const dispatcher = dispatcherStore.dispatcherName;

    // Who took the call (Employee Numbers on): the incident's creator and the first caller's Taken by.
    // Digits only, or empty for none.
    const operatorText = dispatcherStore.operatorNumbers ? form.operator.trim() : '';
    if (operatorText && !parseOperator(operatorText)) { saveError.value = 'Taken by #: digits only'; return; }

    saving.value = true;
    try {
        // Persist server-side first; the server assigns the incident number (<prefix>-NNN)
        // and returns the full row, shared with every dispatcher on this CloudTAK.
        const incident = await createIncident(event.id, {
            type:       form.incidentType,
            address,
            lat:        form.lat!,
            lon:        form.lon!,
            dispatcher,
            ...(dispatcherStore.operatorNumbers ? { operator: operatorText } : {}),
            details:    form.details,
            report_number: form.reportNumber.trim() || undefined,
            caller_name:   form.callerName.trim()   || undefined,
            caller_phone:  form.callerPhone.trim()  || undefined,
        });

        // CoT marker (DataSync) or Core Event (broadcast) + DataSync log/chat (best-effort;
        // the record already exists server-side). Broadcast Events have no feed log or chat.
        const markerErrors: string[] = [];
        try {
            await showIncident(mapStore, {
                uid:        incident.id,
                number:     incident.number,
                name:       incident.type ?? form.incidentType,
                type:       incident.type ?? form.incidentType,
                address,
                lat:        form.lat!,
                lon:        form.lon!,
                time:       incident.created_at,
                dispatcher,
                details:    form.details,
                callers:    dispatcherStore.callerOnMarkers ? (incident.callers ?? []) : [],
                feedGuid:   event.feed_guid,
                delivery:    event.delivery,
                channel:     event.channel,
                coreEventId: incident.core_event_id,
            });
        } catch (e) {
            markerErrors.push(event.delivery === 'broadcast'
                ? `Broadcast failed — ${e instanceof Error ? e.message : String(e)}`
                : `Marker failed — subscribe to the "${event.feed_name}" DataSync feed in CloudTAK first`);
            console.warn('[dispatcher] marker drop failed', e);
        }
        try {
            await postMissionCallLog(event.feed_name, {
                uid:     incident.id,
                number:  incident.number,
                name:    form.incidentType,
                type:    form.incidentType,
                address,
                time:    incident.created_at,
            });
        } catch (e) {
            markerErrors.push('DataSync log failed');
            console.warn('[dispatcher] mission log failed', e);
        }
        try {
            await postFeedChat(mapStore, { guid: event.feed_guid, name: event.feed_name },
                `NEW INCIDENT: ${incident.number} ${form.incidentType}${address ? ' — ' + address : ''}`);
        } catch (e) {
            markerErrors.push('Feed chat failed');
            console.warn('[dispatcher] feed chat failed', e);
        }

        // The list replaces this form now, so it shows what failed (IncidentListView).
        emit('saved-standalone', incident, markerErrors.join(' · '));
    } catch (e) {
        saveError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

async function submitTakCad(address: string) {
    void address;
    if (!form.incidentType) { saveError.value = 'Select an incident type'; return; }

    // Map type name back to IncidentTypeRef for the TAK-CAD API
    const incidentTypeRef: IncidentTypeRef = props.incidentTypes.find(t => t.name === form.incidentType)
        ?? { uid: crypto.randomUUID(), name: form.incidentType, description: null, requiredVehicleTypes: [], requiredRoles: [] };

    let existing: IncidentRef | null = null;
    if (props.uid) {
        try { existing = await getIncident(props.uid); }
        catch { /* create fresh */ }
    }

    const uid = props.uid ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const number = incidentNumber.value || '';
    const dispatcher = dispatcherStore.dispatcherName;

    const payload: IncidentRef = {
        ...(existing ?? {}),
        uid,
        incidentName: form.incidentType,
        incidentType: incidentTypeRef,
        incidentTime: new Date(form.incidentTimeLocal).toISOString(),
        status:       existing?.status ?? STATUS_ACTIVE,
        dispatcher:   dispatcher ? { name: dispatcher } : null,
        details:      form.details || null,
        location: {
            address: (form.streetName || form.city) ? {
                streetName: form.streetName,
                city:       form.city,
                state:      form.state,
                zipCode:    form.zipCode,
                country:    form.country,
            } : null,
            coords: { latitudeDeg: form.lat!, longitudeDeg: form.lon! },
        },
        callerInfo: (form.callerName || form.callerPhone) ? [{
            uid:                 crypto.randomUUID(),
            name:                form.callerName  || null,
            phoneNumber:         form.callerPhone || null,
            callerInfoType:      form.callerType  || null,
            timestamp:           now,
            phoneContactMethod:  null,
            radioContactDetails: null,
            otherContactDetails: null,
        }] : [],
        // Creation details seed the notes log so they show in the running note stream.
        notes:                existing?.notes ?? (form.details ? [{
            uid:         crypto.randomUUID(),
            info:        form.details,
            creator:     dispatcher || 'Dispatcher',
            incidentUid: uid,
            timestamp:   now,
        }] : []),
        requestedCallsigns:   existing?.requestedCallsigns   ?? [],
        vehicleUidsRequested: existing?.vehicleUidsRequested ?? [],
        personnelResponding:  existing?.personnelResponding   ?? [],
        vehiclesResponding:   existing?.vehiclesResponding    ?? [],
        firstResponderArrivalTime: existing?.firstResponderArrivalTime ?? null,
        incidentCompletionTime:    existing?.incidentCompletionTime    ?? null,
        sourceSystem: existing?.sourceSystem ?? { uid: crypto.randomUUID(), name: 'CloudTAK', platform: 'OTHER' },
    };

    saving.value = true;
    try {
        const resp = props.uid ? await updateIncident(payload) : await insertIncident(payload);
        if (!resp.success) throw new Error(resp.errors?.join(', ') || 'Server returned failure');

        // CoT marker (best-effort)
        const feedCad = props.activeFeed ?? null;
        try {
            await dropIncidentMarker(mapStore, {
                uid,
                number,
                name:       form.incidentType,
                type:       form.incidentType,
                address:    [form.streetName, form.city].filter(Boolean).join(', '),
                lat:        form.lat!,
                lon:        form.lon!,
                time:       now,
                dispatcher,
                details:    form.details,
                feedGuid:   feedCad?.guid,
            });
        } catch (e) { console.warn('[dispatcher] marker drop failed', e); }

        // DataSync log
        if (feedCad) {
            const cadAddress = [form.streetName, form.city].filter(Boolean).join(', ');
            try {
                await postMissionCallLog(feedCad.name, {
                    uid, number, name: form.incidentType, type: form.incidentType,
                    address: cadAddress,
                    time: now,
                });
            } catch (e) { console.warn('[dispatcher] mission log failed', e); }
            try {
                await postFeedChat(mapStore, feedCad,
                    `NEW INCIDENT: ${number} ${form.incidentType}${cadAddress ? ' — ' + cadAddress : ''}`);
            } catch (e) { console.warn('[dispatcher] feed chat failed', e); }
        }

        emit('saved', uid);
    } catch (e) {
        saveError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}
</script>
