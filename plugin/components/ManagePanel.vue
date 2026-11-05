<!-- Manage: what belongs to the open event. Settings shared by every event (report header, caller
     details, CJIS reminder, employee numbers, call types) are in Dispatcher Settings, the gear in the
     Dispatcher's top bar (DispatcherSettings.vue). -->
<template>
    <div class='d-flex flex-column h-100 overflow-hidden'>
        <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
            <button
                class='btn btn-sm btn-outline-secondary'
                @click='emit("close")'
            >
                ← Back
            </button>
            <span class='fw-semibold'>Manage</span>
        </div>

        <div class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'>
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1'>
                    After-Action Report
                </div>
                <div class='card border'>
                    <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                        <div class='text-muted small'>
                            Call counts, narrative, and exports (PDF / CSV / JSON) for this event.
                        </div>
                        <button
                            class='btn btn-sm btn-warning'
                            @click='emit("report")'
                        >
                            Generate report…
                        </button>
                    </div>
                </div>
            </div>

            <div class='text-muted small'>
                Settings shared by every event (report header, caller details, CJIS reminder, employee
                numbers, call types) are in <strong>Dispatcher Settings</strong>, the
                <span aria-hidden='true'>⚙</span> in the Dispatcher's top bar.
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
    (e: 'close'):  void;
    (e: 'report'): void;
}>();
</script>
