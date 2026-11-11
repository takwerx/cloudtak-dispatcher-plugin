<!-- Dispatcher Settings: everything shared by every event and every dispatcher on this CloudTAK
     (stored in dispatcher_settings). Opened from the Settings button in the Dispatcher's top bar, with or without
     an event open. Things that belong to one event (its report) open from that event's Event report button. -->
<template>
    <div class='d-flex flex-column h-100 overflow-hidden'>
        <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
            <button
                class='btn btn-sm btn-outline-secondary'
                @click='emit("close")'
            >
                ← Back
            </button>
            <span class='fw-semibold'>Dispatcher Settings</span>
        </div>

        <div class='flex-grow-1 overflow-auto p-3 d-flex flex-column gap-3'>
            <div class='text-muted small'>
                These apply to every event and every dispatcher on this CloudTAK.
                An event's own report opens from its Event report button while that event is open.
            </div>

            <!-- Agency header + logo, printed on every event's report -->
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1'>
                    Report Header
                </div>
                <div class='card border'>
                    <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                        <div class='text-muted small'>
                            Appears at the top of every event's after-action report.
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
                                title='Remove logo'
                                aria-label='Remove logo'
                                @click='agency.logo = null'
                            >
                                <IconX
                                    :size='16'
                                    stroke='1'
                                />
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
                                /><IconCheck
                                    v-if='agencySaved'
                                    :size='16'
                                    stroke='1'
                                    class='me-1'
                                />{{ agencySaved ? 'Saved' : 'Save header' }}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <hr class='my-1'>

            <!-- Caller details on map markers -->
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1'>
                    Caller Details
                </div>
                <div class='card border'>
                    <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                        <div class='form-check form-switch mb-0'>
                            <input
                                id='callerOnMarkers'
                                v-model='callerOnMarkers'
                                class='form-check-input'
                                type='checkbox'
                                :disabled='savingCaller'
                                @change='saveCallerOnMarkers'
                            >
                            <label
                                class='form-check-label'
                                for='callerOnMarkers'
                            >Show callers on incident markers</label>
                        </div>
                        <div class='text-muted small'>
                            On: field units see every caller (name, phone, note) and can tap the primary
                            caller's number to call. Off: no caller details reach field devices; they stay
                            in the Dispatcher only. Applies to every dispatcher on this
                            CloudTAK; markers already on the map update the next time the incident changes.
                        </div>
                        <div
                            v-if='callerError'
                            class='text-danger small'
                        >
                            {{ callerError }}
                        </div>
                    </div>
                </div>
            </div>

            <hr class='my-1'>

            <!-- CJIS reminder line on every standalone incident. CloudTAK system admin only. -->
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1 d-flex align-items-center gap-2'>
                    CJIS Reminder
                    <span
                        class='badge bg-secondary text-white fw-normal'
                        title='Only a CloudTAK system admin can change this'
                    >CloudTAK admin only</span>
                </div>
                <div class='card border'>
                    <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                        <div class='form-check form-switch mb-0'>
                            <input
                                id='cjisReminderEnabled'
                                v-model='cjisEnabled'
                                class='form-check-input'
                                type='checkbox'
                                data-test='cjis-enabled'
                                :disabled='!isAdmin || savingCjis'
                                @change='saveCjisEnabled'
                            >
                            <label
                                class='form-check-label'
                                for='cjisReminderEnabled'
                            >Show the reminder on every incident</label>
                        </div>
                        <label class='mb-0 text-muted'>Reminder text
                            <input
                                v-model='cjisText'
                                type='text'
                                maxlength='300'
                                class='form-control form-control-sm border'
                                data-test='cjis-text'
                                :disabled='!isAdmin || savingCjis'
                                :placeholder='CJIS_REMINDER_DEFAULT_TEXT'
                                @keyup.enter='saveCjisText'
                            >
                        </label>
                        <div class='d-flex align-items-center gap-2'>
                            <button
                                class='btn btn-sm btn-outline-secondary'
                                type='button'
                                data-test='cjis-save'
                                :disabled='!isAdmin || savingCjis'
                                @click='saveCjisText'
                            >
                                <span
                                    v-if='savingCjis'
                                    class='spinner-border spinner-border-sm me-1'
                                /><IconCheck
                                    v-if='cjisSaved'
                                    :size='16'
                                    stroke='1'
                                    class='me-1'
                                />{{ cjisSaved ? 'Saved' : 'Save text' }}
                            </button>
                            <span class='text-muted small'>Blank resets to the default wording.</span>
                        </div>
                        <div class='text-muted small'>
                            One line at the top of every standalone incident, for every dispatcher on this
                            CloudTAK. Only the CloudTAK system admin account can turn it off or change the wording.
                        </div>
                        <div
                            v-if='cjisError'
                            class='text-danger small'
                        >
                            {{ cjisError }}
                        </div>
                    </div>
                </div>
            </div>

            <hr class='my-1'>

            <!-- Employee numbers (who took, dispatched and closed each call). Off by default. CloudTAK system admin only. -->
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1 d-flex align-items-center gap-2'>
                    Employee Numbers
                    <span
                        class='badge bg-secondary text-white fw-normal'
                        title='Only a CloudTAK system admin can change this'
                    >CloudTAK admin only</span>
                </div>
                <div class='card border'>
                    <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                        <div class='form-check form-switch mb-0'>
                            <input
                                id='operatorNumbersEnabled'
                                v-model='operatorNumbers'
                                class='form-check-input'
                                type='checkbox'
                                data-test='operator-numbers'
                                :disabled='!isAdmin || savingOperatorNumbers'
                                @change='saveOperatorNumbers'
                            >
                            <label
                                class='form-check-label'
                                for='operatorNumbersEnabled'
                            >Record who took, dispatched and closed each call, by employee number</label>
                        </div>
                        <div class='text-muted small'>
                            For desks that share one CloudTAK login. When on, each dispatcher signs in once
                            with their employee number at the top of the Dispatcher, and every incident
                            records who took each call, the initial dispatcher, who closed it, and who wrote
                            each note, in the incident and on the report. It is not a password login: it
                            records who did what. Off leaves the Dispatcher as it is.
                        </div>
                        <div
                            v-if='operatorNumbersError'
                            class='text-danger small'
                        >
                            {{ operatorNumbersError }}
                        </div>
                    </div>
                </div>
            </div>

            <hr class='my-1'>

            <!-- Display Mode: one monitor (windows over the map) or several (the workspace window). Per computer:
                 any dispatcher sets it, it is remembered in this browser and changes nothing for anyone else. -->
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1 d-flex align-items-center gap-2'>
                    Display Mode
                    <span
                        class='badge bg-info text-dark fw-normal'
                        title='Remembered in this browser on this computer; it does not change anyone else'
                    >This computer only</span>
                </div>
                <div class='card border'>
                    <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                        <div
                            v-for='m in displayModeChoices'
                            :key='m.value'
                            class='form-check mb-0'
                        >
                            <input
                                :id='`displayMode-${m.value}`'
                                v-model='displayMode'
                                class='form-check-input'
                                type='radio'
                                name='displayMode'
                                :value='m.value'
                                :data-test='`display-mode-${m.value}`'
                                @change='saveMode'
                            >
                            <label
                                class='form-check-label'
                                :for='`displayMode-${m.value}`'
                            >
                                <span class='fw-semibold'>{{ m.label }}</span>
                                <span class='d-block text-muted'>{{ m.help }}</span>
                            </label>
                        </div>
                        <span class='text-muted'>
                            Changing it closes the open incident windows, and a popped-out Dispatcher returns to the
                            menu. In Single Monitor Mode the incidents reopen over the map when you go back to the
                            list; in Multi-Monitor Mode they reopen when you press Workspace.
                        </span>
                        <span
                            v-if='displayModeSaved'
                            class='text-muted d-inline-flex align-items-center gap-1'
                        ><IconCheck
                            :size='16'
                            stroke='1'
                        />Saved on this computer</span>
                    </div>
                </div>
            </div>

            <hr class='my-1'>

            <!-- Broadcast mode: how long a closed incident's marker stays on field devices. CloudTAK system admin only. -->
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1 d-flex align-items-center flex-wrap gap-2'>
                    Broadcast Mode Incident Closed Marker Retention
                    <span
                        class='badge bg-secondary text-white fw-normal text-nowrap'
                        title='Only a CloudTAK system admin can change this'
                    >CloudTAK admin only</span>
                </div>
                <div class='card border'>
                    <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                        <div class='d-flex align-items-center gap-2'>
                            <select
                                id='closedMarkerMinutes'
                                v-model.number='closedMinutes'
                                class='form-select form-select-sm border'
                                style='width: auto'
                                data-test='closed-minutes'
                                :disabled='!isAdmin || savingClosed'
                                @change='saveClosedMinutes'
                            >
                                <option
                                    v-for='m in closedMinuteChoices'
                                    :key='m'
                                    :value='m'
                                >
                                    {{ m === 0 ? '0 minutes (as soon as possible)' : `${m} minutes` }}
                                </option>
                            </select>
                            <span
                                v-if='savingClosed'
                                class='spinner-border spinner-border-sm'
                            />
                            <span
                                v-else-if='closedSaved'
                                class='text-muted d-inline-flex align-items-center gap-1'
                            ><IconCheck
                                :size='16'
                                stroke='1'
                            />Saved</span>
                        </div>
                        <div class='text-muted small'>
                            Markers for closed incidents go stale after the set time and are no longer visible on the map.
                        </div>
                        <div
                            v-if='closedError'
                            class='text-danger small'
                        >
                            {{ closedError }}
                        </div>
                    </div>
                </div>
            </div>

            <hr class='my-1'>

            <!-- Custom call types. CloudTAK system admin only. -->
            <div>
                <div class='small text-muted fw-semibold text-uppercase mb-1 d-flex align-items-center gap-2'>
                    Custom Call Types
                    <span
                        class='badge bg-secondary text-white fw-normal'
                        title='Only a CloudTAK system admin can change this'
                    >CloudTAK admin only</span>
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
                                    v-if='isAdmin'
                                    class='btn btn-link p-0 text-white text-decoration-none'
                                    style='font-size:10px;line-height:1'
                                    type='button'
                                    title='Remove custom type'
                                    @click='removeCustomType(t)'
                                >
                                    <IconX
                                        :size='12'
                                        stroke='1'
                                    />
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
                                data-test='call-type-input'
                                :disabled='!isAdmin || savingTypes'
                                @keyup.enter='addCustomType'
                            >
                            <button
                                class='btn btn-sm btn-outline-secondary'
                                type='button'
                                :disabled='!isAdmin || !newTypeName.trim() || savingTypes'
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
                            Built-in types can't be removed. Only the CloudTAK system admin account
                            can add or remove call types.
                        </div>
                    </div>
                </div>
            </div>

        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { IconX, IconCheck } from '@tabler/icons-vue';
import { getDispatcherSettings, putDispatcherSetting } from '../lib/events-client.ts';
import type { AgencySettings } from '../lib/events-client.ts';
import { dispatcherStore, applyOperatorNumbers } from '../lib/dispatcher-store.ts';
import { CJIS_REMINDER_DEFAULT_TEXT, cjisReminderFrom, isSystemAdmin } from '../lib/cjis-reminder.ts';
import { OPERATOR_SETTING, operatorNumbersFrom } from '../lib/operator.ts';
import {
    CLOSED_MARKER_MINUTE_CHOICES, closedMarkerMinutes, closedMarkerMinutesFrom, isClosedMarkerMinutes,
    setClosedMarkerMinutes,
} from '../lib/closed-window.ts';
import { saveDisplayMode } from '../lib/display-mode.ts';
import type { DisplayMode } from '../lib/display-mode.ts';

const emit = defineEmits<{
    (e: 'close'): void;
}>();

// CloudTAK system admin (profile flag). Gates the CJIS reminder, employee numbers, the closed-marker
// window and the custom call types; the server refuses those writes for anyone else anyway.
const isAdmin = ref(false);

// ── Custom call types (deployment-shared, merged over defaults in IncidentForm; admin only) ──
const customTypes     = ref<string[]>([]);
const newTypeName     = ref('');
const savingTypes     = ref(false);
const typeEditorError = ref('');

async function addCustomType() {
    const name = newTypeName.value.trim();
    if (!name || !isAdmin.value) return;
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

// ── Caller details on markers (deployment-shared; default on) ──
const callerOnMarkers = ref(true);
const savingCaller    = ref(false);
const callerError     = ref('');

async function saveCallerOnMarkers() {
    savingCaller.value = true;
    callerError.value = '';
    const want = callerOnMarkers.value;
    try {
        await putDispatcherSetting('caller_on_markers', want);
        dispatcherStore.callerOnMarkers = want;
    } catch (e) {
        callerOnMarkers.value = !want;
        callerError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingCaller.value = false;
    }
}

// ── CJIS reminder (deployment-shared; default on; CloudTAK system admin only) ──
const cjisEnabled = ref(true);
const cjisText    = ref('');
const savingCjis  = ref(false);
const cjisSaved   = ref(false);
const cjisError   = ref('');

// ── Employee numbers (deployment-shared; default off; CloudTAK system admin only) ──
const operatorNumbers       = ref(false);
const savingOperatorNumbers = ref(false);
const operatorNumbersError  = ref('');

async function saveOperatorNumbers() {
    savingOperatorNumbers.value = true;
    operatorNumbersError.value = '';
    const want = operatorNumbers.value;
    try {
        await putDispatcherSetting(OPERATOR_SETTING, want);
        applyOperatorNumbers(want);
    } catch (e) {
        operatorNumbers.value = !want;
        operatorNumbersError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingOperatorNumbers.value = false;
    }
}

async function saveCjisEnabled() {
    savingCjis.value = true;
    cjisError.value = '';
    const want = cjisEnabled.value;
    try {
        await putDispatcherSetting('cjis_reminder_enabled', want);
        dispatcherStore.cjisReminder = { ...dispatcherStore.cjisReminder, enabled: want };
    } catch (e) {
        cjisEnabled.value = !want;
        cjisError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingCjis.value = false;
    }
}

async function saveCjisText() {
    savingCjis.value = true;
    cjisError.value = '';
    const text = cjisText.value.trim();
    try {
        // The server stores the default when the text is blank; mirror that locally.
        await putDispatcherSetting('cjis_reminder_text', text);
        cjisText.value = text || CJIS_REMINDER_DEFAULT_TEXT;
        dispatcherStore.cjisReminder = { ...dispatcherStore.cjisReminder, text: cjisText.value };
        cjisSaved.value = true;
        setTimeout(() => { cjisSaved.value = false; }, 2000);
    } catch (e) {
        cjisError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingCjis.value = false;
    }
}

// ── Display Mode (per computer: remembered in this browser; default Single Monitor; anyone can set it) ──
const displayModeChoices: { value: DisplayMode; label: string; help: string }[] = [
    {
        value: 'single',
        label: 'Single Monitor Mode (default)',
        help:  'Undock opens an incident in a window over the map, inside CloudTAK. Best for one screen.',
    },
    {
        value: 'multi',
        label: 'Multi-Monitor Mode',
        help:  'The Dispatcher pop-out opens a workspace window to drag onto another monitor and maximize: '
             + 'the Dispatcher pinned on its right, undocked incidents opening in the space beside it, the map '
             + 'staying on the first monitor. It closes if the CloudTAK tab is closed or reloaded (one click '
             + 'reopens it). The browser may ask once to allow pop-ups for this site.',
    },
];
const displayMode      = ref<DisplayMode>(dispatcherStore.displayMode);
const displayModeSaved = ref(false);

function saveMode() {
    dispatcherStore.displayMode = displayMode.value = saveDisplayMode(displayMode.value);
    displayModeSaved.value = true;
    setTimeout(() => { displayModeSaved.value = false; }, 2000);
}

// ── Closed-marker retention (deployment-shared; broadcast mode; CloudTAK system admin only) ──
// A value set outside the dropdown's choices (an older or hand-edited setting) is still offered so
// the dropdown shows what is actually in force.
const closedMinutes = ref<number>(closedMarkerMinutes());
const closedMinuteChoices = computed(() => {
    const list = [...CLOSED_MARKER_MINUTE_CHOICES];
    if (!list.includes(closedMinutes.value)) list.push(closedMinutes.value);
    return list.sort((a, b) => a - b);
});
const savingClosed  = ref(false);
const closedSaved   = ref(false);
const closedError   = ref('');

async function saveClosedMinutes() {
    closedError.value = '';
    const want = closedMinutes.value;
    const before = closedMarkerMinutes();
    if (!isClosedMarkerMinutes(want)) {
        closedMinutes.value = before;
        return;
    }
    savingClosed.value = true;
    try {
        await putDispatcherSetting('closed_marker_minutes', want);
        setClosedMarkerMinutes(want);
        closedSaved.value = true;
        setTimeout(() => { closedSaved.value = false; }, 2000);
    } catch (e) {
        closedMinutes.value = before;
        closedError.value = e instanceof Error ? e.message : String(e);
    } finally {
        savingClosed.value = false;
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
    isSystemAdmin().then((admin) => { isAdmin.value = admin; });
    try {
        const s = await getDispatcherSettings();
        callerOnMarkers.value = s.caller_on_markers !== false;
        dispatcherStore.callerOnMarkers = callerOnMarkers.value;
        const cjis = cjisReminderFrom(s);
        cjisEnabled.value = cjis.enabled;
        cjisText.value    = cjis.text;
        dispatcherStore.cjisReminder = cjis;
        operatorNumbers.value = operatorNumbersFrom(s);
        applyOperatorNumbers(operatorNumbers.value);
        closedMinutes.value = setClosedMarkerMinutes(closedMarkerMinutesFrom(s));
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
