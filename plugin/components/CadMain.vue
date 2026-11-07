<template>
    <div class='d-flex flex-column h-100 overflow-hidden'>

        <!-- Detached: this (anchored) instance collapses so the board isn't mounted twice -->
        <div
            v-if='floatedElsewhere'
            class='p-3 text-center text-muted small d-flex flex-column align-items-center gap-2'
        >
            <span>{{ store.floatingWindow ? 'Dispatcher is open in its workspace window.' : 'Dispatcher is floating over the map.' }}</span>
            <button
                v-if='store.floatingWindow'
                class='btn btn-sm btn-outline-secondary'
                @click='focusWorkspace()'
            >
                Show workspace
            </button>
            <button
                class='btn btn-sm btn-outline-warning'
                @click='dockDispatcher()'
            >
                Dock back to panel
            </button>
        </div>

        <div
            v-else-if='setupError'
            class='alert alert-danger m-2 small'
            style='white-space:pre-wrap;font-family:monospace;font-size:10px;overflow:auto'
        >
            <div class='fw-bold mb-1'>Dispatcher error:</div>{{ setupError }}
        </div>
        <template v-else>
            <!-- Header: the title, TAK-CAD, Settings, and Pop out (Workspace in Multi-Monitor Mode). Labelled buttons,
                 so nothing is a bare icon to guess at. -->
            <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                <IconHeadset :size='18' class='text-warning' />
                <span class='fw-semibold'>Dispatcher</span>
                <span class='ms-auto' />
                <!-- TAK-CAD connection toggle -->
                <button
                    v-if='store.serverMode === "takcad"'
                    class='badge bg-success text-white small border-0'
                    style='cursor:pointer'
                    title='TAK-CAD connected — click to disconnect'
                    @click='forceStandalone'
                >TAK-CAD ●</button>
                <button
                    v-else-if='store.serverMode === "standalone"'
                    class='badge bg-secondary text-white small border-0'
                    style='cursor:pointer'
                    title='Connect to TAK-CAD'
                    @click='retryDetection'
                >TAK-CAD</button>
                <span
                    v-else
                    class='badge bg-secondary text-white small opacity-50'
                >TAK-CAD…</span>
                <!-- Dispatcher Settings: shared by every event (standalone only; reachable with no event open) -->
                <button
                    v-if='store.serverMode === "standalone"'
                    class='btn btn-sm d-inline-flex align-items-center gap-1 text-nowrap py-0 px-2 small'
                    :class='showSettings ? "btn-warning" : "btn-outline-secondary"'
                    title='Dispatcher Settings, shared by every event'
                    data-test='open-settings'
                    @click='showSettings = !showSettings'
                >
                    <IconSettings
                        :size='14'
                        stroke='1'
                    />
                    Settings
                </button>
                <button
                    v-if='!floating'
                    class='btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1 text-nowrap py-0 px-2 small'
                    :title='store.displayMode === "multi" ? "Open the Dispatcher workspace window, for another monitor" : "Float the Dispatcher over the map"'
                    data-test='pop-out'
                    @click='popOutDispatcher()'
                >
                    <IconPictureInPictureOn
                        :size='14'
                        stroke='1'
                    />
                    {{ store.displayMode === 'multi' ? 'Workspace' : 'Pop out' }}
                </button>
            </div>

            <!-- Who is on this desk: the CloudTAK callsign; with Employee Numbers on and someone signed in, their
                 number sits beside Sign out (signing out ends that number's session at this desk). -->
            <div
                class='px-3 py-1 border-bottom flex-shrink-0 d-flex align-items-center column-gap-2 small'
                data-test='operator-signed-in'
            >
                <span
                    class='text-truncate'
                    :title='`CloudTAK callsign: ${store.dispatcherName}`'
                ><span class='text-muted'>Callsign</span> <span class='fw-semibold'>{{ store.dispatcherName }}</span></span>
                <template v-if='signedIn'>
                    <span class='ms-auto text-nowrap'><span class='text-muted'>Employee</span> <span class='fw-semibold'>#{{ store.operator }}</span></span>
                    <button
                        type='button'
                        class='btn btn-link btn-sm p-0 text-decoration-none text-nowrap'
                        title='Sign out of this desk (shift change). The next person signs in with their number.'
                        @click='signOut'
                    >Sign out</button>
                </template>
            </div>

            <!-- ── Employee Numbers on (Dispatcher Settings), standalone, nobody signed in: the yellow Sign in bar.
                 Never blocks: everything below stays usable. Not a password login: it records who did what. ── -->
            <form
                v-if='operatorShown && !store.operator'
                class='px-3 py-2 border-bottom flex-shrink-0 d-flex flex-wrap align-items-center gap-2'
                style='background:rgba(255,193,7,.15)'
                data-test='operator-sign-in'
                @submit.prevent='signIn'
            >
                <label
                    for='operatorSignInBox'
                    class='fw-semibold text-warning small mb-0 flex-grow-1'
                >Sign in with your employee number</label>
                <div class='d-flex gap-1'>
                    <input
                        id='operatorSignInBox'
                        v-model='signInInput'
                        type='text'
                        inputmode='numeric'
                        autocomplete='off'
                        :maxlength='OPERATOR_MAX'
                        class='form-control border-warning'
                        style='width:130px'
                        placeholder='Employee #'
                    >
                    <button
                        type='submit'
                        class='btn btn-warning fw-semibold text-nowrap'
                    >Sign in</button>
                </div>
                <div
                    v-if='signInError'
                    class='w-100 small text-warning'
                >{{ signInError }}</div>
            </form>

            <!-- ── TAK-CAD mode: DataSync feed picker (markers/log routing) ─────── -->
            <div
                v-if='store.serverMode === "takcad"'
                class='px-3 py-2 border-bottom flex-shrink-0'
            >
                <div v-if='!takcadFeed'>
                    <button
                        class='btn btn-sm btn-outline-secondary w-100'
                        :disabled='loadingFeeds'
                        @click='fetchFeeds'
                    >
                        <span v-if='loadingFeeds' class='spinner-border spinner-border-sm me-1' />
                        {{ loadingFeeds ? 'Loading…' : '+ Select DataSync Feed' }}
                    </button>
                    <div
                        v-if='feeds.length'
                        class='border rounded mt-1'
                        style='max-height:160px;overflow-y:auto;background:var(--bs-body-bg,#1e2228)'
                    >
                        <button
                            v-for='f in feeds'
                            :key='f.guid'
                            class='btn btn-sm w-100 text-start px-3 py-2 border-0 border-bottom rounded-0'
                            :style='subscribedGuids.has(f.guid)
                                ? "font-size:12px"
                                : "font-size:12px;color:#8a97a5;opacity:1"'
                            :disabled='!subscribedGuids.has(f.guid)'
                            :title='subscribedGuids.has(f.guid) ? f.name : "Subscribe to this feed in CloudTAK → Data Sync first"'
                            @click='selectFeed(f)'
                        >
                            {{ f.name }}
                            <span v-if='!subscribedGuids.has(f.guid)'> — not subscribed</span>
                        </button>
                    </div>
                    <div
                        v-else-if='feedsFetched && !loadingFeeds'
                        class='text-muted small text-center py-1'
                    >
                        No DataSync feeds found
                    </div>
                </div>
                <div
                    v-else
                    class='d-flex align-items-center gap-2 small'
                >
                    <span class='badge bg-primary text-white'>DataSync</span>
                    <span class='text-truncate flex-grow-1'>{{ takcadFeed.name }}</span>
                    <button
                        class='btn btn-link btn-sm p-0 text-muted text-decoration-none'
                        title='Choose another feed'
                        aria-label='Choose another feed'
                        @click='takcadFeed = null; feeds = []; feedsFetched = false'
                    >
                        <IconX
                            :size='16'
                            stroke='1'
                        />
                    </button>
                </div>
            </div>

            <!-- ── Standalone mode: the open Event. "Event: NAME" with Switch event (back to the list of events; the
                 event stays open for everyone), then how its incidents reach the field with its Event report. ── -->
            <div
                v-else-if='store.serverMode === "standalone" && store.activeEvent'
                class='border-bottom flex-shrink-0'
                data-test='event-bar'
            >
                <div class='px-3 pt-2 pb-1 d-flex align-items-center gap-2'>
                    <span
                        class='text-truncate flex-grow-1'
                        :title='store.activeEvent.name'
                    ><span class='text-muted'>Event:</span> <span class='fw-semibold'>{{ store.activeEvent.name }}</span></span>
                    <span
                        v-if='store.activeEvent.status === "archived"'
                        class='badge bg-secondary'
                    >Archived</span>
                    <button
                        class='btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1 text-nowrap py-0 px-2 small'
                        title='Go to the list of events to open a different one. This event stays open for everyone.'
                        data-test='switch-event'
                        @click='closeEvent'
                    >
                        <IconArrowsExchange
                            :size='14'
                            stroke='1'
                        />
                        Switch event
                    </button>
                </div>
                <div class='px-3 pb-2 d-flex align-items-center gap-2 small'>
                    <span class='text-muted text-truncate flex-grow-1'>
                        <template v-if='store.activeEvent.delivery === "broadcast"'>
                            <span title='Incidents are broadcast to the channel as CloudTAK Core Events — nothing for field users to subscribe to'>Broadcast:</span>&nbsp;<span class='fw-semibold text-body'>{{ activeEventChannel || '—' }}</span>
                        </template>
                        <template v-else>
                            DataSync: <span class='fw-semibold text-body'>{{ store.activeEvent.feed_name }}</span>
                            <IconCheck
                                v-if='feedSubscribed'
                                :size='16'
                                stroke='1'
                                class='text-success'
                                title='Subscribed to this feed — markers will render'
                            />
                        </template>
                    </span>
                    <button
                        class='btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1 text-nowrap py-0 px-2'
                        title='After-action report for this event: call counts, narrative, PDF / CSV'
                        data-test='event-report'
                        @click='showSettings = false; showReport = true'
                    >
                        <IconFileText
                            :size='14'
                            stroke='1'
                        />
                        Event report
                    </button>
                </div>
            </div>

            <!-- Open Event but not subscribed to its feed → markers will silently not render -->
            <div
                v-if='store.serverMode === "standalone" && store.activeEvent && feedSubscribed === false'
                class='px-3 py-1 border-bottom flex-shrink-0 small text-warning d-flex align-items-center gap-2'
            >
                <span class='flex-grow-1'>
                    Not subscribed to "{{ store.activeEvent.feed_name }}" — incident markers won't
                    appear on your map. Subscribe in CloudTAK → Data Sync.
                </span>
                <button
                    class='btn btn-sm btn-link p-0 text-decoration-none'
                    @click='checkFeedSubscription'
                >
                    Recheck
                </button>
            </div>

            <!-- ── Standalone: Dispatcher Settings (shared by every event), over any screen ── -->
            <div
                v-if='store.serverMode === "standalone" && showSettings'
                class='flex-grow-1 overflow-hidden'
            >
                <DispatcherSettings @close='showSettings = false' />
            </div>

            <!-- ── Standalone mode: Events screen (no Event open) ──────────────── -->
            <div
                v-else-if='store.serverMode === "standalone" && !store.activeEvent'
                class='flex-grow-1 overflow-hidden'
            >
                <EventsView @opened='onEventOpened' />
            </div>

            <!-- ── Standalone: after-action report for the open Event ──────────── -->
            <div
                v-else-if='showReport && store.activeEvent'
                class='flex-grow-1 overflow-hidden'
            >
                <ReportView
                    :event='store.activeEvent'
                    @close='showReport = false'
                />
            </div>

            <!-- ── Otherwise: tabs + incident/vehicle/personnel views ──────────── -->
            <template v-else>
                <!-- Tab nav — Vehicles/Personnel only in TAK-CAD mode. Standalone: just the "Incidents" title, which
                     runs on into the incident list's tabs below on one band, marked by a thin orange line on top. -->
                <div
                    class='d-flex flex-shrink-0'
                    :class='{ "border-bottom": store.serverMode !== "standalone" }'
                    :style='store.serverMode === "standalone" ? "background:var(--tblr-bg-surface, #1f2937); border-top:3px solid var(--tblr-warning, #f59f00)" : ""'
                >
                    <button
                        v-for='tab in visibleTabs'
                        :key='tab.key'
                        class='flex-fill btn btn-sm rounded-0 py-2 border-0'
                        :class='store.serverMode === "standalone" ? "text-body fw-semibold pb-1" : activeTab === tab.key ? "bg-warning text-dark fw-semibold" : "text-muted"'
                        @click='activeTab = tab.key'
                    >
                        {{ tab.label }}
                    </button>
                </div>

                <!-- Views -->
                <div class='flex-grow-1 overflow-hidden'>
                    <IncidentListView
                        v-if='activeTab === "incidents"'
                        :server-mode='store.serverMode'
                        :incident-types='incidentTypes'
                        :vehicles='vehicles'
                        :personnel='personnel'
                        :takcad-feed='takcadFeed'
                        @status='connectionStatus = $event'
                    />
                    <VehicleListView
                        v-else-if='activeTab === "vehicles"'
                        :server-mode='store.serverMode'
                        :vehicle-types='vehicleTypes'
                    />
                    <PersonnelListView
                        v-else-if='activeTab === "personnel"'
                        :roles='roles'
                    />
                </div>
            </template>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onErrorCaptured, watch } from 'vue';
import ProfileConfig from '../../../src/base/profile.ts';
import { IconHeadset, IconPictureInPictureOn, IconSettings, IconArrowsExchange, IconFileText, IconX, IconCheck } from '@tabler/icons-vue';
import IncidentListView from './IncidentListView.vue';
import VehicleListView  from './VehicleListView.vue';
import PersonnelListView from './PersonnelListView.vue';
import EventsView from './EventsView.vue';
import ReportView from './ReportView.vue';
import DispatcherSettings from './DispatcherSettings.vue';
import { getIncidentTypes, getVehicleTypes, getVehicles, getPersonnel, getRoles, getIncidentMetadata, getMissions, getSubscribedFeedGuids } from '../lib/takcad-client.ts';
import type { MissionRef } from '../lib/takcad-client.ts';
import type { IncidentTypeRef, VehicleType, VehicleRef, PersonRef, Role } from '../lib/takcad-types.ts';
import { listIncidents } from '../lib/events-client.ts';
import type { DispatcherEvent } from '../lib/events-client.ts';
import { dispatcherStore as store, saveLastEventId } from '../lib/dispatcher-store.ts';
import { popOutDispatcher, dockDispatcher, focusWorkspace } from '../lib/float-pane.ts';
import { parseOperator, saveOperator, OPERATOR_MAX } from '../lib/operator.ts';

// floating: this instance lives inside the floating pane (DispatcherFloat) rather than
// the anchored menu route.
const props = defineProps<{ floating?: boolean }>();

const floatedElsewhere = computed(() => store.floating && !props.floating);

// Badge text for the open event: the feed's live channels, else the stored label.
const activeEventChannel = computed(() => {
    const ev = store.activeEvent;
    if (!ev) return '';
    return ev.feed_channels?.length ? ev.feed_channels.join(', ') : (ev.channel ?? '');
});

const TABS = [
    { key: 'incidents',  label: 'Incidents',  takCadOnly: false },
    { key: 'vehicles',   label: 'Vehicles',   takCadOnly: true  },
    { key: 'personnel',  label: 'Personnel',  takCadOnly: true  },
] as const;

type TabKey = typeof TABS[number]['key'];

const visibleTabs = computed(() =>
    TABS.filter(t => !t.takCadOnly || store.serverMode === 'takcad')
);

// Diagnostic: surface any child setup/render throw as text instead of a blank panel.
const setupError = ref('');
onErrorCaptured((err) => {
    setupError.value = err instanceof Error ? (err.stack || err.message) : String(err);
    // eslint-disable-next-line no-console
    console.error('[dispatcher] captured render error', err);
    return false;
});

const activeTab        = ref<TabKey>('incidents');
const showReport       = ref(false);
const showSettings     = ref(false);
const connectionStatus = ref('');
const incidentTypes    = ref<IncidentTypeRef[]>([]);
const vehicleTypes     = ref<VehicleType[]>([]);
const vehicles         = ref<VehicleRef[]>([]);
const personnel        = ref<PersonRef[]>([]);
const roles            = ref<Role[]>([]);
const feeds            = ref<MissionRef[]>([]);
const loadingFeeds     = ref(false);
const feedsFetched     = ref(false);

// TAK-CAD mode keeps its own local DataSync feed for marker/log routing (the standalone
// path now routes via the open Event's feed_guid instead).
const takcadFeed = ref<MissionRef | null>(null);

const subscribedGuids = ref<Set<string>>(new Set());
// null = unknown/not checked yet; false drives the warning banner.
const feedSubscribed = ref<boolean | null>(null);

async function checkFeedSubscription() {
    const ev = store.activeEvent;
    // Broadcast Events have no feed, so there is nothing to be subscribed to.
    if (!ev || ev.delivery === 'broadcast') { feedSubscribed.value = null; return; }
    try {
        feedSubscribed.value = (await getSubscribedFeedGuids()).has(ev.feed_guid);
    } catch {
        feedSubscribed.value = null;
    }
}

watch(() => store.activeEvent, checkFeedSubscription, { immediate: true });

async function fetchFeeds() {
    loadingFeeds.value = true;
    feedsFetched.value = false;
    try {
        subscribedGuids.value = await getSubscribedFeedGuids();
        const all = await getMissions();
        feeds.value = [...all].sort((a, b) =>
            Number(subscribedGuids.value.has(b.guid)) - Number(subscribedGuids.value.has(a.guid)));
    } catch { feeds.value = []; }
    finally { loadingFeeds.value = false; feedsFetched.value = true; }
}

function selectFeed(f: MissionRef) {
    takcadFeed.value = f;
    feeds.value = [];
    feedsFetched.value = false;
}

// An Event was opened from the Events screen → load its incidents and remember it.
async function onEventOpened(event: DispatcherEvent) {
    saveLastEventId(event.id);
    activeTab.value = 'incidents';
    store.incidents = [];   // never show (or restore windows against) another Event's list meanwhile
    try {
        const list = await listIncidents(event.id);
        // Switched again before the list came back: it belongs to the other Event.
        if (store.activeEvent?.id === event.id) store.incidents = list;
    } catch { /* the board's poll fills it in */ }
}

function closeEvent() {
    store.activeEvent = null;
    store.incidents = [];
    saveLastEventId(null);
    showReport.value = false;
}

async function detect() {
    store.serverMode = 'detecting';
    try {
        await getIncidentMetadata();
        store.serverMode = 'takcad';
        try {
            [incidentTypes.value, vehicleTypes.value, vehicles.value, personnel.value, roles.value] =
                await Promise.all([getIncidentTypes(), getVehicleTypes(), getVehicles(), getPersonnel(), getRoles()]);
        } catch (e) {
            console.warn('[dispatcher] takcad metadata load failed', e);
        }
    } catch {
        store.serverMode = 'standalone';
    }
}

// Reset the tab when disconnecting from TAK-CAD
watch(() => store.serverMode, (mode) => {
    if (mode === 'standalone' && activeTab.value !== 'incidents') activeTab.value = 'incidents';
});

// ── Operator (employee number at this terminal; see lib/operator.ts) ──────────
// Sign in: type the number, Sign in (or Enter). Sign out: clears it; the next person signs in.
const operatorShown = computed(() => store.serverMode === 'standalone' && store.operatorNumbers);
const signedIn = computed(() => operatorShown.value && !!store.operator);
const signInInput = ref('');
const signInError = ref('');

function signIn() {
    const id = parseOperator(signInInput.value);
    if (!id) {
        signInError.value = `Digits only, up to ${OPERATOR_MAX}.`;
        return;
    }
    store.operator = id;
    saveOperator(id);
    signInInput.value = '';
    signInError.value = '';
}

function signOut() {
    store.operator = null;
    saveOperator(null);
}

function forceStandalone() {
    store.forcedMode = 'standalone';
    store.serverMode = 'standalone';
}

async function retryDetection() {
    store.forcedMode = null;
    await detect();
}

onMounted(async () => {
    // Dispatcher identity = the user's CloudTAK callsign (no separate prompt). Same callsign
    // GeoChat messages are sent from; it also lands in incident-marker remarks.
    const callsign = (await ProfileConfig.get('tak_callsign'))?.value;
    const username = (await ProfileConfig.get('username'))?.value;
    store.dispatcherName = String(callsign || username || 'Dispatcher');

    if (store.forcedMode === 'standalone') {
        store.serverMode = 'standalone';
        return;
    }
    await detect();
});
</script>
