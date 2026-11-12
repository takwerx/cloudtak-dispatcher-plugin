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
                <input
                    v-model='geoQuery'
                    type='text'
                    class='form-control form-control-sm border'
                    placeholder='Search address…'
                    @input='onGeoInput'
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
                    v-for='s in geoSuggestions'
                    :key='s.label'
                    type='button'
                    class='list-group-item list-group-item-action py-1 small'
                    @click='applySuggestion(s)'
                >
                    {{ s.label }}
                </button>
            </div>
            <div class='row g-1'>
                <div class='col-8'>
                    <input
                        v-model='form.streetName'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='Street address'
                    >
                </div>
                <div class='col-4'>
                    <input
                        v-model='form.city'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='City'
                    >
                </div>
                <div class='col-4'>
                    <input
                        v-model='form.state'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='State'
                    >
                </div>
                <div class='col-4'>
                    <input
                        v-model='form.zipCode'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='ZIP'
                    >
                </div>
                <div class='col-4'>
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
import { joinAddress, splitAddress } from '../lib/address-form.ts';
import type { IncidentRef, IncidentTypeRef } from '../lib/takcad-types.ts';
import { STATUS_ACTIVE } from '../lib/takcad-types.ts';
import { dropIncidentMarker, postMissionCallLog, postFeedChat } from '../lib/map-marker.ts';
import { showIncident } from '../lib/field-delivery.ts';
import { createIncident, getDispatcherSettings } from '../lib/events-client.ts';
import type { DispatcherIncident } from '../lib/events-client.ts';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import { parseOperator, OPERATOR_MAX } from '../lib/operator.ts';

const props = defineProps<{
    serverMode:    'detecting' | 'takcad' | 'standalone';
    uid?:          string;
    incidentTypes: IncidentTypeRef[];
    // TAK-CAD mode passes its locally-picked DataSync feed for marker/log routing.
    activeFeed?:   MissionRef | null;
    // Standalone: the incident whose location is being changed. The form then shows the Location
    // block alone, filled with where the incident is now, and hands the new place back (`relocated`).
    relocate?:     DispatcherIncident | null;
}>();

const emit = defineEmits<{
    (e: 'saved',            uid: string):              void;
    // `problems`: what did not go out after the incident was saved (marker, feed log, chat), or ''.
    (e: 'saved-standalone', inc: DispatcherIncident, problems: string): void;
    // The new place for the `relocate` incident.
    (e: 'relocated', to: { address: string; lat: number; lon: number }): void;
    (e: 'cancel'                          ):           void;
}>();

const saving         = ref(false);
const saveError      = ref('');
const showCaller     = ref(false);
const geocoding      = ref(false);
const mapStore       = useMapStore();
const picking        = ref(false);
const geoQuery       = ref('');
const geoSuggestions = ref<GeocodeSuggestion[]>([]);
const geoFailed      = ref(false);
const incidentNumber = ref('');
let geoDebounce: ReturnType<typeof setTimeout>;

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

function onGeoInput() {
    clearTimeout(geoDebounce);
    if (geoQuery.value.length < 4) { geoSuggestions.value = []; return; }
    geoDebounce = setTimeout(doGeocode, 500);
}

// The server asks the public geocoder, so with no internet the search fails. Say so in one line under
// the box and keep the form: a failure thrown from here would replace the whole Dispatcher with the error
// (CadMain's onErrorCaptured) and lose what was typed.
async function doGeocode() {
    if (!geoQuery.value.trim()) return;
    geocoding.value = true;
    try {
        geoSuggestions.value = await geocodeAddress(geoQuery.value);
        geoFailed.value = false;
    } catch (e) {
        geoSuggestions.value = [];
        geoFailed.value = true;
        console.warn('[dispatcher] address search failed', e);
    } finally {
        geocoding.value = false;
    }
}

function applySuggestion(s: GeocodeSuggestion) {
    form.lat        = s.lat;
    form.lon        = s.lon;
    form.streetName = s.streetName;
    form.city       = s.city;
    form.state      = s.state;
    form.zipCode    = s.zipCode;
    form.country    = s.country;
    geoSuggestions.value = [];
    geoQuery.value = s.label;
}

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
        try {
            const s = await reverseGeocode(form.lat, form.lon);
            if (s) {
                form.streetName = s.streetName;
                form.city       = s.city;
                form.state      = s.state;
                form.zipCode    = s.zipCode;
                form.country    = s.country;
                geoQuery.value  = s.label;
                // Fallback: parse label if fields are missing (ORS data gaps)
                if ((!form.city || !form.state) && s.label) {
                    const parts = s.label.split(',').map((p: string) => p.trim());
                    if (!form.streetName && parts[0]) form.streetName = parts[0];
                    if (!form.city && parts[1])        form.city       = parts[1];
                    if (parts[2]) {
                        const sv = parts[2].split(' ').filter(Boolean);
                        if (!form.state   && sv[0]) form.state   = sv[0];
                        if (!form.zipCode && sv[1]) form.zipCode = sv[1];
                    }
                }
            }
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
    }

    // TAK-CAD mode pre-generates a number from the feed's mission log. Standalone numbers are
    // assigned by the server on create (returned in the incident row), so we don't pre-gen them.
    if (props.serverMode === 'takcad' && props.activeFeed && !props.uid) {
        try { incidentNumber.value = await getNextIncidentNumber(props.activeFeed); }
        catch { incidentNumber.value = ''; }
    }

    if (props.relocate) {
        const at = props.relocate;
        Object.assign(form, splitAddress(at.address ?? ''), { lat: at.lat, lon: at.lon });
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
});

async function submit() {
    saveError.value = '';
    if (form.lat == null || form.lon == null) {
        saveError.value = 'Coordinates are required — use address search or enter lat/lon.';
        return;
    }
    const address = joinAddress(form.streetName, form.city, form.state);
    if (props.relocate) {
        emit('relocated', { address, lat: form.lat, lon: form.lon });
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
