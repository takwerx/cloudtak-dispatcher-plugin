<template>
    <div
        class='d-flex'
        style='height:100%;background:var(--tblr-body-bg, #151f2b);color:var(--tblr-body-color, #e6e9ec)'
    >
        <!-- Card area: undocked incidents open here, filling from the right, beside the pinned Dispatcher panel -->
        <div
            ref='area'
            class='position-relative flex-grow-1 overflow-hidden'
            style='min-width:0;background:var(--tblr-bg-surface-tertiary, #10161f)'
            data-test='workspace-area'
        >
            <div
                v-if='!dispatcherStore.workspaceCards.length'
                class='position-absolute top-50 start-50 translate-middle text-center text-muted small px-3'
                style='max-width:420px'
            >
                Undocked incidents open here.<br>
                Drag this window to another monitor and maximize it; the map stays on the first one.
            </div>
            <WorkspaceCard
                v-for='c in dispatcherStore.workspaceCards'
                :key='c.id'
                :card='c'
                :area-size='areaSize'
            />
        </div>
        <!-- The Dispatcher, pinned to the right edge at full height, as in CloudTAK's menu -->
        <div
            class='border-start flex-shrink-0'
            :style='{ width: `${WORKSPACE_PANEL_WIDTH}px`, height: "100%" }'
        >
            <CadMain floating />
        </div>
    </div>
</template>

<script setup lang="ts">
// Multi-Monitor Mode: the Dispatcher workspace, one browser window (float-pane.ts opens it through
// popout-window.ts) that the dispatcher drags onto another monitor and maximizes. The panel is pinned to
// the right; undocked incidents are cards in the area to its left. Cards share this area (one fills it, two
// split it, and so on) and follow its size; maximizing or turning the monitor re-lays them out.
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import CadMain from './CadMain.vue';
import WorkspaceCard from './WorkspaceCard.vue';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import { WORKSPACE_PANEL_WIDTH } from '../lib/undock.ts';
import { watchSize } from '../lib/watch-size.ts';

const area = ref<HTMLElement | null>(null);
const areaSize = reactive({ width: 0, height: 0 });

let stopWatch: (() => void) | undefined;
function measure() {
    if (!area.value) return;
    areaSize.width = area.value.clientWidth;
    areaSize.height = area.value.clientHeight;
}

onMounted(() => {
    measure();
    if (area.value) stopWatch = watchSize(area.value, measure);
});
onUnmounted(() => stopWatch?.());
</script>
