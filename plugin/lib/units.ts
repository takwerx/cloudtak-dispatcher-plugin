import type { AssignedContact, UnitStatus } from './events-client.ts';

// Unit status helpers shared by the board, the incident marker remarks and the report. Pure:
// no CloudTAK imports, so plugin/test/units-report.test.ts runs this file as it ships.

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
    assigned: 'Assigned',
    onscene:  'On Scene',
    cleared:  'Cleared',
};

// An active incident is Unassigned (no unit on it), Dispatched (a unit is assigned, none on
// scene yet) or On Scene (at least one unit on scene). Cleared units don't count.
export type IncidentStage = 'unassigned' | 'dispatched' | 'onscene';

export const STAGE_LABEL: Record<IncidentStage, string> = {
    unassigned: 'Unassigned',
    dispatched: 'Dispatched',
    onscene:    'On Scene',
};

// Entries from before unit status existed have no status: they read as Assigned.
export function unitStatus(u: Pick<AssignedContact, 'status'>): UnitStatus {
    return u.status === 'onscene' || u.status === 'cleared' ? u.status : 'assigned';
}

export function incidentStage(assigned: AssignedContact[] | null | undefined): IncidentStage {
    const live = (assigned ?? []).filter(u => unitStatus(u) !== 'cleared');
    if (!live.length) return 'unassigned';
    return live.some(u => unitStatus(u) === 'onscene') ? 'onscene' : 'dispatched';
}

// The time the first unit went on scene, and which unit, or null.
export function firstOnScene(assigned: AssignedContact[] | null | undefined): { time: string; callsign: string } | null {
    let best: { time: string; callsign: string } | null = null;
    for (const u of assigned ?? []) {
        if (!u.onscene_at) continue;
        if (!best || new Date(u.onscene_at).getTime() < new Date(best.time).getTime()) best = { time: u.onscene_at, callsign: u.callsign };
    }
    return best;
}

// The "Responding:" line for the incident marker remarks (what field devices see). Cleared
// units are left out; an on-scene unit is marked. Empty string when no unit is responding.
export function respondingRemark(assigned: AssignedContact[] | null | undefined): string {
    const live = (assigned ?? []).filter(u => unitStatus(u) !== 'cleared');
    if (!live.length) return '';
    return 'Responding: ' + live.map(u => (unitStatus(u) === 'onscene' ? `${u.callsign} (on scene)` : u.callsign)).join(', ');
}

// "assigned 14:02 · on scene 14:09 · cleared 14:40" with the caller's time formatter.
export function unitTimeline(u: AssignedContact, fmt: (iso: string) => string): string {
    const parts: string[] = [];
    if (u.assigned_at) parts.push(`assigned ${fmt(u.assigned_at)}`);
    if (u.onscene_at)  parts.push(`on scene ${fmt(u.onscene_at)}`);
    if (u.cleared_at)  parts.push(`cleared ${fmt(u.cleared_at)}`);
    return parts.join(' · ');
}

// One unit for the report and CSV: "E12 (assigned 14:02 · on scene 14:09 · cleared 14:40)".
export function unitLine(u: AssignedContact, fmt: (iso: string) => string): string {
    const t = unitTimeline(u, fmt);
    return t ? `${u.callsign} (${t})` : u.callsign;
}
