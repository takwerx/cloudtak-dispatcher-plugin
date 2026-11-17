<template>
    <FloatingPane
        :uid='uid'
        @close='emit("close")'
    >
        <template #header>
            <div class='d-flex align-items-center gap-2 mx-2'>
                <IconBook
                    :size='18'
                    class='text-warning'
                />
                <span class='fw-semibold'>User Guide</span>
            </div>
        </template>
        <template #actions>
            <button
                type='button'
                class='btn btn-sm btn-outline-secondary d-flex align-items-center gap-1'
                title='Back to the list of topics'
                @click='guide?.show(CONTENTS_ANCHOR)'
            >
                <IconList
                    :size='16'
                    stroke='1'
                />
                Contents
            </button>
        </template>
        <UserGuide ref='guide' />
    </FloatingPane>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { IconBook, IconList } from '@tabler/icons-vue';
import FloatingPane from '../../../src/components/CloudTAK/util/FloatingPane.vue';
import { CONTENTS_ANCHOR } from '../lib/guide.ts';
import UserGuide from './UserGuide.vue';

// The User Guide in its own pane over the map (lib/guide-pane.ts opens it). Contents in the pane's
// top bar stays in view however far down the reader is. CloudTAK's Map closes the pane on 'close';
// on a small screen FloatingPane shows it full screen instead.
defineProps<{ uid: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const guide = ref<InstanceType<typeof UserGuide> | null>(null);
</script>
