<template>
    <div class='d-flex flex-column h-100 overflow-hidden'>
        <!-- ── TAK-CAD mode: full server-backed UI ──────────────────────────── -->
        <template v-if='serverMode === "takcad"'>
            <!-- ── Incident List ──────────────────────────────────── -->
            <template v-if='view === "list"'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <div class='d-flex rounded overflow-hidden border flex-grow-1'>
                        <button
                            v-for='t in LIST_TABS'
                            :key='t.key'
                            class='flex-fill btn btn-sm py-1 rounded-0 border-0 small'
                            :class='listTab === t.key ? "bg-primary text-white" : "text-muted"'
                            @click='listTab = t.key'
                        >
                            {{ t.label }} <span
                                class='badge'
                                :class='listTab === t.key ? "bg-warning text-dark" : "text-muted"'
                            >{{ t.key === 'active' ? activeIncidents.length : cancelledIncidents.length }}</span>
                        </button>
                    </div>
                    <button
                        class='btn btn-sm btn-success d-inline-flex align-items-center gap-1'
                        @click='openCreate'
                    >
                        <IconPlus
                            :size='16'
                            stroke='1'
                        />
                        New
                    </button>
                </div>

                <!-- Sort bar -->
                <div class='d-flex px-3 py-1 border-bottom text-muted small flex-shrink-0'>
                    <button
                        v-for='col in SORT_COLS'
                        :key='col.key'
                        class='btn btn-sm btn-link p-0 text-muted small me-3 text-decoration-none'
                        @click='toggleSort(col.key)'
                    >
                        {{ col.label }}
                        <span v-if='sortCol === col.key'>{{ sortAsc ? '↑' : '↓' }}</span>
                    </button>
                    <span
                        class='ms-auto text-muted font-monospace'
                        style='font-size:10px'
                    >{{ lastRefreshed }}</span>
                </div>

                <!-- List -->
                <div class='flex-grow-1 overflow-auto'>
                    <div
                        v-if='loading && !displayedIncidents.length'
                        class='text-center text-muted py-4 small'
                    >
                        <span class='spinner-border spinner-border-sm me-2' />Loading…
                    </div>
                    <div
                        v-else-if='loadError'
                        class='alert alert-danger m-3 py-2 small'
                    >
                        {{ loadError }}
                    </div>
                    <div
                        v-else-if='!displayedIncidents.length'
                        class='text-center text-muted py-4 small'
                    >
                        No incidents
                    </div>
                    <div
                        v-for='inc in displayedIncidents'
                        :key='inc.uid'
                        class='d-flex align-items-start px-3 py-2 border-bottom incident-row'
                        role='button'
                        @click='openDetail(inc.uid)'
                    >
                        <div class='flex-grow-1 overflow-hidden'>
                            <div class='d-flex align-items-center gap-2'>
                                <span class='fw-semibold small text-truncate'>{{ inc.incidentName }}</span>
                                <span
                                    class='badge small'
                                    :class='statusBadge(inc.status)'
                                >{{ inc.status }}</span>
                            </div>
                            <div class='small text-muted text-truncate'>
                                {{ formatAddress(inc.location) }}
                            </div>
                            <div class='d-flex gap-3 small text-muted mt-1'>
                                <span>{{ inc.incidentType ?? '—' }}</span>
                            </div>
                        </div>
                        <div class='text-end ms-2 flex-shrink-0'>
                            <div class='small text-muted'>
                                {{ shortTime(inc.incidentTime) }}
                            </div>
                        </div>
                    </div>
                </div>
            </template>

            <!-- ── Incident Detail ────────────────────────────────── -->
            <template v-else-if='view === "detail" && detailIncident'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        @click='view = "list"'
                    >
                        ← Back
                    </button>
                    <span class='fw-semibold text-truncate flex-grow-1'>{{ detailIncident.incidentName }}</span>
                    <span
                        class='badge'
                        :class='statusBadge(detailIncident.status)'
                    >{{ detailIncident.status }}</span>
                </div>

                <div class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'>
                    <!-- Core info -->
                    <div class='card border'>
                        <div class='card-body py-2 px-3 d-flex flex-column gap-1 small'>
                            <div class='row g-1'>
                                <div class='col-4 text-muted'>
                                    Type
                                </div>
                                <div class='col-8'>
                                    {{ detailIncident.incidentType?.name }}
                                </div>
                                <div class='col-4 text-muted'>
                                    Time
                                </div>
                                <div class='col-8'>
                                    {{ formatTime(detailIncident.incidentTime) }}
                                </div>
                                <div class='col-4 text-muted'>
                                    Location
                                </div>
                                <div class='col-8'>
                                    {{ formatAddress(detailIncident.location) }}
                                </div>
                                <template v-if='detailIncident.location?.coords'>
                                    <div class='col-4 text-muted'>
                                        Coords
                                    </div>
                                    <div
                                        class='col-8 font-monospace text-muted'
                                        style='font-size:11px'
                                    >
                                        {{ detailIncident.location.coords.latitudeDeg.toFixed(6) }},
                                        {{ detailIncident.location.coords.longitudeDeg.toFixed(6) }}
                                    </div>
                                </template>
                                <div class='col-4 text-muted'>
                                    Dispatcher
                                </div>
                                <div class='col-8'>
                                    {{ detailIncident.dispatcher?.name || '—' }}
                                </div>
                                <template v-if='detailIncident.details'>
                                    <div class='col-4 text-muted'>
                                        Details
                                    </div>
                                    <div
                                        class='col-8'
                                        style='white-space:pre-wrap'
                                    >
                                        {{ detailIncident.details }}
                                    </div>
                                </template>
                                <template v-if='detailIncident.firstResponderArrivalTime'>
                                    <div class='col-4 text-muted'>
                                        Arrival
                                    </div>
                                    <div class='col-8'>
                                        {{ formatTime(detailIncident.firstResponderArrivalTime) }}
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>

                    <!-- Caller info -->
                    <template v-if='detailIncident.callerInfo?.length'>
                        <div class='small text-muted fw-semibold text-uppercase'>
                            Caller
                        </div>
                        <div class='card border'>
                            <div class='card-body py-2 px-3 d-flex flex-column gap-1 small'>
                                <div class='row g-1'>
                                    <div class='col-4 text-muted'>
                                        Name
                                    </div>
                                    <div class='col-8'>
                                        {{ detailIncident.callerInfo[0].name || '—' }}
                                    </div>
                                    <div class='col-4 text-muted'>
                                        Phone
                                    </div>
                                    <div class='col-8'>
                                        {{ detailIncident.callerInfo[0].phoneNumber || '—' }}
                                    </div>
                                    <div class='col-4 text-muted'>
                                        Type
                                    </div>
                                    <div class='col-8'>
                                        {{ detailIncident.callerInfo[0].callerInfoType || '—' }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>

                    <!-- Responding vehicles -->
                    <div class='small text-muted fw-semibold text-uppercase d-flex align-items-center'>
                        <span class='me-auto'>Responding Vehicles ({{ detailIncident.vehiclesResponding?.length ?? 0 }})</span>
                        <button
                            class='btn btn-sm btn-outline-warning py-0 px-2'
                            @click='view = "responders"'
                        >
                            Manage
                        </button>
                    </div>
                    <div
                        v-if='detailIncident.vehiclesResponding?.length'
                        class='card border'
                    >
                        <div class='card-body py-1 px-3'>
                            <div
                                v-for='vr in detailIncident.vehiclesResponding'
                                :key='vr.vehicle.vehicleUid'
                                class='d-flex align-items-center py-1 border-bottom border small gap-2'
                            >
                                <span class=''>{{ vr.vehicle.vehicleUid }}</span>
                                <span
                                    v-if='vr.responseStatus'
                                    class='badge bg-secondary'
                                >{{ vr.responseStatus }}</span>
                                <span
                                    v-if='vr.eta'
                                    class='text-muted ms-auto'
                                >ETA {{ vr.eta }}</span>
                            </div>
                        </div>
                    </div>
                    <div
                        v-else
                        class='text-muted small'
                    >
                        No vehicles assigned
                    </div>

                    <!-- Responding personnel -->
                    <div class='small text-muted fw-semibold text-uppercase'>
                        Personnel ({{ detailIncident.personnelResponding?.length ?? 0 }})
                    </div>
                    <div
                        v-if='detailIncident.personnelResponding?.length'
                        class='card border'
                    >
                        <div class='card-body py-1 px-3'>
                            <div
                                v-for='pr in detailIncident.personnelResponding'
                                :key='pr.personUid'
                                class='d-flex align-items-center py-1 border-bottom border small gap-2'
                            >
                                <span class=''>{{ pr.callsign }}</span>
                            </div>
                        </div>
                    </div>
                    <div
                        v-else
                        class='text-muted small'
                    >
                        No personnel assigned
                    </div>

                    <!-- Notes -->
                    <div class='small text-muted fw-semibold text-uppercase'>
                        Notes
                    </div>
                    <div
                        v-if='detailIncident.notes?.length'
                        class='d-flex flex-column gap-1'
                    >
                        <div
                            v-for='note in detailIncident.notes'
                            :key='note.uid'
                            class='card border'
                        >
                            <div class='card-body py-1 px-3 small'>
                                <div class='d-flex align-items-center gap-2 text-muted mb-1'>
                                    <span class='fw-semibold'>{{ note.creator }}</span>
                                    <span>{{ formatTime(note.timestamp) }}</span>
                                    <button
                                        class='btn btn-sm btn-link text-danger py-0 px-1 ms-auto text-decoration-none'
                                        @click='deleteNote(note.uid)'
                                    >
                                        <IconTrash
                                            :size='16'
                                            stroke='1'
                                        />
                                    </button>
                                </div>
                                <div style='white-space:pre-wrap'>
                                    {{ note.info }}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class='input-group'>
                        <input
                            v-model='newNote'
                            type='text'
                            class='form-control form-control-sm border'
                            placeholder='Add a note…'
                            @keyup.enter='addNote'
                        >
                        <button
                            class='btn btn-sm btn-secondary'
                            :disabled='!newNote.trim()'
                            @click='addNote'
                        >
                            Add
                        </button>
                    </div>

                    <!-- Actions -->
                    <div
                        v-if='detailError'
                        class='alert alert-danger py-2 small'
                    >
                        {{ detailError }}
                    </div>
                    <div class='d-flex gap-2 flex-wrap'>
                        <button
                            class='btn btn-sm btn-outline-warning'
                            @click='openEdit'
                        >
                            Edit
                        </button>
                        <button
                            v-if='isActive(detailIncident.status)'
                            class='btn btn-sm btn-outline-secondary'
                            :disabled='saving'
                            @click='closeIncident'
                        >
                            <span
                                v-if='saving'
                                class='spinner-border spinner-border-sm me-1'
                            />Close Incident
                        </button>
                        <button
                            class='btn btn-sm btn-outline-danger ms-auto'
                            :disabled='saving'
                            @click='confirmDelete'
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </template>

            <!-- ── Responder Manager ───────────────────────────────── -->
            <template v-else-if='view === "responders" && detailIncident'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        @click='view = "detail"'
                    >
                        ← Back
                    </button>
                    <span class='fw-semibold'>Assign Responders</span>
                </div>
                <div class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'>
                    <!-- Vehicles -->
                    <div class='small text-muted fw-semibold text-uppercase'>
                        Vehicles
                    </div>
                    <div
                        v-for='veh in vehicles'
                        :key='veh.uid'
                        class='d-flex align-items-center gap-2 py-1 border-bottom border small'
                    >
                        <input
                            type='checkbox'
                            :checked='isVehicleAssigned(veh.uid)'
                            class='form-check-input mt-0'
                            @change='toggleVehicle(veh.uid)'
                        >
                        <span class=''>{{ veh.callsign }}</span>
                        <span
                            v-if='veh.vehicleType'
                            class='text-muted'
                        >{{ veh.vehicleType.name }}</span>
                        <span
                            v-if='veh.incidentsRequestingThisVehicle?.length'
                            class='ms-auto badge bg-warning text-dark small'
                        >{{ veh.incidentsRequestingThisVehicle.length }} inc</span>
                    </div>
                    <div
                        v-if='!vehicles.length'
                        class='text-muted small'
                    >
                        No vehicles registered
                    </div>

                    <!-- Personnel -->
                    <div class='small text-muted fw-semibold text-uppercase'>
                        Personnel
                    </div>
                    <div
                        v-for='person in personnel'
                        :key='person.uid'
                        class='d-flex align-items-center gap-2 py-1 border-bottom border small'
                    >
                        <input
                            type='checkbox'
                            :checked='isPersonnelAssigned(person.uid)'
                            class='form-check-input mt-0'
                            @change='togglePersonnel(person.uid, person.callsign)'
                        >
                        <span class=''>{{ person.callsign }}</span>
                        <span
                            v-if='person.roles?.length'
                            class='text-muted'
                        >{{ person.roles.map(r => r.name).join(', ') }}</span>
                    </div>
                    <div
                        v-if='!personnel.length'
                        class='text-muted small'
                    >
                        No personnel registered
                    </div>

                    <div
                        v-if='detailError'
                        class='alert alert-danger py-2 small'
                    >
                        {{ detailError }}
                    </div>
                    <button
                        class='btn btn-sm btn-warning'
                        :disabled='saving'
                        @click='saveResponders'
                    >
                        <span
                            v-if='saving'
                            class='spinner-border spinner-border-sm me-1'
                        />Save Assignments
                    </button>
                </div>
            </template>

            <!-- ── Incident Form (takcad) ─────────────────────────── -->
            <template v-else-if='view === "form"'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        @click='cancelForm'
                    >
                        ← Back
                    </button>
                    <span class='fw-semibold'>{{ editUid ? 'Edit Incident' : 'New Incident' }}</span>
                </div>
                <div class='flex-grow-1 overflow-auto p-3'>
                    <IncidentForm
                        :uid='editUid'
                        :server-mode='serverMode'
                        :incident-types='incidentTypes'
                        :active-feed='takcadFeed'
                        @saved='onFormSaved'
                        @cancel='cancelForm'
                    />
                </div>
            </template>
        </template>

        <!-- ── Standalone mode: server-backed Event board ──────────────────── -->
        <template v-else-if='serverMode === "standalone"'>
            <!-- Event gate (CadMain normally keeps the Events screen up until one is open) -->
            <div
                v-if='!dispatcherStore.activeEvent'
                class='text-center text-muted py-4 small px-3'
            >
                Open an Event to begin dispatching.
            </div>

            <!-- Standalone incident list -->
            <template v-else-if='slView === "list"'>
                <!-- The tabs sit on the same band as the "Incidents" title above them (CadMain), so they read as kinds
                     of incident; the buttons themselves are the Dispatcher's usual dark ones. -->
                <div
                    class='d-flex align-items-center px-3 pt-1 pb-2 border-bottom flex-shrink-0 gap-2'
                    style='background:var(--tblr-bg-surface, #1f2937)'
                    data-test='incident-tabs'
                >
                    <div
                        class='d-flex rounded overflow-hidden border flex-grow-1'
                        style='background:var(--tblr-body-bg, #111827)'
                    >
                        <button
                            v-for='t in SL_TABS'
                            :key='t.key'
                            class='flex-fill btn btn-sm py-1 rounded-0 border-0 small'
                            :class='slTab === t.key ? "bg-primary text-white" : "text-muted"'
                            :data-test='`tab-${t.key}`'
                            @click='slTab = t.key'
                        >
                            {{ t.label }} <span
                                class='badge'
                                :class='slTab === t.key ? "text-white" : "text-muted"'
                                style='background:rgba(127, 127, 127, 0.25)'
                            >{{ slTabCount(t.key) }}</span>
                        </button>
                    </div>
                    <!-- Create is green, as CloudTAK's own create / subscribe buttons are -->
                    <button
                        class='btn btn-sm btn-success d-inline-flex align-items-center gap-1 text-nowrap'
                        data-test='new-incident'
                        @click='slNewIncident()'
                    >
                        <IconPlus
                            :size='16'
                            stroke='1'
                        />
                        New
                    </button>
                </div>
                <!-- The last new incident was saved, but its marker, feed log or chat did not go out (IncidentForm) -->
                <div
                    v-if='slCreateProblem'
                    class='px-3 py-1 border-bottom flex-shrink-0 small text-warning d-flex align-items-start gap-2'
                    data-test='create-problem'
                >
                    <span class='flex-grow-1'>{{ slCreateProblem }}</span>
                    <button
                        class='btn btn-link btn-sm p-0 text-muted text-decoration-none'
                        title='Dismiss'
                        aria-label='Dismiss'
                        @click='slCreateProblem = ""'
                    >
                        <IconX
                            :size='16'
                            stroke='1'
                        />
                    </button>
                </div>
                <!-- Undocked cards open over the map (opened with Undock on an incident) -->
                <div
                    v-if='dispatcherStore.undocked.length'
                    class='px-3 py-1 border-bottom flex-shrink-0 small text-muted d-flex align-items-center gap-2'
                    data-test='undocked-row'
                >
                    <IconPictureInPictureOn
                        :size='14'
                        stroke='1'
                    />
                    <span class='flex-grow-1'>{{ dispatcherStore.undocked.length }} undocked</span>
                    <button
                        class='btn btn-link btn-sm p-0 text-decoration-none'
                        @click='closeAllUndocked()'
                    >
                        Close all
                    </button>
                </div>
                <!-- Multi-Monitor Mode: the browser refused the workspace window, so things opened over the map -->
                <div
                    v-if='dispatcherStore.windowBlocked'
                    class='px-3 py-1 border-bottom flex-shrink-0 small text-warning d-flex align-items-start gap-2'
                    data-test='window-blocked'
                >
                    <span class='flex-grow-1'>
                        The browser blocked the Dispatcher workspace window, so this opened over the map instead.
                        Allow pop-ups for this site (the icon at the right of the address bar) to use the workspace.
                    </span>
                    <button
                        class='btn btn-link btn-sm p-0 text-muted text-decoration-none'
                        title='Dismiss'
                        aria-label='Dismiss'
                        @click='dispatcherStore.windowBlocked = false'
                    >
                        <IconX
                            :size='16'
                            stroke='1'
                        />
                    </button>
                </div>
                <div class='flex-grow-1 overflow-auto'>
                    <div
                        v-if='!slDisplayedIncidents.length'
                        class='text-center text-muted py-4 small'
                    >
                        No {{ slTab }} incidents
                    </div>
                    <IncidentRow
                        v-for='inc in slDisplayedIncidents'
                        :key='inc.id'
                        :inc='inc'
                        @open='slOpenDetail'
                    />
                </div>
            </template>

            <!-- Standalone incident detail -->
            <!-- Standalone incident detail (shared with undocked cards: IncidentDetail.vue) -->
            <template v-else-if='slView === "detail" && slDetailId'>
                <!-- A new incident opens here, so what did not go out for it is said here too -->
                <div
                    v-if='slCreateProblem'
                    class='px-3 py-1 border-bottom flex-shrink-0 small text-warning d-flex align-items-start gap-2'
                    data-test='create-problem'
                >
                    <span class='flex-grow-1'>{{ slCreateProblem }}</span>
                    <button
                        class='btn btn-link btn-sm p-0 text-muted text-decoration-none'
                        title='Dismiss'
                        aria-label='Dismiss'
                        @click='slCreateProblem = ""'
                    >
                        <IconX
                            :size='16'
                            stroke='1'
                        />
                    </button>
                </div>
                <IncidentDetail
                    :key='slDetailId'
                    :incident-id='slDetailId'
                    @back='slView = "list"'
                    @undock='slUndock(slDetailId)'
                    @closed='slView = "list"'
                    @reopened='slShowTabFor(slDetailId)'
                />
            </template>

            <!-- Standalone incident form -->
            <template v-else-if='slView === "form"'>
                <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        @click='slView = "list"'
                    >
                        ← Back
                    </button>
                    <span class='fw-semibold'>New Incident</span>
                </div>
                <div class='flex-grow-1 overflow-auto p-3'>
                    <IncidentForm
                        :server-mode='serverMode'
                        :incident-types='incidentTypes'
                        :prefill='slPrefill'
                        @saved-standalone='onStandaloneSaved'
                        @cancel='slView = "list"'
                    />
                </div>
            </template>
        </template>

        <!-- ── Detecting state ─────────────────────────────────────────────── -->
        <template v-else>
            <div class='text-center text-muted py-4 small'>
                <span class='spinner-border spinner-border-sm me-2' />Connecting…
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { IconPictureInPictureOn, IconPlus, IconX, IconTrash } from '@tabler/icons-vue';
import IncidentForm from './IncidentForm.vue';
import IncidentDetail from './IncidentDetail.vue';
import IncidentRow from './IncidentRow.vue';
import {
    getIncidentMetadata, getIncident,
    updateIncident, deleteIncident,
    insertVehicleResponse, deleteVehicleResponse,
} from '../lib/takcad-client.ts';
import type { VehicleResponseMetadata } from '../lib/takcad-client.ts';
import type { IncidentMetadata, IncidentRef, VehicleRef, PersonRef, IncidentTypeRef, PersonCallsign } from '../lib/takcad-types.ts';
import { isActive, formatAddress, formatTime, STATUS_CANCELLED } from '../lib/takcad-types.ts';
import type { MissionRef } from '../lib/takcad-client.ts';
import type { DispatcherIncident } from '../lib/events-client.ts';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import { acquireIncidentPoll, restartIncidentPoll } from '../lib/incident-poll.ts';
import { undockIncident, closeAllUndocked, restoreUndocked } from '../lib/undock-panes.ts';
import { incidentQueue } from '../lib/unit-status.ts';
import type { IncidentQueue } from '../lib/unit-status.ts';
import { registerList, workOn } from '../lib/command-state.ts';
import type { NewIncidentPrefill } from '../lib/command-state.ts';

const props = defineProps<{
    serverMode:    'detecting' | 'takcad' | 'standalone';
    incidentTypes: IncidentTypeRef[];
    vehicles:      VehicleRef[];
    personnel:     PersonRef[];
    takcadFeed?:   MissionRef | null;
}>();

const emit = defineEmits<{
    (e: 'status', s: string): void;
}>();

// ── TAK-CAD mode state ────────────────────────────────────────────────────────
type ViewName = 'list' | 'detail' | 'form' | 'responders';
type ListTab  = 'active' | 'cancelled';

const SORT_COLS = [
    { key: 'time',    label: 'Time'    },
    { key: 'address', label: 'Address' },
    { key: 'type',    label: 'Type'    },
] as const;
type SortCol = typeof SORT_COLS[number]['key'];

const LIST_TABS = [
    { key: 'active',    label: 'Active'    },
    { key: 'cancelled', label: 'Cancelled' },
] as const;

const view           = ref<ViewName>('list');
const listTab        = ref<ListTab>('active');
const incidents      = ref<IncidentMetadata[]>([]);
const detailIncident = ref<IncidentRef | null>(null);
const loading        = ref(false);
const loadError      = ref('');
const detailError    = ref('');
const saving         = ref(false);
const editUid        = ref<string | undefined>(undefined);
const newNote        = ref('');
const lastRefreshed  = ref('');
const sortCol        = ref<SortCol>('time');
const sortAsc        = ref(false);

const pendingVehicleUids    = ref<string[]>([]);
const vehicleResponseUids   = ref<Map<string, string>>(new Map());
const pendingPersonnelItems = ref<PersonCallsign[]>([]);

const activeIncidents    = computed(() => incidents.value.filter(i => isActive(i.status)));
const cancelledIncidents = computed(() => incidents.value.filter(i => !isActive(i.status)));

const displayedIncidents = computed(() => {
    const src = listTab.value === 'active' ? activeIncidents.value : cancelledIncidents.value;
    return [...src].sort((a, b) => {
        let av = '', bv = '';
        if (sortCol.value === 'time')    { av = a.incidentTime; bv = b.incidentTime; }
        if (sortCol.value === 'address') { av = formatAddress(a.location); bv = formatAddress(b.location); }
        if (sortCol.value === 'type')    { av = a.incidentType ?? ''; bv = b.incidentType ?? ''; }
        return sortAsc.value ? av.localeCompare(bv) : bv.localeCompare(av);
    });
});

function toggleSort(col: SortCol) {
    if (sortCol.value === col) sortAsc.value = !sortAsc.value;
    else { sortCol.value = col; sortAsc.value = col !== 'time'; }
}

function statusBadge(status: string) {
    if (status === 'ACTIVE')    return 'bg-success text-white';
    if (status === 'CANCELLED') return 'bg-secondary text-white';
    return 'bg-warning text-dark';
}

function shortTime(iso: string): string {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
}

async function loadList() {
    loading.value = true; loadError.value = '';
    try {
        incidents.value = await getIncidentMetadata();
        lastRefreshed.value = new Date().toLocaleTimeString();
        emit('status', '');
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        loadError.value = msg;
        emit('status', 'Error');
    } finally {
        loading.value = false;
    }
}

async function openDetail(uid: string) {
    detailError.value = '';
    view.value = 'detail';
    try { detailIncident.value = await getIncident(uid); }
    catch (e) { detailError.value = e instanceof Error ? e.message : String(e); }
}

function openCreate() { editUid.value = undefined; view.value = 'form'; }
function openEdit()   { if (!detailIncident.value) return; editUid.value = detailIncident.value.uid; view.value = 'form'; }
function cancelForm() { view.value = detailIncident.value ? 'detail' : 'list'; }

async function onFormSaved(uid: string) {
    await openDetail(uid);
    await loadList();
}

async function closeIncident() {
    if (!detailIncident.value) return;
    saving.value = true; detailError.value = '';
    try {
        const updated = { ...detailIncident.value, status: STATUS_CANCELLED };
        await updateIncident(updated);
        const check = await getIncident(detailIncident.value.uid);
        if (isActive(check.status)) {
            detailError.value = 'The TAK-CAD server accepted the update but didn\'t change the status — cancelling incidents isn\'t supported by this server build.';
        } else {
            detailIncident.value = check;
            await loadList();
        }
    } catch (e) {
        detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

async function confirmDelete() {
    if (!detailIncident.value) return;
    if (!confirm(`Delete incident "${detailIncident.value.incidentName}"?`)) return;
    saving.value = true; detailError.value = '';
    try {
        await deleteIncident(detailIncident.value.uid);
        view.value = 'list';
        detailIncident.value = null;
        await loadList();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        detailError.value = msg.includes('PluginManager process')
            ? 'Delete isn\'t supported by the TAK Server plugin on this build. Use "Close Incident" to cancel it instead.'
            : msg;
    } finally {
        saving.value = false;
    }
}

async function addNote() {
    if (!detailIncident.value || !newNote.value.trim()) return;
    const note = {
        uid:         crypto.randomUUID(),
        info:        newNote.value.trim(),
        creator:     'Dispatcher',
        incidentUid: detailIncident.value.uid,
        timestamp:   new Date().toISOString(),
    };
    const updated = { ...detailIncident.value, notes: [...(detailIncident.value.notes ?? []), note] };
    saving.value = true; detailError.value = '';
    try {
        await updateIncident(updated);
        detailIncident.value = updated;
        newNote.value = '';
    } catch (e) {
        detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

async function deleteNote(noteUid: string) {
    if (!detailIncident.value) return;
    const updated = { ...detailIncident.value, notes: detailIncident.value.notes.filter(n => n.uid !== noteUid) };
    saving.value = true; detailError.value = '';
    try {
        await updateIncident(updated);
        detailIncident.value = updated;
    } catch (e) {
        detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

watch(view, (v) => {
    if (v === 'responders' && detailIncident.value) {
        const resMap = new Map<string, string>();
        (detailIncident.value.vehiclesResponding ?? []).forEach(vr => {
            resMap.set(vr.vehicle.vehicleUid, vr.uid);
        });
        vehicleResponseUids.value   = resMap;
        pendingVehicleUids.value    = [...resMap.keys()];
        pendingPersonnelItems.value = [...(detailIncident.value.personnelResponding ?? [])];
    }
});

function isVehicleAssigned(uid: string)   { return pendingVehicleUids.value.includes(uid); }
function isPersonnelAssigned(uid: string) { return pendingPersonnelItems.value.some(p => p.personUid === uid); }

function toggleVehicle(uid: string) {
    if (isVehicleAssigned(uid)) pendingVehicleUids.value = pendingVehicleUids.value.filter(u => u !== uid);
    else pendingVehicleUids.value = [...pendingVehicleUids.value, uid];
}

function togglePersonnel(uid: string, callsign: string) {
    if (isPersonnelAssigned(uid)) pendingPersonnelItems.value = pendingPersonnelItems.value.filter(p => p.personUid !== uid);
    else pendingPersonnelItems.value = [...pendingPersonnelItems.value, { personUid: uid, callsign }];
}

async function saveResponders() {
    if (!detailIncident.value) return;
    saving.value = true; detailError.value = '';
    const incidentUid = detailIncident.value.uid;
    const prevUids    = [...vehicleResponseUids.value.keys()];
    const toAdd       = pendingVehicleUids.value.filter(uid => !prevUids.includes(uid));
    const toRemove    = prevUids.filter(uid => !pendingVehicleUids.value.includes(uid));
    try {
        for (const vehUid of toRemove) {
            const respUid = vehicleResponseUids.value.get(vehUid);
            if (respUid) await deleteVehicleResponse(respUid);
        }
        for (const vehUid of toAdd) {
            const veh = props.vehicles.find(v => v.uid === vehUid);
            const meta: VehicleResponseMetadata = {
                uid:            crypto.randomUUID(),
                callsign:       veh?.callsign ?? '',
                vehicleUid:     vehUid,
                incidentUid,
                responseStatus: 'IN_ROUTE',
                eta:            null,
                arrivalTime:    null,
            };
            await insertVehicleResponse(meta);
        }
        detailIncident.value = await getIncident(incidentUid);
        view.value = 'detail';
    } catch (e) {
        detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

async function refreshDetail() {
    if (detailIncident.value && view.value === 'detail') {
        try { detailIncident.value = await getIncident(detailIncident.value.uid); }
        catch { /* stale display ok */ }
    }
}

// ── Standalone mode state (server-backed Event board) ─────────────────────────
type SlViewName = 'list' | 'detail' | 'form';
type SlTab      = IncidentQueue;

// Single Monitor Mode: Active (every open incident) and Closed, as always. Multi-Monitor Mode adds
// Unassigned (open, no unit on it) to the left, and Active becomes the open incidents with a unit.
const splitUnassigned = computed(() => dispatcherStore.displayMode === 'multi');
const SL_TABS = computed<{ key: SlTab; label: string }[]>(() => [
    ...(splitUnassigned.value ? [{ key: 'unassigned' as const, label: 'Unassigned' }] : []),
    { key: 'active', label: 'Active' },
    { key: 'closed', label: 'Closed' },
]);

const slView            = ref<SlViewName>('list');
const slTab             = ref<SlTab>('active');
// The incident open in the panel's detail view (IncidentDetail reads it from the store by id).
const slDetailId        = ref<string | null>(null);
// What did not go out for the last new incident (its marker, feed log or chat), shown on the list.
const slCreateProblem   = ref('');

const slQueued = computed(() => {
    const out: Record<SlTab, DispatcherIncident[]> = { unassigned: [], active: [], closed: [] };
    for (const inc of dispatcherStore.incidents) out[incidentQueue(inc, splitUnassigned.value)].push(inc);
    return out;
});
const slDisplayedIncidents = computed(() => slQueued.value[slTab.value]);

function slTabCount(key: SlTab): number {
    return slQueued.value[key].length;
}

// After a reopen or a new incident, show the tab it is in now (a reopened or new incident has no unit, so
// in Multi-Monitor Mode that is Unassigned).
function slShowTabFor(id: string | null) {
    const inc = id ? dispatcherStore.incidents.find(i => i.id === id) : undefined;
    slTab.value = inc ? incidentQueue(inc, splitUnassigned.value) : 'active';
}

// Back in Single Monitor Mode there is no Unassigned tab.
watch(splitUnassigned, (split) => {
    if (!split && slTab.value === 'unassigned') slTab.value = 'active';
});

// New: the empty form, or (from the command line's N) one with the type set and the address searched.
const slPrefill = ref<NewIncidentPrefill | null>(null);
function slNewIncident(prefill: NewIncidentPrefill | null = null) {
    slPrefill.value = prefill;
    slView.value = 'form';
}

// The command line (CommandLine.vue) opens incidents, tabs and the New form through these.
let leaveCommandLine: (() => void) | undefined;
onMounted(() => {
    leaveCommandLine = registerList({
        view:        () => slView.value,
        detailId:    () => (slView.value === 'detail' ? slDetailId.value : null),
        open:        slOpenDetail,
        list:        (tab) => { if (tab) slTab.value = tab; slView.value = 'list'; },
        newIncident: slNewIncident,
    });
});
onUnmounted(() => leaveCommandLine?.());

function slOpenDetail(id: string) {
    slDetailId.value = id;
    slView.value = 'detail';
}

// Undock: the incident moves into its own floating card over the map; the panel shows the list.
function slUndock(id: string) {
    workOn(id);   // the dispatcher is working this incident: its window stays the command line's incident
    undockIncident(id);
    slDetailId.value = null;
    slView.value = 'list';
}

// A new incident opens straight away: whoever took the call usually keeps adding to it. It is saved before
// its marker, feed log and chat go out; when one of those fails, the incident and the list say so, until
// dismissed or the next new incident. Back goes to the tab the incident is in.
function onStandaloneSaved(inc: DispatcherIncident, problems: string) {
    const idx = dispatcherStore.incidents.findIndex(i => i.id === inc.id);
    if (idx === -1) dispatcherStore.incidents.push(inc);
    slCreateProblem.value = problems ? `${inc.number} was created, but: ${problems}` : '';
    slShowTabFor(inc.id);
    slOpenDetail(inc.id);
}

// ── Polling ───────────────────────────────────────────────────────────────────
let pollTimer: ReturnType<typeof setInterval>;
// Standalone: the shared 15s poll (incident-poll.ts), held while this list is mounted and by
// every undocked card, so multiple dispatchers converge and cards stay live on their own.
let releasePoll: (() => void) | undefined;
// One-shot watch that restores the saved cards once the board's incidents arrive; kept so it is
// stopped on unmount or when the Event changes (it can be created outside setup, from a watcher).
let stopRestoreWatch: (() => void) | undefined;

function startTakcadPoll() {
    loadList();
    pollTimer = setInterval(() => { loadList(); refreshDetail(); }, 15_000);
}

function startStandalonePoll() {
    releasePoll?.();
    releasePoll = acquireIncidentPoll();
    // Reopen the cards that were undocked for this Event before a reload, once the board is in.
    stopRestoreWatch?.();
    stopRestoreWatch = undefined;
    if (dispatcherStore.incidents.length) restoreUndocked();
    else stopRestoreWatch = watch(() => dispatcherStore.incidents, () => restoreUndocked(), { once: true });
}

onMounted(() => {
    if (props.serverMode === 'takcad') startTakcadPoll();
    else if (props.serverMode === 'standalone' && dispatcherStore.activeEvent) startStandalonePoll();
});

onUnmounted(() => {
    clearInterval(pollTimer);
    releasePoll?.();
    stopRestoreWatch?.();
});

// Start polling when mode resolves
watch(() => props.serverMode, (mode) => {
    if (pollTimer || releasePoll) return;
    if (mode === 'takcad') startTakcadPoll();
    else if (mode === 'standalone' && dispatcherStore.activeEvent) startStandalonePoll();
});

// Restart the standalone poll when an Event is opened/changed.
watch(() => dispatcherStore.activeEvent?.id, (id) => {
    if (props.serverMode !== 'standalone') return;
    slView.value = 'list';
    slDetailId.value = null;
    slCreateProblem.value = '';
    stopRestoreWatch?.();
    stopRestoreWatch = undefined;
    restartIncidentPoll();
    if (id) startStandalonePoll();
});
</script>

<style scoped>
.incident-row:hover { background: rgba(255,255,255,.05); cursor: pointer; }
</style>
