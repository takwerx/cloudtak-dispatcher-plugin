<template>
    <div class='d-flex flex-column h-100 overflow-hidden'>
        <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
            <button
                class='btn btn-sm btn-outline-secondary'
                @click='emit("close")'
            >
                ← Back
            </button>
            <span class='fw-semibold text-truncate flex-grow-1'>Report — {{ event.name }}</span>
        </div>

        <div class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'>
            <div
                v-if='loading'
                class='text-center text-muted py-4 small'
            >
                <span class='spinner-border spinner-border-sm me-2' />Loading incidents…
            </div>
            <div
                v-else-if='loadError'
                class='alert alert-danger py-2 small'
            >
                {{ loadError }}
            </div>
            <template v-else>
                <!-- Period -->
                <div>
                    <div class='small text-muted fw-semibold text-uppercase mb-1'>
                        Reporting period
                    </div>
                    <div class='d-flex flex-column gap-1'>
                        <label class='small text-muted mb-0'>From
                            <input
                                v-model='startLocal'
                                type='datetime-local'
                                class='form-control form-control-sm border'
                            >
                        </label>
                        <label class='small text-muted mb-0'>To
                            <input
                                v-model='endLocal'
                                type='datetime-local'
                                class='form-control form-control-sm border'
                            >
                        </label>
                        <button
                            class='btn btn-sm btn-link p-0 text-muted text-decoration-none align-self-start'
                            @click='resetRange'
                        >
                            Reset to full event
                        </button>
                    </div>
                </div>

                <!-- Summary -->
                <div class='card border'>
                    <div class='card-body py-2 px-3 small'>
                        <div class='row g-1'>
                            <div class='col-8 text-muted'>
                                Calls in period
                            </div>
                            <div class='col-4 text-end fw-semibold'>
                                {{ stats.total }}
                            </div>
                            <div class='col-8 text-muted'>
                                Active / Closed
                            </div>
                            <div class='col-4 text-end'>
                                {{ stats.active }} / {{ stats.closed }}
                            </div>
                            <div class='col-8 text-muted'>
                                Notes logged
                            </div>
                            <div class='col-4 text-end'>
                                {{ stats.notesTotal }}
                            </div>
                            <div class='col-8 text-muted'>
                                Avg calls / hour
                            </div>
                            <div class='col-4 text-end'>
                                {{ stats.perHourAvg }}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- By type -->
                <div v-if='stats.byType.length'>
                    <div class='small text-muted fw-semibold text-uppercase mb-1'>
                        Calls by type
                    </div>
                    <div class='card border'>
                        <div class='card-body py-1 px-3 small'>
                            <div
                                v-for='t in stats.byType'
                                :key='t.type'
                                class='d-flex py-1 border-bottom'
                            >
                                <span class='flex-grow-1 text-truncate'>{{ t.type }}</span>
                                <span class='fw-semibold me-2'>{{ t.count }}</span>
                                <span class='text-muted'>{{ t.pct }}%</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Narrative -->
                <div>
                    <div class='small text-muted fw-semibold text-uppercase mb-1'>
                        Narrative
                    </div>
                    <p
                        v-for='(p, idx) in narrative'
                        :key='idx'
                        class='small mb-2'
                    >
                        {{ p }}
                    </p>
                </div>

                <!-- Exports (agency header is edited in ManagePanel; loaded here for rendering) -->
                <div
                    v-if='exportError'
                    class='alert alert-danger py-2 small'
                >
                    {{ exportError }}
                </div>
                <div class='d-flex flex-column gap-2'>
                    <button
                        class='btn btn-sm btn-warning'
                        @click='printReport'
                    >
                        Print / Save as PDF
                    </button>
                    <div class='d-flex gap-2'>
                        <button
                            class='btn btn-sm btn-outline-secondary flex-fill'
                            @click='downloadCsv'
                        >
                            CSV
                        </button>
                        <button
                            class='btn btn-sm btn-outline-secondary flex-fill'
                            @click='downloadJson'
                        >
                            JSON
                        </button>
                        <button
                            class='btn btn-sm btn-outline-secondary flex-fill'
                            title='The printable report as a file — open it in any browser and print to PDF'
                            @click='downloadHtml'
                        >
                            HTML
                        </button>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { listIncidents, getDispatcherSettings } from '../lib/events-client.ts';
import type { DispatcherEvent, DispatcherIncident, AgencySettings } from '../lib/events-client.ts';
import {
    filterByRange, buildStats, buildNarrative, buildReportHtml,
    buildCsv, buildJsonArchive, downloadFile, openPrintWindow, reportFilename,
} from '../lib/report.ts';
import type { ReportRange } from '../lib/report.ts';
import { dispatcherStore } from '../lib/dispatcher-store.ts';

const props = defineProps<{ event: DispatcherEvent }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const loading     = ref(false);
const loadError   = ref('');
const exportError = ref('');
const incidents   = ref<DispatcherIncident[]>([]);

// Agency identity for the report header — edited in ManagePanel, stored server-side;
// loaded here only so exports render it.
const agency = reactive<AgencySettings>({ name: '', id: '', logo: null });

// datetime-local wants 'YYYY-MM-DDTHH:mm' in LOCAL time (toISOString would shift it).
function toLocalInput(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const startLocal = ref('');
const endLocal   = ref('');

function resetRange() {
    startLocal.value = toLocalInput(new Date(props.event.created_at));
    endLocal.value   = toLocalInput(new Date());
}

const range = computed<ReportRange>(() => ({
    start: startLocal.value ? new Date(startLocal.value) : new Date(props.event.created_at),
    end:   endLocal.value ? new Date(endLocal.value) : new Date(),
}));

const inRange   = computed(() => filterByRange(incidents.value, range.value));
const stats     = computed(() => buildStats(inRange.value, range.value));
const narrative = computed(() => buildNarrative(props.event, stats.value, range.value));

function printReport() {
    exportError.value = '';
    const html = buildReportHtml(
        props.event, inRange.value, stats.value, narrative.value,
        range.value, dispatcherStore.dispatcherName, agency,
    );
    if (!openPrintWindow(html)) {
        exportError.value = 'Popup blocked — allow popups for CloudTAK, or use the HTML download and print that file.';
    }
}

function downloadHtml() {
    downloadFile(reportFilename(props.event, 'html'), 'text/html', buildReportHtml(
        props.event, inRange.value, stats.value, narrative.value,
        range.value, dispatcherStore.dispatcherName, agency,
    ));
}

function downloadCsv() {
    downloadFile(reportFilename(props.event, 'csv'), 'text/csv', buildCsv(inRange.value));
}

function downloadJson() {
    downloadFile(reportFilename(props.event, 'json'), 'application/json', buildJsonArchive(
        props.event, inRange.value, stats.value, narrative.value,
        range.value, dispatcherStore.dispatcherName, agency,
    ));
}

onMounted(async () => {
    resetRange();
    loading.value = true;
    try {
        incidents.value = await listIncidents(props.event.id);
    } catch (e) {
        loadError.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
    // Best-effort: an older server without the settings route just leaves the header blank.
    try {
        const saved = (await getDispatcherSettings()).agency as Partial<AgencySettings> | undefined;
        if (saved) {
            agency.name = saved.name ?? '';
            agency.id   = saved.id ?? '';
            agency.logo = saved.logo ?? null;
        }
    } catch { /* settings unavailable — leave defaults */ }
});
</script>
