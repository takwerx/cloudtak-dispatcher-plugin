<template>
    <FloatingPane
        :uid='uid'
        @close='dock'
    >
        <template #header>
            <div class='d-flex align-items-center gap-2 mx-2'>
                <IconHeadset
                    :size='18'
                    class='text-warning'
                />
                <span class='fw-semibold'>Dispatcher</span>
            </div>
        </template>
        <CadMain floating />
    </FloatingPane>
</template>

<script setup lang="ts">
import { onUnmounted } from 'vue';
import { IconHeadset } from '@tabler/icons-vue';
import FloatingPane from '../../../src/components/CloudTAK/util/FloatingPane.vue';
import CadMain from './CadMain.vue';
import { dispatcherStore } from '../lib/dispatcher-store.ts';

defineProps<{ uid: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

function dock() {
    dispatcherStore.floating = false;
    emit('close');
}

// Pane torn down by any other path (plugin disable, map teardown) → let the anchored
// menu view resume instead of showing the dock-back placeholder forever.
onUnmounted(() => {
    dispatcherStore.floating = false;
});
</script>
