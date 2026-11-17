<!-- Dispatcher Settings → Incident Types (standalone). The admin's own incident types, each a name with
     an optional short code: loaded from a two-column CSV file or typed in one at a time, plus the
     switch that hides the built-in types. CloudTAK system admin only; everyone else reads the list.
     The list logic and the file reader are lib/incident-types.ts. -->
<template>
    <div>
        <div class='small text-muted fw-semibold text-uppercase mb-1 d-flex align-items-center gap-2'>
            Incident Types
            <span
                class='badge bg-secondary text-white fw-normal'
                title='Only a CloudTAK system admin can change this'
            >CloudTAK admin only</span>
        </div>
        <div class='card border'>
            <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                <div class='form-check form-switch mb-0'>
                    <input
                        id='incidentTypesOnly'
                        v-model='only'
                        class='form-check-input'
                        type='checkbox'
                        data-test='incident-types-only'
                        :disabled='!isAdmin || saving'
                        @change='saveOnly'
                    >
                    <label
                        class='form-check-label'
                        for='incidentTypesOnly'
                    >Use only these incident types</label>
                </div>
                <div class='text-muted small'>
                    On: the built-in types are removed and dispatchers pick from this list only, in this
                    order. Off: this list is added to the built-in types.
                </div>
                <div
                    v-if='only && !types.length'
                    class='text-warning small'
                    data-test='incident-types-empty'
                >
                    This list is empty, so dispatchers still see the built-in types.
                </div>

                <div
                    class='border rounded overflow-auto'
                    style='max-height:280px'
                    data-test='incident-types-list'
                >
                    <div
                        v-for='t in types'
                        :key='t.name'
                        class='d-flex align-items-center gap-2 px-2 py-1 border-bottom'
                    >
                        <span
                            class='fw-semibold flex-shrink-0'
                            style='width:6.5em'
                        >{{ t.code || '—' }}</span>
                        <span class='flex-grow-1'>{{ t.name }}</span>
                        <button
                            v-if='isAdmin'
                            class='btn btn-link btn-sm p-0 text-danger text-decoration-none flex-shrink-0'
                            style='min-height:0;line-height:1'
                            type='button'
                            :title='`Remove ${t.name}`'
                            :aria-label='`Remove ${t.name}`'
                            :disabled='saving'
                            @click='removeType(t)'
                        >
                            <IconTrash
                                :size='16'
                                stroke='1'
                            />
                        </button>
                    </div>
                    <div
                        v-if='!types.length'
                        class='text-muted px-2 py-1'
                    >
                        No incident types loaded yet
                    </div>
                </div>
                <div
                    v-if='types.length'
                    class='text-muted'
                >
                    {{ types.length }} {{ types.length === 1 ? 'type' : 'types' }}
                </div>

                <label class='mb-0 text-muted'>Load from a CSV file (replaces this list)
                    <input
                        type='file'
                        accept='.csv,text/csv'
                        class='form-control form-control-sm border'
                        data-test='incident-types-file'
                        :disabled='!isAdmin || saving'
                        @change='onFile'
                    >
                </label>
                <div class='d-flex align-items-center flex-wrap gap-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        type='button'
                        data-test='incident-types-example'
                        @click='downloadExample'
                    >
                        Download example CSV
                    </button>
                    <span class='text-muted'>
                        Two columns, code then name, one type per row. The code can be left empty.
                    </span>
                </div>

                <div class='d-flex gap-1'>
                    <input
                        v-model='newCode'
                        type='text'
                        class='form-control form-control-sm border flex-shrink-0'
                        style='width:6.5em'
                        placeholder='Code'
                        aria-label='Code'
                        :maxlength='INCIDENT_TYPE_CODE_MAX'
                        data-test='incident-type-code'
                        :disabled='!isAdmin || saving'
                        @keyup.enter='addType'
                    >
                    <input
                        v-model='newName'
                        type='text'
                        class='form-control form-control-sm border flex-grow-1'
                        placeholder='Add one incident type…'
                        aria-label='Name'
                        :maxlength='INCIDENT_TYPE_NAME_MAX'
                        data-test='incident-type-name'
                        :disabled='!isAdmin || saving'
                        @keyup.enter='addType'
                    >
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        type='button'
                        :disabled='!isAdmin || !newName.trim() || saving'
                        @click='addType'
                    >
                        Add
                    </button>
                </div>

                <div
                    v-if='problems.length'
                    class='alert alert-danger d-block py-1 px-2 small mb-0'
                    data-test='incident-types-problems'
                >
                    <div
                        v-for='p in problems.slice(0, PROBLEMS_SHOWN)'
                        :key='p'
                    >
                        {{ p }}
                    </div>
                    <div v-if='problems.length > PROBLEMS_SHOWN'>
                        …and {{ problems.length - PROBLEMS_SHOWN }} more.
                    </div>
                </div>
                <div
                    v-else-if='loaded'
                    class='text-muted d-inline-flex align-items-center gap-1'
                    data-test='incident-types-loaded'
                >
                    <IconCheck
                        :size='16'
                        stroke='1'
                    />{{ loaded }}
                </div>

                <div class='text-muted small'>
                    The code is a short word for the type (letters and digits, {{ INCIDENT_TYPE_CODE_MAX }} at
                    most), shown beside the name in the Incident Type list. Incidents, markers and reports
                    show the name. A change here reaches each dispatcher the next time they start a new
                    incident; incidents already created keep their type.
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { IconCheck, IconTrash } from '@tabler/icons-vue';
import { getDispatcherSettings, putDispatcherSetting } from '../lib/events-client.ts';
import { dispatcherStore } from '../lib/dispatcher-store.ts';
import { downloadFile } from '../lib/report.ts';
import {
    INCIDENT_TYPES_SETTING, INCIDENT_TYPES_ONLY_SETTING, INCIDENT_TYPE_CODE_MAX, INCIDENT_TYPE_NAME_MAX,
    INCIDENT_TYPE_EXAMPLE_CSV, INCIDENT_TYPE_EXAMPLE_NAME,
    incidentTypeCode, incidentTypeFileProblem, incidentTypeName, incidentTypeOptions, incidentTypeProblems, incidentTypesOnly,
    isIncidentTypeCode, parseIncidentTypeCsv, savedIncidentTypes,
} from '../lib/incident-types.ts';
import type { IncidentTypeOption } from '../lib/incident-types.ts';

// CloudTAK system admin (profile flag, read by DispatcherSettings). The server refuses these writes
// for anyone else anyway.
defineProps<{ isAdmin: boolean }>();

// A bad file can have a problem on every row: show the first few and count the rest.
const PROBLEMS_SHOWN = 8;

const types    = ref<IncidentTypeOption[]>([]);
const only     = ref(false);
const newCode  = ref('');
const newName  = ref('');
const saving   = ref(false);
const problems = ref<string[]>([]);
const loaded   = ref('');

// What this card shows is what is saved: hand it to the shared store, so the next New Incident on
// this computer offers it without waiting for a reload of the settings.
function shareTypes() {
    dispatcherStore.incidentTypes = incidentTypeOptions({
        [INCIDENT_TYPES_SETTING]: types.value,
        [INCIDENT_TYPES_ONLY_SETTING]: only.value,
    });
}

// Store a whole list; the screen keeps the old one when the server refuses it.
async function saveTypes(next: IncidentTypeOption[]): Promise<boolean> {
    saving.value = true;
    try {
        await putDispatcherSetting(INCIDENT_TYPES_SETTING, next);
        types.value = next;
        shareTypes();
        return true;
    } catch (e) {
        problems.value = [e instanceof Error ? e.message : String(e)];
        return false;
    } finally {
        saving.value = false;
    }
}

async function saveOnly() {
    problems.value = [];
    loaded.value = '';
    saving.value = true;
    const want = only.value;
    try {
        await putDispatcherSetting(INCIDENT_TYPES_ONLY_SETTING, want);
        shareTypes();
    } catch (e) {
        only.value = !want;
        problems.value = [e instanceof Error ? e.message : String(e)];
    } finally {
        saving.value = false;
    }
}

// A chosen file replaces the list, or changes nothing when any row of it is wrong.
async function onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    problems.value = [];
    loaded.value = '';
    try {
        const tooBig = incidentTypeFileProblem(file.size);
        if (tooBig) {
            problems.value = ['Nothing was loaded.', tooBig];
            return;
        }
        const read = parseIncidentTypeCsv(await file.text());
        if (read.errors.length) {
            problems.value = ['Nothing was loaded. Fix the file and load it again.', ...read.errors];
        } else if (await saveTypes(read.types)) {
            loaded.value = `Loaded ${read.types.length} ${read.types.length === 1 ? 'type' : 'types'} from ${file.name}`;
        }
    } catch {
        problems.value = ['Could not read that file.'];
    } finally {
        // So the same file can be chosen again once it is fixed.
        input.value = '';
    }
}

async function addType() {
    const code = incidentTypeCode(newCode.value);
    const name = incidentTypeName(newName.value);
    if (!name) return;
    problems.value = [];
    loaded.value = '';
    if (code && !isIncidentTypeCode(code)) {
        problems.value = [`The code must be letters and digits only, no spaces, ${INCIDENT_TYPE_CODE_MAX} at most.`];
        return;
    }
    const sameCode = code ? types.value.find(t => t.code === code) : undefined;
    if (sameCode) {
        problems.value = [`The code ${code} is already used by ${sameCode.name}.`];
        return;
    }
    if (types.value.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        problems.value = ['That incident type is already in the list.'];
        return;
    }
    const next = [...types.value, { code, name }];
    // Anything else wrong with the list (an older entry) is said here rather than by the server.
    problems.value = incidentTypeProblems(next);
    if (problems.value.length) return;
    if (await saveTypes(next)) {
        newCode.value = '';
        newName.value = '';
    }
}

async function removeType(t: IncidentTypeOption) {
    problems.value = [];
    loaded.value = '';
    await saveTypes(types.value.filter(x => x.name !== t.name));
}

function downloadExample() {
    downloadFile(INCIDENT_TYPE_EXAMPLE_NAME, 'text/csv', INCIDENT_TYPE_EXAMPLE_CSV);
}

onMounted(async () => {
    try {
        const s = await getDispatcherSettings();
        types.value = savedIncidentTypes(s[INCIDENT_TYPES_SETTING]);
        only.value = incidentTypesOnly(s);
        shareTypes();
    } catch { /* older server without settings route: the list starts empty */ }
});
</script>
