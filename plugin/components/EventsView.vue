<template>
    <div class='d-flex flex-column h-100 overflow-hidden'>
        <!-- ── Create Event form ─────────────────────────────────────────────── -->
        <template v-if='view === "create"'>
            <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    @click='view = "list"'
                >
                    ← Back
                </button>
                <span class='fw-semibold'>New Event</span>
            </div>
            <div class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'>
                <div>
                    <label class='form-label small text-muted mb-1'>Event Name <span class='text-danger'>*</span></label>
                    <input
                        v-model='form.name'
                        type='text'
                        class='form-control form-control-sm border'
                        placeholder='e.g. 2025-FESTIVAL'
                        @input='onNameInput'
                    >
                </div>
                <div>
                    <label class='form-label small text-muted mb-1'>Incident Prefix</label>
                    <input
                        v-model='form.prefix'
                        type='text'
                        class='form-control form-control-sm border text-warning fw-semibold'
                        placeholder='FESTIVAL'
                        maxlength='12'
                    >
                    <div class='form-text small'>
                        Incidents are numbered {{ (form.prefix || 'INC').toUpperCase() }}-001, -002, …
                    </div>
                </div>
                <div>
                    <label class='form-label small text-muted mb-1'>DataSync Feed <span class='text-danger'>*</span></label>
                    <div class='d-flex rounded overflow-hidden border mb-1'>
                        <button
                            v-for='m in FEED_MODES'
                            :key='m.key'
                            class='flex-fill btn btn-sm py-1 rounded-0 border-0 small'
                            :class='feedMode === m.key ? "bg-primary text-white" : "text-muted"'
                            @click='feedMode = m.key'
                        >
                            {{ m.label }}
                        </button>
                    </div>
                    <template v-if='feedMode === "create"'>
                        <label class='form-label small text-muted mb-1 mt-1'>DataSync Feed Name <span class='text-danger'>*</span></label>
                        <input
                            v-model='newFeedName'
                            type='text'
                            class='form-control form-control-sm border mb-1'
                            placeholder='Defaults to the event name'
                            @input='onFeedNameInput'
                        >
                        <label class='form-label small text-muted mb-1'>Channel for the new feed <span class='text-danger'>*</span></label>
                        <select
                            v-model='selectedChannel'
                            class='form-select form-select-sm border'
                        >
                            <option
                                value=''
                                disabled
                            >
                                {{ loadingChannels ? 'Loading channels…' : (channels.length ? 'Select a channel' : 'No channels available') }}
                            </option>
                            <option
                                v-for='c in channels'
                                :key='c'
                                :value='c'
                            >
                                {{ c }}
                            </option>
                        </select>
                        <div class='form-text small'>
                            The feed is created in this channel and you're subscribed automatically.
                            The event inherits the feed's channel — only its members see either.
                        </div>
                    </template>
                    <button
                        v-if='feedMode === "existing" && !selectedFeed'
                        class='btn btn-sm btn-outline-secondary w-100'
                        :disabled='loadingFeeds'
                        @click='fetchFeeds'
                    >
                        <span v-if='loadingFeeds' class='spinner-border spinner-border-sm me-1' />
                        {{ loadingFeeds ? 'Loading…' : '+ Select DataSync Feed' }}
                    </button>
                    <div
                        v-if='feedMode === "existing" && !selectedFeed && feeds.length'
                        class='border rounded mt-1'
                        style='max-height:160px;overflow-y:auto;background:var(--bs-body-bg,#1e2228)'
                    >
                        <button
                            v-for='f in feeds'
                            :key='f.guid'
                            class='btn btn-sm w-100 text-start px-3 py-2 border-0 border-bottom rounded-0'
                            style='font-size:12px'
                            @click='selectedFeed = f'
                        >
                            {{ f.name }}
                        </button>
                    </div>
                    <div
                        v-if='feedMode === "existing" && !selectedFeed && feedsFetched && !loadingFeeds && !feeds.length'
                        class='text-muted small text-center py-1'
                    >
                        No DataSync feeds found
                    </div>
                    <template v-if='feedMode === "existing" && selectedFeed'>
                        <div class='d-flex align-items-center gap-2 small mt-1'>
                            <span class='badge bg-primary text-white'>DataSync</span>
                            <span class='text-truncate flex-grow-1'>{{ selectedFeed.name }}</span>
                            <span
                                v-if='existingChannelOptions.length === 1'
                                class='badge'
                                style='background:#64748b;color:#fff'
                                :title='`Feed channel — the event inherits it`'
                            >{{ existingChannelOptions[0] }}</span>
                            <button
                                class='btn btn-link btn-sm p-0 text-muted text-decoration-none'
                                @click='selectedFeed = null; feeds = []; feedsFetched = false'
                            >
                                ✕
                            </button>
                        </div>
                        <template v-if='existingChannelOptions.length > 1'>
                            <label class='form-label small text-muted mb-1 mt-1'>Feed is in multiple channels — pick the event's</label>
                            <select
                                v-model='existingChannel'
                                class='form-select form-select-sm border'
                            >
                                <option
                                    v-for='c in existingChannelOptions'
                                    :key='c'
                                    :value='c'
                                >
                                    {{ c }}
                                </option>
                            </select>
                        </template>
                        <div
                            v-if='!existingChannelOptions.length'
                            class='text-warning small mt-1'
                        >
                            This feed has no channel — the event would be visible to everyone.
                        </div>
                        <div
                            v-else
                            class='form-text small'
                        >
                            The event inherits the feed's channel — only its members see either.
                            You'll be subscribed to the feed automatically.
                        </div>
                    </template>
                </div>

                <div
                    v-if='createError'
                    class='alert alert-danger py-2 small'
                >
                    {{ createError }}
                </div>
                <button
                    class='btn btn-sm btn-warning'
                    :disabled='saving || !form.name.trim()
                        || (feedMode === "create" && !selectedChannel)
                        || (feedMode === "existing" && !selectedFeed)'
                    @click='submitCreate'
                >
                    <span v-if='saving' class='spinner-border spinner-border-sm me-1' />
                    Create Event
                </button>
            </div>
        </template>

        <!-- ── After-action report ───────────────────────────────────────────── -->
        <template v-else-if='view === "report" && reportEvent'>
            <ReportView
                :event='reportEvent'
                @close='view = "list"'
            />
        </template>

        <!-- ── Events list ───────────────────────────────────────────────────── -->
        <template v-else>
            <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
                <span class='text-muted small me-auto'>Events</span>
                <button
                    class='btn btn-sm btn-warning'
                    @click='openCreate'
                >
                    + New Event
                </button>
            </div>
            <div class='flex-grow-1 overflow-auto'>
                <div
                    v-if='loading && !store.events.length'
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
                    v-else-if='!store.events.length'
                    class='text-center text-muted py-4 small'
                >
                    No events yet
                </div>
                <div
                    v-for='ev in store.events'
                    :key='ev.id'
                    class='d-flex align-items-start px-3 py-2 border-bottom event-row'
                >
                    <div
                        class='flex-grow-1 overflow-hidden'
                        role='button'
                        @click='open(ev)'
                    >
                        <div class='d-flex align-items-center gap-2'>
                            <span class='fw-semibold small text-truncate'>{{ ev.name }}</span>
                            <span
                                v-if='ev.channel'
                                class='badge small'
                                style='background:#64748b;color:#fff'
                                :title='`Visible to channel ${ev.channel}`'
                            >{{ ev.channel }}</span>
                            <span
                                v-if='ev.status === "archived"'
                                class='badge bg-secondary small'
                            >Archived</span>
                        </div>
                        <div class='small text-muted text-truncate'>
                            {{ ev.feed_name }} · {{ ev.prefix }}-NNN
                        </div>
                    </div>
                    <div class='text-end ms-2 flex-shrink-0 d-flex gap-1'>
                        <button
                            class='btn btn-sm btn-link text-muted py-0 px-1 text-decoration-none'
                            title='Generate after-action report'
                            :disabled='busyId === ev.id'
                            @click.stop='openReport(ev)'
                        >
                            Report
                        </button>
                        <button
                            v-if='ev.status === "active"'
                            class='btn btn-sm btn-link text-muted py-0 px-1 text-decoration-none'
                            title='Archive event (removes markers, keeps records)'
                            :disabled='busyId === ev.id'
                            @click.stop='archive(ev)'
                        >
                            Archive
                        </button>
                        <button
                            class='btn btn-sm btn-link text-danger py-0 px-1 text-decoration-none'
                            title='Nuke event (permanent delete)'
                            :disabled='busyId === ev.id'
                            @click.stop='nuke(ev)'
                        >
                            Nuke
                        </button>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue';
import { useMapStore } from '../../../src/stores/map.ts';
import { getMissions, getUserChannels, createFeed, feedChannels } from '../lib/takcad-client.ts';
import OverlayManager from '../../../src/base/overlay.ts';
import type { MissionRef } from '../lib/takcad-client.ts';
import {
    listEvents, createEvent, setEventStatus, deleteEvent, listIncidents,
} from '../lib/events-client.ts';
import type { DispatcherEvent } from '../lib/events-client.ts';
import { removeIncidentMarker } from '../lib/map-marker.ts';
import { dispatcherStore as store, loadLastEventId } from '../lib/dispatcher-store.ts';
import ReportView from './ReportView.vue';

const emit = defineEmits<{
    (e: 'opened', ev: DispatcherEvent): void;
}>();

const mapStore = useMapStore();

const view         = ref<'list' | 'create' | 'report'>('list');
const reportEvent  = ref<DispatcherEvent | null>(null);

function openReport(ev: DispatcherEvent) {
    reportEvent.value = ev;
    view.value = 'report';
}
const loading      = ref(false);
const loadError    = ref('');
const saving       = ref(false);
const createError  = ref('');
const busyId       = ref('');

const feeds           = ref<MissionRef[]>([]);
const loadingFeeds    = ref(false);
const feedsFetched    = ref(false);
const selectedFeed    = ref<MissionRef | null>(null);

// The channel belongs to the FEED, never picked against it (operator design,
// 2026-08-06): a NEW feed gets its channel assigned at creation; an EXISTING feed
// already has one and the event simply inherits it. The user's credentials bound
// everything — Marti only lists feeds in their channels, and the server enforces
// membership on the event. No mismatch is possible.
const FEED_MODES = [
    { key: 'create',   label: 'New feed'      },
    { key: 'existing', label: 'Existing feed' },
] as const;
type FeedMode = typeof FEED_MODES[number]['key'];

const channels        = ref<string[]>([]);
const loadingChannels = ref(false);
const selectedChannel = ref('');           // create mode: channel for the new feed
const feedMode        = ref<FeedMode>('create');
const newFeedName     = ref('');
let feedNameDirty     = false;

// Existing mode: the event's channel comes FROM the picked feed.
const existingChannel        = ref('');
const existingChannelOptions = ref<string[]>([]);

watch(selectedFeed, (f) => {
    if (!f) {
        existingChannelOptions.value = [];
        existingChannel.value = '';
        return;
    }
    const all = feedChannels(f);
    // Prefer the feed channels the user is a member of; fall back to the feed's own
    // list (the server still validates membership on create).
    const mine = all.filter(c => channels.value.includes(c));
    existingChannelOptions.value = mine.length ? mine : all;
    existingChannel.value = existingChannelOptions.value[0] ?? '';
});

const form = reactive({
    name:   '',
    prefix: '',
});

// User hasn't touched the prefix field yet → keep deriving it from the name.
let prefixDirty = false;

// Derive a prefix from the event name: strip a leading 4-digit year token, uppercase,
// keep [A-Z0-9-], collapse separators, ≤12 chars. e.g. "2025-FESTIVAL" → "FESTIVAL".
function derivePrefix(name: string): string {
    return name
        .replace(/^\s*\d{4}[\s_-]*/, '')
        .replace(/[^A-Z0-9]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toUpperCase()
        .slice(0, 12);
}

function onNameInput() {
    if (!prefixDirty) form.prefix = derivePrefix(form.name);
    if (!feedNameDirty) newFeedName.value = form.name.trim();
}

function onFeedNameInput() {
    feedNameDirty = true;
}

async function loadList() {
    loading.value = true; loadError.value = '';
    try {
        store.events = await listEvents();
        // Optional convenience: reselect the last-opened Event on first load.
        const lastId = await loadLastEventId();
        if (lastId) {
            const ev = store.events.find(e => e.id === lastId);
            if (ev) await open(ev);
        }
    } catch (e) {
        loadError.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}

async function fetchFeeds() {
    loadingFeeds.value = true;
    feedsFetched.value = false;
    try { feeds.value = await getMissions(); }
    catch { feeds.value = []; }
    finally { loadingFeeds.value = false; feedsFetched.value = true; }
}

// Subscribe the current user to a feed — same overlay + loadMission path CloudTAK's
// own mission UI uses, guarded against double-subscribing. Best-effort: the event
// bar warns and offers Recheck if it fails.
async function subscribeToFeed(guid: string, name: string, token?: string) {
    try {
        if (OverlayManager.loadedByMode('mission', guid)) return;
        await OverlayManager.createLoaded({
            name,
            url:     `/mission/${encodeURIComponent(guid)}`,
            type:    'geojson',
            mode:    'mission',
            token,
            mode_id: guid,
        });
        await mapStore.loadMission(guid);
    } catch (e) {
        console.warn('[dispatcher] feed subscribe failed', e);
    }
}

function openCreate() {
    form.name = '';
    form.prefix = '';
    prefixDirty = false;
    selectedFeed.value = null;
    feeds.value = [];
    feedsFetched.value = false;
    createError.value = '';
    selectedChannel.value = '';
    feedMode.value = 'create';
    newFeedName.value = '';
    feedNameDirty = false;
    view.value = 'create';
    loadingChannels.value = true;
    getUserChannels()
        .then(c => { channels.value = c; })
        .catch(() => { channels.value = []; })
        .finally(() => { loadingChannels.value = false; });
}

async function submitCreate() {
    if (!form.name.trim()) return;
    if (feedMode.value === 'create' && !selectedChannel.value) return;
    if (feedMode.value === 'existing' && !selectedFeed.value) return;
    saving.value = true; createError.value = '';
    try {
        let feedGuid: string;
        let feedName: string;
        let channel: string;
        if (feedMode.value === 'create') {
            channel = selectedChannel.value;
            const wantedName = newFeedName.value.trim() || form.name.trim();
            // TAK Server keys missions by NAME — a duplicate "create" silently returns
            // the existing mission. Guard twice: against every feed we can see, then
            // against the returned channel list (covers feeds in channels we can't see).
            const visible = await getMissions().catch(() => [] as MissionRef[]);
            if (visible.some(m => m.name.toLowerCase() === wantedName.toLowerCase())) {
                throw new Error(`A DataSync feed named "${wantedName}" already exists — `
                    + 'choose another name, or attach it via "Existing feed".');
            }
            const feed = await createFeed(
                wantedName,
                channel,
                `Dispatcher feed for event ${form.name.trim()}`,
            );
            const gotChannels = feedChannels(feed);
            if (gotChannels.length && !gotChannels.includes(channel)) {
                throw new Error(`A feed named "${wantedName}" already exists on the TAK Server `
                    + `(in ${gotChannels.join(', ')}) — choose a different name.`);
            }
            feedGuid = feed.guid;
            feedName = feed.name;
            await subscribeToFeed(feed.guid, feed.name, feed.token);
        } else {
            // The event inherits the existing feed's channel — the feed itself is
            // never modified. A channel-less (public) feed yields a channel-less
            // event, visible to everyone (the form warns before this point).
            feedGuid = selectedFeed.value!.guid;
            feedName = selectedFeed.value!.name;
            channel  = existingChannel.value;
            await subscribeToFeed(feedGuid, feedName);
        }
        const ev = await createEvent({
            name:      form.name.trim(),
            prefix:    (form.prefix || derivePrefix(form.name) || 'INC').toUpperCase(),
            feed_guid: feedGuid,
            feed_name: feedName,
            channel:   channel || undefined,
        });
        store.events = [ev, ...store.events];
        view.value = 'list';
        await open(ev);
    } catch (e) {
        createError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

async function open(ev: DispatcherEvent) {
    // Subscribe-on-open: feed-driven access means anyone who can open the event may
    // subscribe to its feed — so do it for them and markers just work, creator or not.
    // Best-effort; the event bar's warning + Recheck remains the fallback.
    await subscribeToFeed(ev.feed_guid, ev.feed_name);
    store.activeEvent = ev;
    emit('opened', ev);
}

// Remove every marker this Event dropped into its feed (records stay server-side).
async function clearEventMarkers(ev: DispatcherEvent) {
    let incidents;
    try { incidents = await listIncidents(ev.id); }
    catch { return; }
    for (const inc of incidents) {
        try {
            await removeIncidentMarker(mapStore, {
                uid:        inc.id,
                number:     inc.number,
                name:       inc.type ?? '',
                type:       inc.type ?? '',
                address:    inc.address ?? '',
                lat:        inc.lat ?? 0,
                lon:        inc.lon ?? 0,
                time:       inc.created_at,
                dispatcher: inc.dispatcher ?? '',
                details:    inc.details ?? '',
                feedGuid:   ev.feed_guid,
            });
        } catch { /* best-effort */ }
    }
}

async function archive(ev: DispatcherEvent) {
    busyId.value = ev.id;
    try {
        await clearEventMarkers(ev);
        const updated = await setEventStatus(ev.id, 'archived');
        store.events = store.events.map(e => e.id === ev.id ? updated : e);
    } catch (e) {
        loadError.value = e instanceof Error ? e.message : String(e);
    } finally {
        busyId.value = '';
    }
}

async function nuke(ev: DispatcherEvent) {
    if (!confirm(`Nuke event "${ev.name}"? This permanently deletes the event and ALL its incident records.`)) return;
    busyId.value = ev.id;
    try {
        await clearEventMarkers(ev);
        await deleteEvent(ev.id);
        store.events = store.events.filter(e => e.id !== ev.id);
        if (store.activeEvent?.id === ev.id) store.activeEvent = null;
    } catch (e) {
        loadError.value = e instanceof Error ? e.message : String(e);
    } finally {
        busyId.value = '';
    }
}

onMounted(loadList);
</script>

<style scoped>
.event-row:hover { background: rgba(255,255,255,.05); }
</style>
