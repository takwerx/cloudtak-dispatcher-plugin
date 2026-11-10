<template>
    <div
        class='px-3 py-2 border-bottom incident-row'
        :class='{ "incident-row-undocked": undocked }'
        role='button'
        data-test='incident-card'
        @click='emit("open", inc.id)'
    >
        <!-- Number and time created; Single Monitor Mode adds its labels between them -->
        <div class='d-flex align-items-center gap-2'>
            <span class='fw-semibold text-nowrap'>{{ inc.number }}</span>
            <template v-if='labels'>
                <span
                    v-if='undocked'
                    class='badge small bg-warning text-dark'
                    title='Open in its own window'
                >Undocked</span>
                <span
                    class='badge small'
                    :class='inc.status === "active" ? "bg-success text-white" : "bg-secondary text-white"'
                >{{ inc.status }}</span>
                <span
                    v-if='inc.status === "active"'
                    class='badge small'
                    :class='boardBadgeClass(inc.assigned)'
                >{{ BOARD_LABEL[boardState(inc.assigned)] }}</span>
            </template>
            <span class='ms-auto small text-muted text-nowrap'>{{ shortTime(inc.created_at) }}</span>
        </div>
        <div class='small'>
            {{ inc.type }}
        </div>
        <div class='small text-muted text-truncate'>
            {{ address }}
        </div>
        <div
            v-if='units.length'
            class='small text-truncate'
            :title='units.join(", ")'
        >
            <span class='text-muted'>Units</span> {{ units.join(', ') }}
        </div>
    </div>
</template>

<script setup lang="ts">
// One standalone incident in the Dispatcher's list: a short card with what a dispatcher scans for, the
// incident number, time created, type, address, and the callsigns of the units on it (when assigned). Clicking it emits
// `open` with the incident id. An undocked incident has a stripe on its left edge.
// Single Monitor Mode also shows its labels (Undocked, active / closed, Unassigned / Dispatched / On Scene):
// its Active tab mixes every open incident. Multi-Monitor Mode sorts the list into Unassigned / Active /
// Closed, so the tab already says what those labels would.
import { computed } from 'vue';
import type { DispatcherIncident } from '../lib/events-client.ts';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import { BOARD_LABEL, boardState, boardBadgeClass, rowUnits } from '../lib/unit-status.ts';

const props = defineProps<{ inc: DispatcherIncident }>();
const emit = defineEmits<{ (e: 'open', id: string): void }>();

const labels = computed(() => dispatcherStore.displayMode !== 'multi');
const undocked = computed(() => dispatcherStore.undocked.includes(props.inc.id));
const units = computed(() => rowUnits(props.inc.assigned));
const address = computed(() =>
    props.inc.address || `${(props.inc.lat ?? 0).toFixed(5)}, ${(props.inc.lon ?? 0).toFixed(5)}`);

function shortTime(iso: string): string {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
}
</script>

<style scoped>
.incident-row:hover { background: rgba(255,255,255,.05); cursor: pointer; }
.incident-row-undocked { box-shadow: inset 3px 0 0 var(--bs-warning, #f59f00); }
</style>
