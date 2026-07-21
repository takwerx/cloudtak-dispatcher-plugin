import type { DispatcherEvent, DispatcherIncident, AgencySettings } from './events-client.ts';

// After-action report for a standalone Event: stats + generated narrative + exports.
// Everything is computed client-side from the incident list the server already returns
// (closed incidents persist until the Event is nuked, so the full history is available).
// The printable copy is a self-contained HTML doc the browser prints to PDF — no PDF
// library, since plugin deps must exist inside CloudTAK's own node_modules.

export interface ReportRange {
    start: Date;
    end: Date;
}

export interface TypeCount {
    type: string;
    count: number;
    pct: number;
}

export interface HourBucket {
    label: string;
    count: number;
}

export interface UnitCount {
    callsign: string;
    count: number;
}

export interface ReportStats {
    total: number;
    active: number;
    closed: number;
    byType: TypeCount[];
    byHour: HourBucket[];
    peak: HourBucket | null;
    topUnits: UnitCount[];
    notesTotal: number;
    perHourAvg: number;
}

export function filterByRange(incidents: DispatcherIncident[], range: ReportRange): DispatcherIncident[] {
    return incidents.filter((i) => {
        const t = new Date(i.created_at).getTime();
        return t >= range.start.getTime() && t <= range.end.getTime();
    });
}

function hourLabel(d: Date): string {
    const h = String(d.getHours()).padStart(2, '0');
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${h}:00–${h}:59`;
}

export function buildStats(incidents: DispatcherIncident[], range: ReportRange): ReportStats {
    const total = incidents.length;

    const typeMap = new Map<string, number>();
    for (const i of incidents) {
        const t = i.type || 'Unspecified';
        typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
    }
    const byType: TypeCount[] = [...typeMap.entries()]
        .map(([type, count]) => ({ type, count, pct: total ? Math.round((count / total) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);

    const hourMap = new Map<string, number>();
    for (const i of incidents) {
        const d = new Date(i.created_at);
        d.setMinutes(0, 0, 0);
        const label = hourLabel(d);
        hourMap.set(label, (hourMap.get(label) ?? 0) + 1);
    }
    const byHour: HourBucket[] = [...hourMap.entries()].map(([label, count]) => ({ label, count }));
    const peak = byHour.reduce<HourBucket | null>((best, b) => (!best || b.count > best.count ? b : best), null);

    const unitMap = new Map<string, number>();
    for (const i of incidents) {
        for (const c of i.assigned ?? []) {
            unitMap.set(c.callsign, (unitMap.get(c.callsign) ?? 0) + 1);
        }
    }
    const topUnits: UnitCount[] = [...unitMap.entries()]
        .map(([callsign, count]) => ({ callsign, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const hours = Math.max(1, (range.end.getTime() - range.start.getTime()) / 3600000);

    return {
        total,
        active: incidents.filter(i => i.status === 'active').length,
        closed: incidents.filter(i => i.status === 'closed').length,
        byType,
        byHour,
        peak,
        topUnits,
        notesTotal: incidents.reduce((n, i) => n + (i.notes?.length ?? 0), 0),
        perHourAvg: Math.round((total / hours) * 10) / 10,
    };
}

const fmt = (d: Date) => d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// Template-generated narrative — numbers plus something readable to hand off.
export function buildNarrative(event: DispatcherEvent, stats: ReportStats, range: ReportRange): string[] {
    const paras: string[] = [];

    if (!stats.total) {
        paras.push(`No incidents were logged for event "${event.name}" between ${fmt(range.start)} and ${fmt(range.end)}.`);
        return paras;
    }

    const statusBit = stats.active
        ? `${stats.closed} had been closed by the time of this report and ${stats.active} remained active`
        : 'all had been closed by the time of this report';
    paras.push(
        `During the reporting period (${fmt(range.start)} to ${fmt(range.end)}), dispatchers logged `
        + `${stats.total} incident${stats.total === 1 ? '' : 's'} for event "${event.name}" `
        + `(numbered ${event.prefix}-NNN); ${statusBit}.`
    );

    const [first, second, third] = stats.byType;
    let typeSentence = `${first.type} was the most common call type with ${first.count} `
        + `call${first.count === 1 ? '' : 's'} (${first.pct}% of traffic)`;
    if (second) typeSentence += `, followed by ${second.type} (${second.count})`;
    if (third) typeSentence += ` and ${third.type} (${third.count})`;
    paras.push(typeSentence + '.');

    if (stats.peak && stats.total > 1) {
        const peakPct = Math.round((stats.peak.count / stats.total) * 100);
        paras.push(
            `Call volume peaked during ${stats.peak.label} with ${stats.peak.count} `
            + `call${stats.peak.count === 1 ? '' : 's'} (${peakPct}% of the period's traffic); `
            + `the period averaged ${stats.perHourAvg} call${stats.perHourAvg === 1 ? '' : 's'} per hour.`
        );
    }

    if (stats.topUnits.length) {
        const units = stats.topUnits.map(u => `${u.callsign} (${u.count})`).join(', ');
        paras.push(`Most-assigned units by incident count: ${units}.`);
    }

    return paras;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Self-contained printable document (browser print → PDF is the handoff copy).
export function buildReportHtml(
    event: DispatcherEvent,
    incidents: DispatcherIncident[],
    stats: ReportStats,
    narrative: string[],
    range: ReportRange,
    generatedBy: string,
    agency?: AgencySettings | null,
): string {
    // Only render a logo we produced ourselves (canvas-downscaled data URI).
    const logo = agency?.logo && agency.logo.startsWith('data:image/') ? agency.logo : null;
    const typeRows = stats.byType
        .map(t => `<tr><td>${esc(t.type)}</td><td class='num'>${t.count}</td><td class='num'>${t.pct}%</td></tr>`)
        .join('');

    const hourRows = stats.byHour
        .map(h => `<tr><td>${esc(h.label)}</td><td class='num'>${h.count}</td></tr>`)
        .join('');

    const log = incidents.map((i) => {
        const assigned = (i.assigned ?? []).map(c => esc(c.callsign)).join(', ') || '—';
        const notes = (i.notes ?? [])
            .map(n => `<div class='note'><span class='when'>${esc(fmt(new Date(n.time)))}</span> ${esc(n.text)}</div>`)
            .join('') || `<div class='note muted'>No notes</div>`;
        return `
        <div class='incident'>
            <div class='inc-head'>
                <strong>${esc(i.number)}</strong> ${esc(i.type ?? 'Unspecified')}
                <span class='status ${i.status}'>${i.status.toUpperCase()}</span>
            </div>
            <table class='meta'>
                <tr><td>Opened</td><td>${esc(fmt(new Date(i.created_at)))}</td></tr>
                ${i.closed_at ? `<tr><td>Closed</td><td>${esc(fmt(new Date(i.closed_at)))}</td></tr>` : ''}
                <tr><td>Location</td><td>${esc(i.address || `${(i.lat ?? 0).toFixed(5)}, ${(i.lon ?? 0).toFixed(5)}`)}</td></tr>
                <tr><td>Dispatcher</td><td>${esc(i.dispatcher || '—')}</td></tr>
                <tr><td>Units</td><td>${assigned}</td></tr>
            </table>
            <div class='notes'>${notes}</div>
        </div>`;
    }).join('');

    return `<!doctype html>
<html>
<head>
<meta charset='utf-8'>
<title>${esc(event.name)} — Dispatch Report</title>
<style>
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 2rem auto; max-width: 800px; padding: 0 1rem; }
    h1 { font-size: 1.4rem; margin-bottom: .25rem; }
    h2 { font-size: 1.05rem; margin: 1.5rem 0 .5rem; border-bottom: 1px solid #ccc; padding-bottom: .2rem; }
    .sub { color: #555; font-size: .85rem; margin-bottom: 1rem; }
    table { border-collapse: collapse; font-size: .85rem; }
    table.summary td, table.summary th { border: 1px solid #ccc; padding: .3rem .6rem; text-align: left; }
    td.num { text-align: right; }
    p.narrative { font-size: .9rem; line-height: 1.5; }
    .incident { border: 1px solid #ccc; border-radius: 4px; padding: .6rem .8rem; margin-bottom: .8rem; page-break-inside: avoid; }
    .inc-head { font-size: .95rem; margin-bottom: .4rem; }
    .status { font-size: .7rem; padding: .1rem .4rem; border-radius: 3px; margin-left: .4rem; }
    .status.active { background: #d1e7dd; }
    .status.closed { background: #e2e3e5; }
    table.meta td { padding: .1rem .5rem .1rem 0; font-size: .8rem; vertical-align: top; }
    table.meta td:first-child { color: #666; width: 6.5rem; }
    .notes { margin-top: .4rem; border-top: 1px dashed #ddd; padding-top: .3rem; }
    .note { font-size: .8rem; padding: .1rem 0; }
    .note .when { color: #666; font-size: .75rem; margin-right: .3rem; }
    .muted { color: #888; }
    .printbar { text-align: right; margin-bottom: 1rem; }
    .rpt-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    .agency { font-size: 1.05rem; font-weight: 600; margin-bottom: .15rem; }
    .logo { max-height: 80px; max-width: 180px; }
    @media print { .printbar { display: none; } body { margin: 0; } }
</style>
</head>
<body>
<div class='printbar'><button onclick='window.print()'>Print / Save as PDF</button></div>
<div class='rpt-head'>
<div>
${agency?.name ? `<div class='agency'>${esc(agency.name)}</div>` : ''}
<h1>${esc(event.name)} — Dispatch Report</h1>
<div class='sub'>
    ${agency?.id ? `Agency ID: ${esc(agency.id)}<br>` : ''}
    Period: ${esc(fmt(range.start))} to ${esc(fmt(range.end))}<br>
    DataSync feed: ${esc(event.feed_name)} · Incident series: ${esc(event.prefix)}-NNN<br>
    Generated ${esc(fmt(new Date()))} by ${esc(generatedBy || 'Dispatcher')}
</div>
</div>
${logo ? `<img class='logo' src='${logo}' alt='Agency logo'>` : ''}
</div>

<h2>Summary</h2>
<table class='summary'>
    <tr><th>Total calls</th><td class='num'>${stats.total}</td></tr>
    <tr><th>Active at report time</th><td class='num'>${stats.active}</td></tr>
    <tr><th>Closed</th><td class='num'>${stats.closed}</td></tr>
    <tr><th>Notes logged</th><td class='num'>${stats.notesTotal}</td></tr>
    <tr><th>Average calls/hour</th><td class='num'>${stats.perHourAvg}</td></tr>
</table>

<h2>Calls by type</h2>
<table class='summary'>
    <tr><th>Type</th><th>Calls</th><th>Share</th></tr>
    ${typeRows || `<tr><td colspan='3' class='muted'>None</td></tr>`}
</table>

<h2>Calls by hour</h2>
<table class='summary'>
    <tr><th>Hour</th><th>Calls</th></tr>
    ${hourRows || `<tr><td colspan='2' class='muted'>None</td></tr>`}
</table>

<h2>Narrative</h2>
${narrative.map(p => `<p class='narrative'>${esc(p)}</p>`).join('')}

<h2>Incident log (${incidents.length})</h2>
${log || `<p class='muted'>No incidents in the selected period.</p>`}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });</script>
</body>
</html>`;
}

function csvCell(v: string | number | null | undefined): string {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
}

export function buildCsv(incidents: DispatcherIncident[]): string {
    const header = [
        'number', 'type', 'status', 'created_at', 'closed_at', 'address',
        'lat', 'lon', 'dispatcher', 'assigned_units', 'details', 'notes',
    ].join(',');
    const rows = incidents.map(i => [
        csvCell(i.number),
        csvCell(i.type),
        csvCell(i.status),
        csvCell(i.created_at),
        csvCell(i.closed_at),
        csvCell(i.address),
        csvCell(i.lat),
        csvCell(i.lon),
        csvCell(i.dispatcher),
        csvCell((i.assigned ?? []).map(c => c.callsign).join('; ')),
        csvCell(i.details),
        csvCell((i.notes ?? []).map(n => `[${n.time}] ${n.text}`).join(' | ')),
    ].join(','));
    return [header, ...rows].join('\r\n');
}

export function buildJsonArchive(
    event: DispatcherEvent,
    incidents: DispatcherIncident[],
    stats: ReportStats,
    narrative: string[],
    range: ReportRange,
    generatedBy: string,
    agency?: AgencySettings | null,
): string {
    return JSON.stringify({
        format: 'tak-dispatcher-report',
        version: 1,
        generated_at: new Date().toISOString(),
        generated_by: generatedBy,
        agency: agency ? { name: agency.name, id: agency.id } : null,
        event,
        period: { start: range.start.toISOString(), end: range.end.toISOString() },
        stats,
        narrative,
        incidents,
    }, null, 2);
}

export function downloadFile(filename: string, mime: string, content: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function openPrintWindow(html: string): boolean {
    // Blob URL, not document.write into about:blank: a blob document carries no inherited
    // CSP from the app's response headers, so the report's inline styles and its
    // window.print() button work regardless of how the deployment is fronted.
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (!w) {
        URL.revokeObjectURL(url);
        return false;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
}

export function reportFilename(event: DispatcherEvent, ext: string): string {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    return `${event.prefix || 'EVENT'}-report-${stamp}.${ext}`;
}
