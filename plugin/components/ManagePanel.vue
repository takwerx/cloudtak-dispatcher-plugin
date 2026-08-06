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
            <!-- Report (incl. the agency header + logo it renders with) -->
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1'>
                    After-Action Report
                </div>
                <div class='card border'>
                    <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                        <div class='text-muted small'>
                            Call counts, narrative, and exports (PDF / CSV / JSON) for this event.
                            The agency header below appears on every report.
                        </div>
                        <label class='mb-0 text-muted'>Agency name
                            <input
                                v-model='agency.name'
                                type='text'
                                class='form-control form-control-sm border'
                                placeholder='e.g. New Hanover Co PS Comms'
                            >
                        </label>
                        <label class='mb-0 text-muted'>Agency ID
                            <input
                                v-model='agency.id'
                                type='text'
                                class='form-control form-control-sm border'
                                placeholder='e.g. FDID / ORI'
                            >
                        </label>
                        <div class='d-flex align-items-center gap-2'>
                            <img
                                v-if='agency.logo'
                                :src='agency.logo'
                                alt='Agency logo'
                                style='max-height:40px;max-width:90px'
                            >
                            <input
                                type='file'
                                accept='image/*'
                                class='form-control form-control-sm border flex-grow-1'
                                @change='onLogoFile'
                            >
                            <button
                                v-if='agency.logo'
                                class='btn btn-sm btn-link text-danger p-0 text-decoration-none'
                                @click='agency.logo = null'
                            >
                                ✕
                            </button>
                        </div>
                        <div
                            v-if='agencyError'
                            class='alert alert-danger py-1 px-2 small mb-0'
                        >
                            {{ agencyError }}
                        </div>
                        <div class='d-flex gap-2'>
                            <button
                                class='btn btn-sm btn-outline-secondary'
                                :disabled='savingAgency'
                                @click='saveAgency'
                            >
                                <span
                                    v-if='savingAgency'
                                    class='spinner-border spinner-border-sm me-1'
                                />{{ agencySaved ? 'Saved ✓' : 'Save header' }}
                            </button>
                            <button
                                class='btn btn-sm btn-warning flex-grow-1'
                                @click='emit("report")'
                            >
                                Generate report…
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <hr class='my-1'>

            <!-- Custom call types -->
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1'>
                    Custom Call Types
                </div>
                <div class='card border'>
                    <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                        <div class='d-flex flex-wrap gap-1'>
                            <span
                                v-for='t in customTypes'
                                :key='t'
                                class='badge bg-secondary text-white d-flex align-items-center gap-1'
                            >
                                {{ t }}
                                <button
                                    class='btn btn-link p-0 text-white text-decoration-none'
                                    style='font-size:10px;line-height:1'
                                    type='button'
                                    title='Remove custom type'
                                    @click='removeCustomType(t)'
                                >
                                    ✕
                                </button>
                            </span>
                            <span
                                v-if='!customTypes.length'
                                class='text-muted small'
                            >No custom call types yet</span>
                        </div>
                        <div class='d-flex gap-1'>
                            <input
                                v-model='newTypeName'
                                type='text'
                                class='form-control form-control-sm border flex-grow-1'
                                placeholder='Add call type…'
                                @keyup.enter='addCustomType'
                            >
                            <button
                                class='btn btn-sm btn-outline-secondary'
                                type='button'
                                :disabled='!newTypeName.trim() || savingTypes'
                                @click='addCustomType'
                            >
                                Add
                            </button>
                        </div>
                        <div
                            v-if='typeEditorError'
                            class='text-danger small'
                        >
                            {{ typeEditorError }}
                        </div>
                        <div class='text-muted small'>
                            Added to the type dropdown for every dispatcher on this CloudTAK.
                            Built-in types can't be removed.
                        </div>
                    </div>
                </div>
            </div>

        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { getDispatcherSettings, putDispatcherSetting } from '../lib/events-client.ts';
import type { AgencySettings } from '../lib/events-client.ts';

const emit = defineEmits<{
    (e: 'close'):  void;
    (e: 'report'): void;
}>();

// ── Custom call types (deployment-shared, merged over defaults in IncidentForm) ──
const customTypes     = ref<string[]>([]);
const newTypeName     = ref('');
const savingTypes     = ref(false);
const typeEditorError = ref('');

async function addCustomType() {
    const name = newTypeName.value.trim();
    if (!name) return;
    typeEditorError.value = '';
    if (customTypes.value.some(t => t.toLowerCase() === name.toLowerCase())) {
        typeEditorError.value = 'That call type already exists';
        return;
    }
    savingTypes.value = true;
    const prev = customTypes.value;
    try {
        customTypes.value = [...prev, name];
        await putDispatcherSetting('incident_types', customTypes.value);
        newTypeName.value = '';
    } catch (e) {
        customTypes.value = prev;
        typeEditorError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingTypes.value = false;
    }
}

async function removeCustomType(name: string) {
    typeEditorError.value = '';
    savingTypes.value = true;
    const prev = customTypes.value;
    try {
        customTypes.value = prev.filter(t => t !== name);
        await putDispatcherSetting('incident_types', customTypes.value);
    } catch (e) {
        customTypes.value = prev;
        typeEditorError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingTypes.value = false;
    }
}

// ── Agency header (moved here from ReportView; reports read it at export time) ──
const agency       = reactive<AgencySettings>({ name: '', id: '', logo: null });
const savingAgency = ref(false);
const agencySaved  = ref(false);
const agencyError  = ref('');

async function saveAgency() {
    savingAgency.value = true;
    agencyError.value = '';
    try {
        await putDispatcherSetting('agency', { name: agency.name.trim(), id: agency.id.trim(), logo: agency.logo });
        agencySaved.value = true;
        setTimeout(() => { agencySaved.value = false; }, 2000);
    } catch (e) {
        agencyError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingAgency.value = false;
    }
}

// Downscale the chosen image to a bounded data URI (≤120px tall) so the logo fits the
// settings row cap and prints crisply without shipping a multi-MB original.
function onLogoFile(ev: Event) {
    agencyError.value = '';
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, 120 / img.height, 360 / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { agencyError.value = 'Could not process image'; return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        agency.logo = canvas.toDataURL('image/png');
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        agencyError.value = 'Could not read image file';
    };
    img.src = url;
}

onMounted(async () => {
    try {
        const s = await getDispatcherSettings();
        const list = s.incident_types;
        if (Array.isArray(list)) {
            customTypes.value = list.filter((t): t is string => typeof t === 'string');
        }
        const saved = s.agency as Partial<AgencySettings> | undefined;
        if (saved) {
            agency.name = saved.name ?? '';
            agency.id   = saved.id ?? '';
            agency.logo = saved.logo ?? null;
        }
    } catch { /* older server without settings route — editors start blank */ }
});
</script>
