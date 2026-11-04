import { dispatcherStore, applyOperatorNumbers } from './dispatcher-store.ts';
import { listIncidents, getDispatcherSettings } from './events-client.ts';
import { cjisReminderFrom } from './cjis-reminder.ts';
import { operatorNumbersFrom } from './operator.ts';
import { closedMarkerMinutesFrom, setClosedMarkerMinutes } from './closed-window.ts';
import { getContacts } from './contacts-client.ts';
import type { TakContact } from './contacts-client.ts';

// Shared 15s poll of the open Event's incidents, so multiple dispatchers converge. Reference
// counted: the menu panel's incident list and every undocked card hold it while mounted, and
// the interval runs once however many of them are open. Undocked cards therefore stay live
// after the menu panel is closed.
const POLL_MS = 15_000;

let holders = 0;
let timer: ReturnType<typeof setInterval> | undefined;

export async function loadIncidents(): Promise<void> {
    const ev = dispatcherStore.activeEvent;
    if (!ev) return;
    try { dispatcherStore.incidents = await listIncidents(ev.id); }
    catch { /* keep previous list */ }
}

// The Dispatcher Settings (caller details on markers, CJIS reminder, employee numbers) are shared across
// dispatchers, so re-read them when the board starts and when an incident is opened (cheap)
// rather than on every poll (the settings blob can carry the agency logo).
export function refreshSharedSettings(): void {
    getDispatcherSettings().then((s) => {
        dispatcherStore.callerOnMarkers = s.caller_on_markers !== false;
        dispatcherStore.cjisReminder = cjisReminderFrom(s);
        applyOperatorNumbers(operatorNumbersFrom(s));
        setClosedMarkerMinutes(closedMarkerMinutesFrom(s));
    }).catch(() => { /* keep last */ });
}

// One contacts fetch for every detail that asks at the same moment (restoring several cards after a
// reload mounts them together); a later call fetches fresh, so newly connected users still show up.
let contactsInFlight: Promise<TakContact[]> | undefined;
export function fetchContactsShared(): Promise<TakContact[]> {
    if (!contactsInFlight) {
        contactsInFlight = getContacts().finally(() => { contactsInFlight = undefined; });
    }
    return contactsInFlight;
}

// Start (or join) the poll; returns a release function. Loads at once on the first hold.
export function acquireIncidentPoll(): () => void {
    holders++;
    if (!timer) {
        loadIncidents();
        refreshSharedSettings();
        timer = setInterval(loadIncidents, POLL_MS);
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holders--;
        if (holders <= 0) {
            holders = 0;
            clearInterval(timer);
            timer = undefined;
        }
    };
}

// The open Event changed: drop the current interval so the next holder starts fresh against
// the new Event (the holders themselves re-acquire).
export function restartIncidentPoll(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
    if (holders > 0) {
        loadIncidents();
        refreshSharedSettings();
        timer = setInterval(loadIncidents, POLL_MS);
    }
}
