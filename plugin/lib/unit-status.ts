import type { AssignedContact, DispatcherIncident } from './events-client.ts';

// Reading unit status (Assigned, On Scene, Cleared) off an incident. Pure, so
// plugin/test/unit-status.test.ts runs it with plain node. The server owns the times.

export type BoardState = 'unassigned' | 'dispatched' | 'on_scene';

export const BOARD_LABEL: Record<BoardState, string> = {
    unassigned: 'Unassigned',
    dispatched: 'Dispatched',
    on_scene: 'On Scene',
};

// A row from before unit status existed has only uid + callsign: it reads as Assigned.
export function unitStatus(u: AssignedContact): 'assigned' | 'on_scene' | 'cleared' {
    return u.status === 'on_scene' || u.status === 'cleared' ? u.status : 'assigned';
}

// What the board shows for an incident, from its units: no unit still working = Unassigned,
// any unit on scene = On Scene, else Dispatched. Cleared units no longer count.
export function boardState(units: AssignedContact[] | undefined): BoardState {
    const live = (units ?? []).filter(u => unitStatus(u) !== 'cleared');
    if (!live.length) return 'unassigned';
    return live.some(u => unitStatus(u) === 'on_scene') ? 'on_scene' : 'dispatched';
}

// Which list an incident is in. Multi-Monitor Mode splits the open incidents into Unassigned (no unit on
// it, including one whose units have all cleared: it needs a unit again) and Active (at least one unit
// Assigned or On Scene); Single Monitor Mode keeps one Active list of every open incident.
export type IncidentQueue = 'unassigned' | 'active' | 'closed';

export function incidentQueue(inc: Pick<DispatcherIncident, 'status' | 'assigned'>, splitUnassigned: boolean): IncidentQueue {
    if (inc.status === 'closed') return 'closed';
    if (!splitUnassigned) return 'active';
    return boardState(inc.assigned) === 'unassigned' ? 'unassigned' : 'active';
}

// The units an incident list card names: the callsigns still on the incident (cleared units have left it),
// in the order they were assigned. Status is left to the incident itself, so a big call stays one short line.
export function rowUnits(units: AssignedContact[] | undefined): string[] {
    return (units ?? []).filter(u => unitStatus(u) !== 'cleared').map(u => u.callsign);
}

// Bootstrap classes for the board badge (list rows, detail, undocked cards).
export function boardBadgeClass(units: AssignedContact[] | undefined): string {
    const b = boardState(units);
    return b === 'on_scene' ? 'bg-warning text-dark' : b === 'dispatched' ? 'bg-info text-dark' : 'bg-light text-dark border';
}

// The marker remarks line: `Responding: E12 (on scene), M4`. Cleared units drop off the line.
export function respondingLine(units: AssignedContact[] | undefined): string {
    const live = (units ?? []).filter(u => unitStatus(u) !== 'cleared');
    if (!live.length) return '';
    return `Responding: ${live.map(u => (unitStatus(u) === 'on_scene' ? `${u.callsign} (on scene)` : u.callsign)).join(', ')}`;
}

// The earliest on-scene time among an incident's units (ISO), or null.
export function firstOnScene(units: AssignedContact[] | undefined): string | null {
    const times = (units ?? []).map(u => u.on_scene_at).filter((t): t is string => !!t && !Number.isNaN(new Date(t).getTime()));
    if (!times.length) return null;
    return times.reduce((a, b) => (new Date(b).getTime() < new Date(a).getTime() ? b : a));
}

// "assigned 05:15 PM · on scene 05:22 PM · cleared 05:39 PM": only the steps that have a time.
export function unitTimesLine(u: AssignedContact, fmt: (iso: string) => string): string {
    return ([['assigned', u.assigned_at], ['on scene', u.on_scene_at], ['cleared', u.cleared_at]] as const)
        .filter(([, t]) => !!t)
        .map(([label, t]) => `${label} ${fmt(t as string)}`)
        .join(' · ');
}

export function boardStateOf(inc: Pick<DispatcherIncident, 'assigned'>): BoardState {
    return boardState(inc.assigned);
}

// The units still working this incident (a row not Cleared). A unit that cleared from it is free
// again, here too: assigning it starts a second trip, a new row; the first keeps its times.
export function workingUids(units: AssignedContact[] | undefined): Set<string> {
    return new Set((units ?? []).filter(u => unitStatus(u) !== 'cleared').map(u => u.uid));
}

// The incident number without the Event prefix: `26-014` -> `014` (same rule as the server's refusal).
export function shortNumber(number: string): string {
    const i = number.lastIndexOf('-');
    return i === -1 ? number : number.slice(i + 1);
}

// One incident per unit: the units still working (Assigned or On Scene) another active incident of
// this Event, uid -> that incident's short number. The assign search and picker grey these out;
// the server refuses them too, so this only spares the dispatcher a refusal.
export function busyUnits(incidents: Pick<DispatcherIncident, 'id' | 'number' | 'status' | 'assigned'>[], currentId: string | undefined): Map<string, string> {
    const busy = new Map<string, string>();
    for (const inc of incidents) {
        if (inc.id === currentId || inc.status !== 'active') continue;
        for (const u of inc.assigned ?? []) {
            if (unitStatus(u) !== 'cleared' && !busy.has(u.uid)) busy.set(u.uid, shortNumber(inc.number));
        }
    }
    return busy;
}
