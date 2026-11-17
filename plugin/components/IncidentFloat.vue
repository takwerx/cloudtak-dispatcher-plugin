<template>
    <!-- A press anywhere on the pane, its header included, makes this the incident the command line works on -->
    <FloatingPane
        :uid='uid'
        :padded='false'
        @close='closeUndocked(incidentId)'
        @pointerdown.capture='touchIncidentView(incidentId)'
    >
        <template #header>
            <!-- One fixed line in CloudTAK's pane header: number and type only, truncating. The status
                 badges sit at the top of the body, so the title and X always fit at the default width. -->
            <div
                class='d-flex align-items-center gap-2 mx-2 flex-grow-1'
                style='min-width:0'
            >
                <IconHeadset
                    :size='18'
                    class='text-warning flex-shrink-0'
                />
                <span
                    class='fw-semibold text-truncate'
                    :title='title'
                >{{ title }}</span>
            </div>
        </template>
        <IncidentDetail
            :incident-id='incidentId'
            floating
        />
    </FloatingPane>
</template>

<script setup lang="ts">
// One undocked incident: CloudTAK's floating pane (draggable by its grip, resizable, same
// layer as the Dispatcher pop-out) around the shared IncidentDetail. Several can be open at
// once. The pane's X closes the card; the incident stays on the board and in the list.
import { computed, onMounted, onUnmounted } from 'vue';
import { IconHeadset } from '@tabler/icons-vue';
import FloatingPane from '../../../src/components/CloudTAK/util/FloatingPane.vue';
import { useFloatStore } from '../../../src/stores/float.ts';
import IncidentDetail from './IncidentDetail.vue';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import { closeUndocked, forgetUndocked } from '../lib/undock-panes.ts';
import { acquireIncidentPoll } from '../lib/incident-poll.ts';
import { incidentTitle } from '../lib/undock.ts';
import { touchIncidentView } from '../lib/command-state.ts';

const props = defineProps<{ uid: string }>();

// The incident id rides in the pane config (undock-panes.ts sets it).
const incidentId = String(useFloatStore().panes.get(props.uid)?.config?.incidentId ?? '');

const title = computed(() => incidentTitle(dispatcherStore.incidents.find(i => i.id === incidentId)));

// Hold the shared poll while open, so the card stays live even with the menu panel closed.
let releasePoll: (() => void) | undefined;
onMounted(() => { releasePoll = acquireIncidentPoll(); });

// Unmounted by another path: a Map teardown keeps the pane in the float store (the card comes back
// with the map), anything that removed the pane drops it from the open set. Neither touches the saved
// list; only the X (closeUndocked) and Close all change what a reload brings back.
onUnmounted(() => {
    releasePoll?.();
    forgetUndocked(incidentId);
});
</script>
