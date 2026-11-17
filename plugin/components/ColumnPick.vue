<template>
    <div ref='root'>
        <button
            type='button'
            class='form-select form-select-sm border text-start text-truncate'
            data-test='column-pick'
            :aria-expanded='open'
            :disabled='disabled'
            @click='open = !open'
            @keydown.esc='open = false'
        >
            {{ current }}
        </button>
        <div
            v-if='open'
            class='border rounded mt-1 overflow-auto'
            style='max-height:14rem'
            role='listbox'
            @keydown.esc='open = false'
        >
            <button
                v-for='o in options'
                :key='o.value'
                type='button'
                class='dropdown-item small'
                role='option'
                :class='{ active: o.value === modelValue }'
                :aria-selected='o.value === modelValue'
                @click='pick(o.value)'
            >
                {{ o.label }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
// A pick list that opens in the page, under its own button, in place of a native <select>. A native
// list with many options can open on top of the pointer; letting go of the button then chooses
// whatever option is under it. This one only ever opens below, and only a click on an option chooses it.
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
    modelValue: string | undefined;
    options: { value: string; label: string }[];
    disabled?: boolean;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const current = computed(() => props.options.find(o => o.value === (props.modelValue ?? ''))?.label ?? props.modelValue ?? '');

function pick(v: string) {
    emit('update:modelValue', v);
    open.value = false;
}

// A click anywhere else closes the list without choosing.
function onDocDown(ev: MouseEvent) {
    if (open.value && root.value && !root.value.contains(ev.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocDown));
onUnmounted(() => document.removeEventListener('mousedown', onDocDown));
</script>
