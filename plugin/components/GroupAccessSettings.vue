<!-- Dispatcher Settings → Who Can Use Dispatcher (standalone). The TAK groups whose members may use the
     Dispatcher on this CloudTAK; empty lets everyone in. CloudTAK system admin only; the list logic is
     lib/group-access.ts and the server enforces it. -->
<template>
    <div>
        <div class='small text-muted fw-semibold text-uppercase mb-1 d-flex align-items-center gap-2'>
            Who Can Use Dispatcher
            <span
                class='badge bg-secondary text-white fw-normal'
                title='Only a CloudTAK system admin can change this'
            >CloudTAK admin only</span>
        </div>
        <div class='card border'>
            <div class='card-body py-2 px-3 d-flex flex-column gap-2 small'>
                <div class='text-muted small'>
                    Empty: everyone on this CloudTAK can use the Dispatcher. With groups listed, only members of
                    these TAK groups see it. CloudTAK admins can always use it.
                </div>

                <div
                    v-if='groups.length'
                    class='border rounded overflow-auto'
                    style='max-height:200px'
                    data-test='allowed-groups'
                >
                    <div
                        v-for='g in groups'
                        :key='g'
                        class='d-flex align-items-center gap-2 px-2 py-1 border-bottom'
                    >
                        <span class='flex-grow-1'>{{ g }}</span>
                        <button
                            v-if='isAdmin'
                            class='btn btn-sm btn-link text-danger p-0'
                            type='button'
                            :title='`Remove ${g}`'
                            :disabled='saving || listState !== "ready"'
                            @click='remove(g)'
                        >
                            <IconTrash
                                :size='16'
                                stroke='1'
                            />
                        </button>
                    </div>
                </div>
                <div
                    v-else-if='listState === "failed"'
                    class='text-danger'
                    data-test='allowed-groups-failed'
                >
                    The saved list could not be read, so it cannot be changed now. Close Dispatcher Settings and open
                    it again.
                </div>
                <div
                    v-else-if='listState === "loading"'
                    class='text-muted'
                >
                    Loading…
                </div>
                <div
                    v-else
                    class='text-muted fst-italic'
                    data-test='allowed-groups-empty'
                >
                    No groups: everyone can use the Dispatcher.
                </div>

                <div
                    v-if='isAdmin'
                    class='d-flex align-items-center gap-2'
                >
                    <input
                        v-model='typed'
                        type='text'
                        list='dispatcherGroupChoices'
                        :maxlength='ALLOWED_GROUP_NAME_MAX'
                        class='form-control form-control-sm border'
                        placeholder='Pick or type a TAK group'
                        data-test='allowed-group-name'
                        :disabled='saving || listState !== "ready"'
                        @keyup.enter='add'
                        @input='unsure = ""'
                    >
                    <datalist id='dispatcherGroupChoices'>
                        <option
                            v-for='g in choices'
                            :key='g'
                            :value='g'
                        />
                    </datalist>
                    <button
                        class='btn btn-sm btn-outline-secondary text-nowrap'
                        type='button'
                        data-test='allowed-group-add'
                        :disabled='saving || listState !== "ready" || !typed.trim()'
                        @click='add'
                    >
                        <span
                            v-if='saving'
                            class='spinner-border spinner-border-sm me-1'
                        />Add
                    </button>
                </div>
                <div
                    v-if='isAdmin'
                    class='text-muted small'
                >
                    The list shows your own groups. A group you are not in can be typed by its name as TAK Server
                    shows it. A change takes effect for each user the next time CloudTAK loads.
                </div>
                <div
                    v-if='unsure'
                    class='text-warning small'
                    data-test='allowed-group-unsure'
                >
                    {{ unsure }} is not one of your groups. Check it is spelled exactly as TAK Server shows it,
                    then press <b>Add</b> again. A name that matches no group lets no one in but CloudTAK admins.
                </div>
                <div
                    v-if='problem'
                    class='text-danger small'
                >
                    {{ problem }}
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { IconTrash } from '@tabler/icons-vue';
import { getDispatcherSettings, putDispatcherSetting } from '../lib/events-client.ts';
import { getUserChannels } from '../lib/takcad-client.ts';
import { ALLOWED_GROUPS_SETTING, ALLOWED_GROUP_NAME_MAX, addAllowedGroup, allowedGroupsFrom, isKnownGroup } from '../lib/group-access.ts';

// CloudTAK system admin (profile flag, read by DispatcherSettings). The server refuses these writes
// for anyone else anyway.
const props = defineProps<{ isAdmin: boolean }>();

const groups  = ref<string[]>([]);
// Each change stores the whole list, so nothing can be added or removed until the saved list is read:
// a change on top of an empty list that only looks empty would replace the saved one.
const listState = ref<'loading' | 'ready' | 'failed'>('loading');
const mine    = ref<string[]>([]);
const typed   = ref('');
const saving  = ref(false);
const problem = ref('');
// A typed name that is not one of the admin's own groups, waiting for a second Add (lib/group-access.ts).
const unsure  = ref('');

// The admin's own groups not yet in the list, offered as they type.
const choices = computed(() => mine.value.filter(g => !groups.value.some(x => x.toLowerCase() === g.toLowerCase())));

// Store a whole list; the screen keeps the old one when the server refuses it.
async function save(next: string[]): Promise<boolean> {
    saving.value = true;
    problem.value = '';
    try {
        await putDispatcherSetting(ALLOWED_GROUPS_SETTING, next);
        groups.value = next;
        return true;
    } catch (e) {
        problem.value = e instanceof Error ? e.message : String(e);
        return false;
    } finally {
        saving.value = false;
    }
}

async function add() {
    if (listState.value !== 'ready') return;
    const r = addAllowedGroup(groups.value, typed.value);
    if ('problem' in r) {
        problem.value = r.problem;
        return;
    }
    const name = typed.value.trim();
    if (!isKnownGroup(mine.value, name) && unsure.value !== name) {
        problem.value = '';
        unsure.value = name;
        return;
    }
    unsure.value = '';
    if (await save(r.list)) typed.value = '';
}

async function remove(g: string) {
    if (listState.value !== 'ready') return;
    await save(groups.value.filter(x => x !== g));
}

onMounted(async () => {
    // An older server without the setting answers with no allowed_groups: the list is empty and ready.
    try {
        groups.value = allowedGroupsFrom(await getDispatcherSettings());
        listState.value = 'ready';
    } catch {
        listState.value = 'failed';
    }
});

// The admin flag arrives after this card mounts (DispatcherSettings reads the profile).
watch(() => props.isAdmin, async (admin) => {
    if (!admin || mine.value.length) return;
    try {
        mine.value = await getUserChannels();
    } catch { /* no list to pick from: the name can still be typed */ }
}, { immediate: true });
</script>
