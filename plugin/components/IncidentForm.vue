<template>
    <form
        class='d-flex flex-column gap-3'
        @submit.prevent='submit'
    >
        <!-- Incident Number (auto, read-only) -->
        <div v-if='incidentNumber'>
            <label class='form-label small text-muted mb-1'>Incident #</label>
            <input
                :value='incidentNumber'
                type='text'
                readonly
                class='form-control form-control-sm border bg-transparent text-warning fw-semibold'
            >
        </div>

        <!-- Type — shared dropdown in both modes -->
        <div>
            <label class='form-label small text-muted mb-1'>Incident Type <span class='text-danger'>*</span>
                <button
                    v-if='serverMode === "standalone"'
                    class='btn btn-sm btn-link p-0 ms-2 text-decoration-none small'
                    type='button'
                    @click='showTypeEditor = !showTypeEditor'
                >
                    {{ showTypeEditor ? 'done' : 'manage' }}
                </button>
            </label>
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
            <!-- Custom call types: shared per-CloudTAK (dispatcher_settings), merged with defaults -->
            <div
                v-if='showTypeEditor'
                class='border rounded mt-1 p-2 d-flex flex-column gap-1'
            >
                <div class='d-flex flex-wrap gap-1'>
                    <span
                        v-for='t in customTypes'
                        :key='t'
                        class='badge bg-secondary text-white d-flex align-items-center gap-1'
                    >
                        {{ t }}
                        <button
                            class='btn btn-link p-0 text-white text-decoration-none'
                            style='font-size:10px;line-height:1'
                            type='button'
                            title='Remove custom type'
                            @click='removeCustomType(t)'
                        >
                            ✕
                        </button>
                    </span>
                    <span
                        v-if='!customTypes.length'
                        class='text-muted small'
                    >No custom call types yet</span>
                </div>
                <div class='d-flex gap-1'>
                    <input
                        v-model='newTypeName'
                        type='text'
                        class='form-control form-control-sm border flex-grow-1'
                        placeholder='Add call type…'
                        @keyup.enter='addCustomType'
                    >
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        type='button'
                        :disabled='!newTypeName.trim() || savingTypes'
                        @click='addCustomType'
                    >
                        Add
                    </button>
                </div>
                <div
                    v-if='typeEditorError'
                    class='text-danger small'
                >
                    {{ typeEditorError }}
                </div>
                <div class='text-muted small'>
                    Shared with every dispatcher on this CloudTAK.
                </div>
            </div>
        </div>

        <!-- Date/Time -->
        <div>
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
            <label class='form-label small text-muted mb-1'>Location <span class='text-danger'>*</span></label>
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
        <div>
            <label class='form-label small text-muted mb-1'>Details</label>
            <textarea
                v-model='form.details'
                rows='3'
                class='form-control form-control-sm border'
                placeholder='Incident notes…'
            />
        </div>

        <!-- Caller Info (takcad only, collapsible) -->
        <div v-if='serverMode === "takcad"'>
            <button
                type='button'
                class='btn btn-sm btn-link text-muted p-0 text-decoration-none'
                @click='showCaller = !showCaller'
            >
                {{ showCaller ? '▾' : '▸' }} Caller Info
            </button>
            <div
                v-if='showCaller'
                class='mt-2 d-flex flex-column gap-2'
            >
                <input
                    v-model='form.callerName'
                    type='text'
                    class='form-control form-control-sm border'
                    placeholder='Caller name'
                >
                <input
                    v-model='form.callerPhone'
                    type='tel'
                    class='form-control form-control-sm border'
                    placeholder='Phone number'
                >
                <select
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
                {{ uid ? 'Save Changes' : 'Create Incident' }}
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
import { ref, reactive, computed, onMounted } from 'vue';
import { useMapStore } from '../../../src/stores/map.ts';
import {
    getIncident, insertIncident, updateIncident,
    geocodeAddress, reverseGeocode,
    getNextIncidentNumber,
    DEFAULT_INCIDENT_TYPES,
} from '../lib/takcad-client.ts';
import type { GeocodeSuggestion, MissionRef } from '../lib/takcad-client.ts';
import type { IncidentRef, IncidentTypeRef } from '../lib/takcad-types.ts';
import { STATUS_ACTIVE } from '../lib/takcad-types.ts';
import { dropIncidentMarker, postMissionCallLog, postFeedChat } from '../lib/map-marker.ts';
import { createIncident, getDispatcherSettings, putDispatcherSetting } from '../lib/events-client.ts';
import type { DispatcherIncident } from '../lib/events-client.ts';
import { dispatcherStore } from '../lib/dispatcher-store.ts';

const props = defineProps<{
    serverMode:    'detecting' | 'takcad' | 'standalone';
    uid?:          string;
    incidentTypes: IncidentTypeRef[];
    // TAK-CAD mode passes its locally-picked DataSync feed for marker/log routing.
    activeFeed?:   MissionRef | null;
}>();

const emit = defineEmits<{
    (e: 'saved',            uid: string):              void;
    (e: 'saved-standalone', inc: DispatcherIncident): void;
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
const incidentNumber = ref('');
let geoDebounce: ReturnType<typeof setTimeout>;

// Shared type list: TAK-CAD server types (names only) or default list
// Custom call types (standalone only): deployment-shared via dispatcher_settings,
// merged over the built-in defaults. TAK-CAD mode keeps its server-provided list.
const customTypes     = ref<string[]>([]);
const showTypeEditor  = ref(false);
const newTypeName     = ref('');
const savingTypes     = ref(false);
const typeEditorError = ref('');

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

async function addCustomType() {
    const name = newTypeName.value.trim();
    if (!name) return;
    typeEditorError.value = '';
    if (typeOptions.value.some(t => t.toLowerCase() === name.toLowerCase())) {
        typeEditorError.value = 'That call type already exists';
        return;
    }
    savingTypes.value = true;
    const prev = customTypes.value;
    try {
        customTypes.value = [...prev, name];
        await putDispatcherSetting('incident_types', customTypes.value);
        newTypeName.value = '';
        form.incidentType = name;
    } catch (e) {
        customTypes.value = prev;
        typeEditorError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingTypes.value = false;
    }
}

async function removeCustomType(name: string) {
    typeEditorError.value = '';
    savingTypes.value = true;
    const prev = customTypes.value;
    try {
        customTypes.value = prev.filter(t => t !== name);
        await putDispatcherSetting('incident_types', customTypes.value);
        if (form.incidentType === name) form.incidentType = '';
    } catch (e) {
        customTypes.value = prev;
        typeEditorError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingTypes.value = false;
    }
}

const form = reactive({
    incidentType:      '',
    incidentTimeLocal: toLocalInput(new Date().toISOString()),
    streetName: '', city: '', state: '', zipCode: '', country: '',
    lat:        null as number | null,
    lon:        null as number | null,
    details:    '',
    callerName:  '',
    callerPhone: '',
    callerType:  '',
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

async function doGeocode() {
    if (!geoQuery.value.trim()) return;
    geocoding.value = true;
    try { geoSuggestions.value = await geocodeAddress(geoQuery.value); }
    finally { geocoding.value = false; }
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
        }).catch(() => { /* defaults only */ });
    }

    // TAK-CAD mode pre-generates a number from the feed's mission log. Standalone numbers are
    // assigned by the server on create (returned in the incident row), so we don't pre-gen them.
    if (props.serverMode === 'takcad' && props.activeFeed && !props.uid) {
        try { incidentNumber.value = await getNextIncidentNumber(props.activeFeed); }
        catch { incidentNumber.value = ''; }
    }

    if (props.uid && props.serverMode === 'takcad') {
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
    const address = [form.streetName, form.city, form.state].filter(Boolean).join(', ');
    if (props.serverMode === 'standalone') {
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
            details:    form.details,
        });

        // CoT marker + DataSync log/chat (best-effort; the record already exists server-side).
        const markerErrors: string[] = [];
        try {
            await dropIncidentMarker(mapStore, {
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
                feedGuid:   event.feed_guid,
            });
        } catch (e) {
            markerErrors.push(`Marker failed — subscribe to the "${event.feed_name}" DataSync feed in CloudTAK first`);
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
        if (markerErrors.length) {
            saveError.value = markerErrors.join(' · ');
        }

        emit('saved-standalone', incident);
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
