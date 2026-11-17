<template>
    <!-- Always mounted while an Event is open, so F2 works while the line is hidden -->
    <div
        ref='root'
        class='flex-shrink-0'
    >
        <div
            v-if='commandState.shown'
            class='border-bottom px-3 py-2'
            data-test='command-line'
        >
            <!-- One box: the incident a command with no number is for, then the line to type -->
            <div class='input-group input-group-sm flex-nowrap'>
                <span
                    class='input-group-text font-monospace'
                    :class='current ? "fw-semibold" : "text-muted"'
                    :title='current ? "Commands with no number are for this incident" : "No incident is open: start the command with its number"'
                    data-test='command-current'
                >{{ current ? current.number : 'No incident' }}</span>
                <input
                    ref='box'
                    v-model='text'
                    type='text'
                    class='form-control border font-monospace'
                    autocomplete='off'
                    spellcheck='false'
                    :placeholder='pick ? "Type its number, then Enter" : "Command, then Enter (? lists them)"'
                    data-test='command-box'
                    @keydown='onKey'
                    @keyup.esc.stop
                >
            </div>
            <!-- Several things match what was typed: pick one by its number -->
            <div
                v-if='pick'
                class='small mt-1'
                data-test='command-pick'
            >
                <div class='text-warning'>
                    {{ pick.title }}
                </div>
                <div
                    v-for='(o, i) in pick.options'
                    :key='i'
                >
                    <span class='fw-semibold'>{{ i + 1 }}</span> {{ o.label }}
                </div>
                <div
                    v-if='result?.bad'
                    class='text-danger'
                >
                    {{ result.text }}
                </div>
            </div>
            <!-- What the line means so far (before Enter), or what the last command did -->
            <div
                v-else-if='shownLine'
                class='small mt-1'
                :class='shownLine.cls'
                data-test='command-result'
            >
                {{ shownLine.text }}
            </div>
            <div
                v-if='help'
                class='small mt-1 overflow-auto'
                style='max-height:220px'
                data-test='command-help'
            >
                <div class='text-muted'>
                    A number first names the incident (14 T text). Left out, it is the incident shown at the left.
                </div>
                <div
                    v-for='c in COMMANDS'
                    :key='c.verb'
                    class='d-flex gap-2'
                >
                    <span
                        class='font-monospace fw-semibold text-nowrap'
                        style='min-width:150px'
                    >{{ c.example }}</span>
                    <span>{{ c.does }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
// The Dispatcher command line: one box where a dispatcher types what the buttons do (lib/command-line.ts
// reads the line). Every command runs the same code as its button: the incident actions in
// lib/incident-actions.ts, the incident list (IncidentListView.vue) and the Dispatcher frame (CadMain.vue).
// F2 shows it and puts the cursor in it, in whichever window has the Dispatcher; Esc leaves it.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useMapStore } from '../../../src/stores/map.ts';
import { dispatcherStore as store } from '../lib/dispatcher-store.ts';
import { addCaller, updateCaller, getDispatcherSettings } from '../lib/events-client.ts';
import type { DispatcherIncident } from '../lib/events-client.ts';
import type { TakContact } from '../lib/contacts-client.ts';
import { fetchContactsShared, loadIncidents } from '../lib/incident-poll.ts';
import { undockIncident, closeUndocked, closeAllUndocked } from '../lib/undock-panes.ts';
import { popOutDispatcher, dockDispatcher } from '../lib/float-pane.ts';
import { busyUnits, workingUids } from '../lib/unit-status.ts';
import type { IncidentQueue } from '../lib/unit-status.ts';
import { DISPOSITIONS, DISPOSITION_OTHER, DISPOSITION_NOTE_MAX, REOPEN_REASON_MAX, dispositionLabel } from '../lib/dispositions.ts';
import { incidentTypeOptions } from '../lib/incident-types.ts';
import {
    assignAction, unitStatusAction, removeUnitAction, addNoteAction, reportNumberAction, callerAction,
    closeAction, reopenAction, flyToIncident,
} from '../lib/incident-actions.ts';
import type { ActionContext } from '../lib/incident-actions.ts';
import { commandState, setCommandLineShown, panelUndock, incidentList, workOn } from '../lib/command-state.ts';
import type { CommandActions, ListApi } from '../lib/command-state.ts';
import {
    COMMANDS, parseLine, words, targetIncident, pickUnit, resolveUnits, actOnEach, unitRows, matchOptions,
    readDisposition, parseCaller, parseNew, pushHistory,
} from '../lib/command-line.ts';
import type { ParsedLine, UnitRow } from '../lib/command-line.ts';

const props = defineProps<{
    // The Dispatcher frame's own buttons (CadMain.vue).
    actions: CommandActions;
}>();

const mapStore = useMapStore();

const root = ref<HTMLElement | null>(null);
const box  = ref<HTMLInputElement | null>(null);
const text = ref('');
const busy = ref(false);
const help = ref(false);
// What the last command did, or why it did not run. A refused line stays in the box to be fixed; `line` is
// that text, so its reason keeps showing until the dispatcher changes it.
const result = ref<{ text: string; bad: boolean; line?: string } | null>(null);

// ── A numbered list to pick from, when what was typed fits several things ────────────────────────────
interface Pick {
    title:   string;
    options: { label: string }[];
    answer:  (index: number | null) => void;
}
const pick = ref<Pick | null>(null);
const PICK_MAX = 9;
// Esc at a pick list: the command stops and nothing is done.
const CANCELLED = Symbol('cancelled');

function ask<T>(title: string, options: { label: string; value: T }[]): Promise<T> {
    const shown = options.slice(0, PICK_MAX);
    const more = options.length > shown.length ? ` (first ${PICK_MAX}; Esc and type more of it)` : '';
    return new Promise<T>((resolve, reject) => {
        pick.value = {
            title:   title + more,
            options: shown,
            answer:  (i) => {
                pick.value = null;
                if (i === null) reject(CANCELLED);
                else resolve(shown[i].value);
            },
        };
    });
}

// A word that fits several units (lib/command-line.ts never guesses): the dispatcher picks from a list.
function askUnit<T>(label: (unit: T) => string): (word: string, options: T[]) => Promise<T> {
    return (word, options) => ask(`Which unit is "${word}"?`, options.map(u => ({ label: label(u), value: u })));
}

// ── Which incident ───────────────────────────────────────────────────────────────────────────────────
const current = computed<DispatcherIncident | null>(() =>
    store.incidents.find(i => i.id === commandState.current) ?? null);

// The incident a command is for: the number typed first, else the one the dispatcher is working.
function target(p: ParsedLine): DispatcherIncident {
    const inc = targetIncident(store.incidents, p, commandState.current);
    if ('error' in inc) throw new Error(inc.error);
    return inc;
}

function active(inc: DispatcherIncident): DispatcherIncident {
    if (inc.status !== 'active') throw new Error(`${inc.number} is closed.`);
    return inc;
}

// The incident as the board has it now (a pick list or a contacts fetch may have taken a while).
function fresh(inc: DispatcherIncident): DispatcherIncident {
    return store.incidents.find(i => i.id === inc.id) ?? inc;
}

function context(): ActionContext {
    const ev = store.activeEvent;
    return { mapStore, eventFor: i => (ev && ev.id === i.event_id ? ev : null) };
}

// ── Units ────────────────────────────────────────────────────────────────────────────────────────────
// For On Scene / Clear / remove: the units on the numbered incident, else on every open one.
function rowsFor(p: ParsedLine, want: 'assigned' | 'working'): UnitRow[] {
    return unitRows(p.incident ? [target(p)] : store.incidents, want);
}

const rowLabel = (r: UnitRow) => `${r.callsign} · ${r.inc.number}`;

// The live contact list, as the incident's own search has it. Kept when a refresh fails.
const contacts = ref<TakContact[]>([]);
async function loadContacts(): Promise<void> {
    try { contacts.value = await fetchContactsShared(); }
    catch { /* keep the last list */ }
}

// Why a contact cannot be assigned to this incident, in the server's words; '' when it can.
function cannotAssign(c: TakContact, inc: DispatcherIncident): string {
    if (workingUids(fresh(inc).assigned).has(c.uid)) return `${c.callsign} is already on ${inc.number}.`;
    const elsewhere = busyUnits(store.incidents, inc.id).get(c.uid);
    return elsewhere ? `${c.callsign} is on ${elsewhere}. Clear it there first.` : '';
}

// ── The commands ─────────────────────────────────────────────────────────────────────────────────────

// The incident list, with Settings or the Event report closed first if one is showing.
async function board(): Promise<ListApi> {
    props.actions.board();
    await nextTick();
    const list = incidentList();
    if (!list) throw new Error('The incident list is not showing.');
    return list;
}

// Nothing typed into a new incident is thrown away by a command.
function keepForm(list: ListApi | null): void {
    if (list?.view() === 'form') throw new Error('A new incident is open. Create or cancel it first.');
}

const TABS: Record<string, IncidentQueue> = { U: 'unassigned', A: 'active', C: 'closed' };

// Runs one command; returns the line to show when it is done.
async function run(p: ParsedLine): Promise<string> {
    switch (p.verb) {
        case '?':
            help.value = !help.value;
            return '';

        case '': {
            const inc = target(p);
            if (store.undocked.includes(inc.id)) {
                workOn(inc.id);
                undockIncident(inc.id);   // already in its own window: bring that to the front
                return `${inc.number} is in its own window`;
            }
            const list = await board();
            keepForm(list);
            list.open(inc.id);
            return `${inc.number} ${inc.type ?? ''}`.trim();
        }

        case 'L': {
            const key = p.rest.slice(0, 1).toUpperCase();
            const tab = key ? TABS[key] : undefined;
            if (key && !tab) throw new Error('L alone, or L U, L A, L C for a tab.');
            if (tab === 'unassigned' && store.displayMode !== 'multi') throw new Error('The Unassigned tab is in Multi-Monitor Mode only.');
            const list = await board();
            keepForm(list);
            list.list(tab);
            return '';
        }

        case 'N': {
            const { type, address } = parseNew(p.rest);
            let name: string | undefined;
            if (type) {
                const types = incidentTypeOptions(await getDispatcherSettings().catch(() => ({})));
                const m = matchOptions(type, types);
                if (!m.length) throw new Error(`No incident type matches "${type}". For an address alone: N , 120 main`);
                name = m.length === 1 ? m[0].name : (await ask(`Which type is "${type}"?`,
                    m.map(t => ({ label: t.code ? `${t.code}  ${t.name}` : t.name, value: t })))).name;
            }
            const list = await board();
            keepForm(list);
            list.newIncident({ type: name, address });
            return `New incident${name ? `: ${name}` : ''}. Enter takes the marked address; Enter again creates it.`;
        }

        case 'A': {
            const inc = active(target(p));
            const typed = words(p.rest);
            if (!typed.length) throw new Error('Which unit? A H35');
            await loadContacts();
            // Every contact is a candidate, so two with the same ID are always asked about, even when
            // one of them cannot go; the one meant is then checked.
            const chosen = await resolveUnits(typed, contacts.value, {
                ask:  askUnit(c => (cannotAssign(c, inc) ? `${c.callsign} · ${cannotAssign(c, inc)}` : c.callsign)),
                none: w => new Error(`No unit matches "${w}".`),
            });
            for (const c of chosen) {
                const why = cannotAssign(c, inc);
                if (why) throw new Error(why);
            }
            try {
                await assignAction(context(), fresh(inc), chosen);
            } catch (e) {
                await loadIncidents();   // a refusal: the board shows where the unit is
                throw e;
            }
            return `${inc.number}: assigned ${chosen.map(c => c.callsign).join(', ')}`;
        }

        case 'O':
        case 'C': {
            const to = p.verb === 'O' ? 'on_scene' : 'cleared';
            const typed = words(p.rest);
            if (!typed.length) throw new Error(`Which unit? ${p.verb} H35`);
            // Every word is settled before any unit is changed: a line with a wrong word does nothing.
            const rows = await resolveUnits(typed, rowsFor(p, to === 'on_scene' ? 'assigned' : 'working'), {
                ask:  askUnit(rowLabel),
                none: w => new Error(to === 'on_scene'
                    ? `No unit "${w}" is Assigned on an open incident.`
                    : `No unit "${w}" is on an open incident.`),
            });
            const done = await actOnEach(rows, async (row) => {
                await unitStatusAction(context(), fresh(row.inc), row.unit, to);
                return `${row.inc.number}: ${row.callsign} ${to === 'on_scene' ? 'On Scene' : 'Cleared'}`;
            });
            return done.join(' · ');
        }

        case 'UN': {
            const typed = words(p.rest);
            if (typed.length !== 1) throw new Error('One unit: UN H35');
            const [row] = await resolveUnits(typed, rowsFor(p, 'working'), {
                ask:  askUnit(rowLabel),
                none: w => new Error(`No unit "${w}" is on an open incident.`),
            });
            await removeUnitAction(context(), fresh(row.inc), row.unit);
            return `${row.inc.number}: ${row.callsign} removed`;
        }

        case 'T': {
            const inc = active(target(p));
            if (!p.rest) throw new Error('Add the note: T caller says the door is open');
            await addNoteAction(context(), fresh(inc), p.rest);
            return `${inc.number}: note added`;
        }

        case 'X': {
            const inc = active(target(p));
            let d = readDisposition(p.rest, DISPOSITIONS, DISPOSITION_OTHER);
            if ('ask' in d) {
                const name = await ask('Which disposition?', d.ask.map(n => ({ label: n, value: n })));
                d = readDisposition(name, DISPOSITIONS, DISPOSITION_OTHER);
            }
            if (!('disposition' in d)) throw new Error('error' in d ? d.error : 'Pick one disposition.');
            const closed = await closeAction(context(), fresh(inc), d.disposition, d.note.slice(0, DISPOSITION_NOTE_MAX));
            // As the Close Incident button does: the panel goes back to its list.
            const list = incidentList();
            if (list?.detailId() === inc.id) list.list();
            return `${inc.number} closed: ${dispositionLabel(closed)}`;
        }

        case 'R': {
            const inc = target(p);
            if (inc.status !== 'closed') throw new Error(`${inc.number} is not closed.`);
            if (store.operatorNumbers && !p.rest) throw new Error('Add the reason: R caller called back');
            // The reason is kept either way: as the server's "Reopened: …" note.
            await reopenAction(context(), fresh(inc), p.rest.slice(0, REOPEN_REASON_MAX));
            return `${inc.number} reopened`;
        }

        case 'RN': {
            const inc = target(p);
            if (!p.rest) throw new Error('Add the report number: RN 26-00123');
            await reportNumberAction(fresh(inc), p.rest.slice(0, 64));
            return `${inc.number}: report number ${p.rest.slice(0, 64)}`;
        }

        case 'CA': {
            const inc = target(p);
            const c = parseCaller(p.rest);
            if (!c.name && !c.phone) throw new Error('Enter a caller name or phone number: CA J Smith, 555-0100');
            await callerAction(context(), () => addCaller(inc.id, {
                name: c.name.slice(0, 120), phone: c.phone.slice(0, 40), note: c.note.slice(0, 200),
            }));
            return `${inc.number}: caller added`;
        }

        case 'CP': {
            const inc = target(p);
            const callers = inc.callers ?? [];
            const c = /^\d+$/.test(p.rest) ? callers[Number(p.rest) - 1] : undefined;
            if (!c) throw new Error(`${inc.number} has ${callers.length} caller${callers.length === 1 ? '' : 's'}. CP 2 makes the second one primary.`);
            await callerAction(context(), () => updateCaller(inc.id, c.id, { primary: true }));
            return `${inc.number}: ${c.name || c.phone || 'caller'} is primary`;
        }

        case 'M': {
            const inc = target(p);
            flyToIncident(mapStore, inc);
            return `${inc.number} shown on the map`;
        }

        case 'W': {
            const inc = target(p);
            const panel = panelUndock(inc.id);
            workOn(inc.id);
            // The panel's Undock takes what is being typed along; otherwise open (or raise) its window.
            if (panel && !store.undocked.includes(inc.id)) panel();
            else undockIncident(inc.id);
            return `${inc.number} is in its own window`;
        }

        case 'WX': {
            if (p.rest.toUpperCase() === 'ALL') {
                closeAllUndocked();
                return 'All incident windows closed';
            }
            if (p.rest) throw new Error('WX closes one window, WX ALL closes them all.');
            const inc = target(p);
            if (!store.undocked.includes(inc.id)) throw new Error(`${inc.number} is not in its own window.`);
            closeUndocked(inc.id);
            return `${inc.number}: window closed`;
        }

        case 'SI': {
            if (!store.operatorNumbers) throw new Error('Employee Numbers is off (Dispatcher Settings).');
            const problem = props.actions.signIn(p.rest);
            if (problem) throw new Error(problem);
            return `Signed in as #${store.operator}`;
        }

        case 'SO':
            props.actions.signOut();
            return 'Signed out';

        case 'EV':
            keepForm(incidentList());
            props.actions.switchEvent();
            return '';

        case 'REP':
            keepForm(incidentList());
            props.actions.report();
            return '';

        case 'SET':
            keepForm(incidentList());
            props.actions.settings();
            return '';

        case 'POP':
            if (store.floating) throw new Error('The Dispatcher is already popped out.');
            popOutDispatcher();
            return '';

        case 'DOCK':
            if (!store.floating) throw new Error('The Dispatcher is in its panel.');
            dockDispatcher();
            return '';

        default:
            throw new Error(`${p.verb} is not a command. Type ? for the list.`);
    }
}

// ── What the line means so far, shown before Enter ───────────────────────────────────────────────────
const ON_AN_INCIDENT = new Set(['', 'A', 'T', 'X', 'R', 'RN', 'CA', 'CP', 'M', 'W', 'WX']);
const BY_UNIT = new Set(['O', 'C', 'UN']);

// Each typed unit as Enter will read it: the callsign it names, a ? when Enter will ask, and the reason
// when Enter will refuse.
function previewUnits(p: ParsedLine): { text: string; bad: boolean } {
    let bad = false;
    const shown = words(p.rest).map((w) => {
        if (p.verb === 'A') {
            const pick = pickUnit(w, contacts.value);
            if (pick.kind !== 'one') return `${w}?`;
            const why = cannotAssign(pick.unit, target(p));
            if (why) bad = true;
            return why || pick.unit.callsign;
        }
        const pick = pickUnit(w, rowsFor(p, p.verb === 'O' ? 'assigned' : 'working'));
        return pick.kind === 'one' ? rowLabel(pick.unit) : `${w}?`;
    });
    return { text: shown.join(', '), bad };
}

const preview = computed<{ text: string; bad: boolean } | null>(() => {
    const p = parseLine(text.value);
    if (!p) return null;
    if ('error' in p) return { text: p.error, bad: true };
    const does = COMMANDS.find(c => c.verb === p.verb)?.does ?? '';
    try {
        if (BY_UNIT.has(p.verb) || p.verb === 'A') {
            const on = p.verb === 'A' || p.incident ? `${target(p).number}: ` : '';
            const units = previewUnits(p);
            return { text: `→ ${on}${does} ${units.text}`.trim(), bad: units.bad };
        }
        if (ON_AN_INCIDENT.has(p.verb) && !(p.verb === 'WX' && p.rest)) {
            const inc = target(p);
            return { text: `→ ${inc.number} ${inc.type ?? ''}: ${does}`, bad: false };
        }
        return { text: `→ ${does}`, bad: false };
    } catch (e) {
        return { text: e instanceof Error ? e.message : String(e), bad: true };
    }
});

const shownLine = computed<{ text: string; cls: string } | null>(() => {
    if (result.value?.bad && result.value.line === text.value) return { text: result.value.text, cls: 'text-danger' };
    if (preview.value) return { text: preview.value.text, cls: preview.value.bad ? 'text-warning' : 'text-muted' };
    if (result.value) return { text: result.value.text, cls: result.value.bad ? 'text-danger' : 'text-success' };
    return null;
});

// ── Keys ─────────────────────────────────────────────────────────────────────────────────────────────
let history: string[] = [];
let historyAt = -1;

async function submit() {
    const p0 = pick.value;
    if (p0) {
        // A pick list is waiting: the box holds the number of the one meant.
        const n = /^\d+$/.test(text.value.trim()) ? Number(text.value.trim()) : 0;
        if (n < 1 || n > p0.options.length) {
            result.value = { text: `Type a number from 1 to ${p0.options.length}, or Esc.`, bad: true, line: text.value };
            return;
        }
        text.value = '';
        p0.answer(n - 1);
        return;
    }
    if (busy.value) return;
    const line = text.value;
    const p = parseLine(line);
    if (!p) return;
    if ('error' in p) {
        result.value = { text: p.error, bad: true, line };
        return;
    }
    history = pushHistory(history, line);
    historyAt = -1;
    text.value = '';
    result.value = null;
    busy.value = true;
    try {
        const said = await run(p);
        result.value = said ? { text: said, bad: false } : null;
    } catch (e) {
        // Nothing was done: the line comes back to be fixed.
        text.value = line;
        result.value = e === CANCELLED ? null : { text: e instanceof Error ? e.message : String(e), bad: true, line };
    } finally {
        pick.value = null;
        busy.value = false;
    }
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
    } else if (e.key === 'Escape') {
        // Esc never reaches CloudTAK from here (its Esc closes the menu panel the Dispatcher is in).
        e.preventDefault();
        e.stopPropagation();
        if (pick.value) pick.value.answer(null);
        else if (help.value) help.value = false;
        else if (text.value) text.value = '';
        else box.value?.blur();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !pick.value && history.length) {
        e.preventDefault();
        if (e.key === 'ArrowUp') historyAt = historyAt < 0 ? history.length - 1 : Math.max(0, historyAt - 1);
        else historyAt = historyAt < 0 || historyAt + 1 >= history.length ? -1 : historyAt + 1;
        text.value = historyAt < 0 ? '' : history[historyAt];
    }
}

function focusBox() {
    void loadContacts();   // so the line can name units as they are typed
    nextTick(() => {
        box.value?.focus();
        box.value?.select();
    });
}

// F2, in the window this Dispatcher is in (the CloudTAK page, or the Multi-Monitor workspace window):
// show the line if it is hidden and put the cursor in it. Only a real key press, with no modifier.
function onWindowKey(e: KeyboardEvent) {
    if (e.key !== 'F2' || !e.isTrusted || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (!commandState.shown) setCommandLineShown(true);
    focusBox();
}

// Turned on with its button: the cursor goes in it. Turned off: nothing is left waiting.
watch(() => commandState.shown, (shown) => {
    if (shown) focusBox();
    else {
        pick.value?.answer(null);
        help.value = false;
        result.value = null;
        text.value = '';
    }
});

let win: Window | null = null;
onMounted(() => {
    win = root.value?.ownerDocument.defaultView ?? window;
    win.addEventListener('keydown', onWindowKey, true);
});
onBeforeUnmount(() => {
    win?.removeEventListener('keydown', onWindowKey, true);
    pick.value?.answer(null);
});
</script>
