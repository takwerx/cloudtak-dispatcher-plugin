<template>
    <div
        ref='el'
        class='position-absolute d-flex flex-column cloudtak-panel'
        :style='{
            left: `${rect.x}px`, top: `${rect.y}px`,
            width: `${rect.w}px`, height: `${rect.h}px`,
            zIndex: card.auto ? card.z : FLOATING_Z + card.z,
            backgroundColor: "var(--tblr-body-bg, #151f2b)",
            backgroundImage: "linear-gradient(var(--cloudtak-surface-bg, #141419), var(--cloudtak-surface-bg, #141419))",
            borderRadius: card.auto ? "0" : undefined,
            boxShadow: card.auto ? "none" : undefined,
            resize: "both",
            overflow: "hidden",
            minWidth: card.auto ? undefined : "360px",
            minHeight: card.auto ? undefined : "280px",
        }'
        data-test='workspace-card'
        @mousedown='raise'
    >
        <!-- CloudTAK's own panel surface (theme-aware, slightly translucent) over a solid base, so a card stacked
             on another never shows the one beneath. Flush in the layout: square and flat, so the cards read as
             columns; moved or resized by hand: CloudTAK's rounded, raised panel look. -->
        <!-- More incidents than spots: the ones sharing this spot are tabs along its top, the one in front
             highlighted; a tab brings that incident to the front. Every card in the spot draws the same strip,
             so whichever is in front shows it. -->
        <div
            v-if='mates.length > 1'
            class='d-flex border-bottom flex-shrink-0 overflow-hidden'
            style='background:var(--tblr-bg-surface-tertiary, #10161f)'
            data-test='workspace-spot-tabs'
            @mousedown.stop
        >
            <button
                v-for='m in mates'
                :key='m.id'
                class='btn btn-sm rounded-0 border-0 border-end flex-fill text-truncate'
                :class='m.id === card.id ? "bg-primary text-white" : "text-muted"'
                style='min-width:0'
                :title='mateTitle(m.id)'
                :data-test='`workspace-spot-tab-${m.id}`'
                @click='raiseCard(m.id)'
            >
                {{ mateTitle(m.id) }}
            </button>
        </div>
        <div
            class='d-flex align-items-center gap-2 px-2 border-bottom flex-shrink-0'
            style='height:44px;cursor:move;user-select:none'
            @mousedown='dragStart'
        >
            <IconGripVertical
                :size='20'
                stroke='1'
                class='text-muted flex-shrink-0'
            />
            <IconHeadset
                :size='18'
                class='text-warning flex-shrink-0'
            />
            <span
                class='fw-semibold text-truncate flex-grow-1'
                :title='title'
            >{{ title }}</span>
            <!-- Only on a card that was moved or resized: line it back up with the others. The icon is the layout it
                 returns to (columns side by side, or rows in a tall workspace), with a word to say so. -->
            <button
                v-if='!card.auto'
                class='btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1 text-nowrap py-0 px-2'
                title='Line this incident up with the others again, sharing the workspace'
                data-test='workspace-card-relayout'
                @mousedown.stop
                @click='unpinCard(card.id)'
            >
                <IconLayoutRows
                    v-if='tallWorkspace'
                    :size='16'
                    stroke='1'
                />
                <IconLayoutColumns
                    v-else
                    :size='16'
                    stroke='1'
                />
                Line up
            </button>
            <button
                class='btn btn-sm btn-link text-muted text-decoration-none px-1'
                title='Close'
                data-test='workspace-card-close'
                @mousedown.stop
                @click='closeUndocked(card.id)'
            >
                <IconX
                    :size='20'
                    stroke='1'
                />
            </button>
        </div>
        <div
            class='flex-grow-1'
            style='min-height:0'
        >
            <IncidentDetail
                :incident-id='card.id'
                floating
            />
        </div>
    </div>
</template>

<script setup lang="ts">
// One undocked incident inside the Multi-Monitor workspace: dragged by its title bar, resized from its
// corner, raised on click, closed with X. Same IncidentDetail as the panel and the single-monitor panes.
// While it follows the layout it takes its share of the workspace; dragging or resizing pins it where the
// dispatcher put it, and its Line up button returns it. Mouse moves are watched on the workspace window's own document (the card lives there).
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { IconGripVertical, IconHeadset, IconX, IconLayoutColumns, IconLayoutRows } from '@tabler/icons-vue';
import IncidentDetail from './IncidentDetail.vue';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import type { WorkspaceCard } from '../lib/dispatcher-store.ts';
import { closeUndocked, raiseCard, pinCard, unpinCard, cardLayout, spotMates } from '../lib/undock-panes.ts';
import { acquireIncidentPoll } from '../lib/incident-poll.ts';
import { watchSize } from '../lib/watch-size.ts';
import { clampCard, workspaceTileRect, workspaceIsTall, incidentTitle } from '../lib/undock.ts';

const props = defineProps<{ card: WorkspaceCard; areaSize: { width: number; height: number } }>();

const el = ref<HTMLElement | null>(null);

// Moved cards float above the lined-up ones, so one the dispatcher placed is never hidden under the layout.
const FLOATING_Z = 1_000_000;

const title = computed(() => incidentTitle(dispatcherStore.incidents.find(i => i.id === props.card.id)));

const mates = computed(() => (props.card.auto ? spotMates(props.card.id, areaDims()) : []));
function mateTitle(id: string): string {
    return incidentTitle(dispatcherStore.incidents.find(i => i.id === id));
}

function raise() {
    raiseCard(props.card.id);
}

function areaDims() {
    return { width: props.areaSize.width || 1200, height: props.areaSize.height || 800 };
}

// Where the card is drawn: its share of the workspace (following the workspace's size and the number of cards)
// until the dispatcher moves it. A moved card keeps its place and size, but never more than the workspace: if
// the workspace gets smaller it is made to fit and pulled back so its title bar stays reachable.
const rect = computed(() => {
    const c = props.card;
    if (c.auto) {
        const { index, count } = cardLayout(c.id);
        return workspaceTileRect(index, count, areaDims());
    }
    const area = areaDims();
    const w = Math.min(c.w, area.width), h = Math.min(c.h, area.height);
    const p = clampCard(c.x, c.y, area, { width: w });
    return { x: p.x, y: p.y, w, h };
});

const tallWorkspace = computed(() => workspaceIsTall(areaDims()));

let start = { mx: 0, my: 0, x: 0, y: 0 };
let doc: Document | null = null;
// A press on the title bar only becomes a drag (taking the card out of the layout) past a few pixels, so a
// click that slips a little leaves it where it is.
const DRAG_THRESHOLD = 5;
let dragging = false;

function dragMove(e: MouseEvent) {
    if (!dragging && Math.hypot(e.clientX - start.mx, e.clientY - start.my) < DRAG_THRESHOLD) return;
    dragging = true;
    const r = rect.value;
    const p = clampCard(start.x + e.clientX - start.mx, start.y + e.clientY - start.my, areaDims(), { width: r.w });
    if (p.x !== r.x || p.y !== r.y) pinCard(props.card.id, { x: p.x, y: p.y, w: r.w, h: r.h });
}

function dragEnd() {
    doc?.removeEventListener('mousemove', dragMove);
    doc?.removeEventListener('mouseup', dragEnd);
    doc = null;
}

function dragStart(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    start = { mx: e.clientX, my: e.clientY, x: rect.value.x, y: rect.value.y };
    dragging = false;
    doc = el.value?.ownerDocument ?? document;
    doc.addEventListener('mousemove', dragMove);
    doc.addEventListener('mouseup', dragEnd);
}

// Resizing is the browser's own corner handle (CSS resize, set inline so it never depends on a stylesheet
// reaching the workspace window). A size that differs from what the layout drew
// came from the dispatcher's hand: pin the card at that size. (A layout change redraws at the drawn size.)
let stopWatch: (() => void) | undefined;
// Hold the shared poll while open, as a single-monitor pane does, so the card stays live while the
// workspace's own list is not showing (Settings, Event report).
let releasePoll: (() => void) | undefined;
onMounted(() => {
    releasePoll = acquireIncidentPoll();
    if (!el.value) return;
    stopWatch = watchSize(el.value, () => {
        if (!el.value) return;
        const w = el.value.offsetWidth, h = el.value.offsetHeight, r = rect.value;
        if (Math.abs(w - r.w) > 2 || Math.abs(h - r.h) > 2) pinCard(props.card.id, { x: r.x, y: r.y, w, h });
    });
});

onUnmounted(() => {
    dragEnd();
    stopWatch?.();
    releasePoll?.();
});
</script>

