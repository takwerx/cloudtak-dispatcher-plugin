// The Quick Reference: a one- or two-page sheet for the desk, printed on Letter paper (8.5 x 11 in) or
// saved as a PDF from the browser's print window. It lists the command line's commands, the incident
// types this CloudTAK offers right now (built-in or the agency's own, with every code), the
// dispositions, and three worked examples. It is built from the same lists the plugin runs on (COMMANDS,
// incidentTypeOptions, DISPOSITIONS), so it never says something the command line does not do.
// Printed the same way as the Event report (report.ts openPrintWindow): no PDF library.
// Pure: no CloudTAK imports, so plugin/test/quick-reference.test.ts runs this file as it ships.
import { COMMANDS } from './command-line.ts';
import { incidentTypeCodes } from './incident-types.ts';
import type { IncidentTypeOption } from './incident-types.ts';
import type { AgencySettings } from './events-client.ts';

export interface QuickReferenceInput {
    types:        IncidentTypeOption[];   // what the New Incident form offers, in its order
    dispositions: readonly string[];      // the presets for Close Incident, without Other
    generated:    string;                 // when it was made, already formatted
    agency?:      AgencySettings | null;  // the report header from Dispatcher Settings, if set
}

export interface QuickReferenceExample { level: string; line: string; says: string }

// More types than this do not fit under the commands on one sheet: the types then get a page of their
// own (the back of the sheet), so the examples stay at the bottom of the front.
export const QUICK_REFERENCE_TYPES_ON_FRONT = 30;

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The first word of a name, as a dispatcher would type it: "Traffic Stop" → "traffic".
function firstWord(name: string): string {
    return (name.split(/[^A-Za-z0-9]+/).find(Boolean) ?? name).toLowerCase();
}

// Three examples, simple to complex. The new-incident one uses a type from this CloudTAK's own list:
// one with several codes when there is one, so the sheet shows that any of them works.
export function quickReferenceExamples(types: IncidentTypeOption[]): QuickReferenceExample[] {
    const type = types.find(t => incidentTypeCodes(t).length > 1) ?? types.find(t => t.code) ?? types[0];
    const codes = type ? incidentTypeCodes(type) : [];
    const typed = codes.length ? codes[codes.length - 1] : type ? firstWord(type.name) : 'fire';
    const name = type?.name ?? 'Fire';
    const also = codes.length > 1
        ? ` ${codes.slice(0, -1).map(c => `<b>${esc(c)}</b>`).join(' or ')} works the same.`
        : '';
    return [
        {
            level: 'Simple',
            line:  'O H35',
            says:  'Unit H35 is On Scene. No incident number is needed: a unit is on one call at a time.',
        },
        {
            level: 'Medium',
            line:  `N ${typed}, 120 Main St`,
            says:  `Opens a new ${esc(name)} incident with the address searched.${also} Enter takes the marked address; Enter again creates the incident.`,
        },
        {
            level: 'Complex',
            line:  '14 A H35 E6',
            says:  'Assigns units H35 and E6 to incident 014: the incident number first, then the command, then the units.',
        },
    ];
}

// What to type for one command: "N type, address", or "14" for the number alone.
function commandText(verb: string, args: string): string {
    if (!verb) return 'number';
    return args ? `${verb} <i>${esc(args)}</i>` : verb;
}

// The printable page. Letter paper, half-inch margins, small type. The front has the commands, how a
// line is read, the dispositions and the examples at the bottom; the incident types go above the
// dispositions when they fit, or on the back when the list is long.
export function buildQuickReferenceHtml(input: QuickReferenceInput): string {
    const agency = input.agency;
    const logo = agency?.logo && agency.logo.startsWith('data:image/') ? agency.logo : '';
    // The commands in two tables side by side, so they take half the height.
    const list = COMMANDS.filter(c => c.verb !== '?');
    const half = Math.ceil(list.length / 2);
    const table = (rows: typeof list) => `<table>
<tr><th>Type</th><th>Does</th><th>Example</th></tr>${rows.map(c => `
<tr><td class='cmd'>${commandText(c.verb, c.args)}</td><td>${esc(c.does)}</td><td class='ex'>${esc(c.example)}</td></tr>`).join('')}
</table>`;
    const commands = `<div class='two'>${table(list.slice(0, half))}${table(list.slice(half))}</div>`;
    const typeRows = input.types.map((t) => {
        const codes = incidentTypeCodes(t);
        // A type named by its code shows the code once.
        const name = t.name === t.code ? '' : esc(t.name);
        return `<div class='type'>${codes.length ? `<span class='codes'>${codes.map(esc).join(' / ')}</span> ` : ''}${name}</div>`;
    }).join('');
    const back = input.types.length > QUICK_REFERENCE_TYPES_ON_FRONT;
    const types = `<div class='section${back ? ' back' : ''}'>
<h2>Incident types (${input.types.length})</h2>
<div class='types'>${typeRows}</div>
</div>`;
    const reasons = input.dispositions.map(d => `<span class='reason'>${esc(d)}</span>`).join('');
    const examples = quickReferenceExamples(input.types).map(e => `
        <div class='example'><div class='level'>${e.level}</div><div class='line'>${esc(e.line)}</div><div>${e.says}</div></div>`).join('');

    return `<!doctype html>
<html>
<head>
<meta charset='utf-8'>
<title>Dispatcher Quick Reference</title>
<style>
    @page { size: letter; margin: 0.5in; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111; font-size: 8.5pt; line-height: 1.25; margin: 1rem auto; max-width: 7.5in; padding: 0 .5rem; }
    h1 { font-size: 15pt; margin: 0; }
    h2 { font-size: 10pt; margin: 9pt 0 4pt; border-bottom: 1px solid #999; padding-bottom: 1pt; }
    .head { display: flex; align-items: center; gap: 10pt; }
    .logo { max-height: 40pt; max-width: 120pt; }
    .agency { font-weight: 600; font-size: 10pt; }
    .sub { color: #444; margin-top: 2pt; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border-bottom: 1px solid #ddd; padding: 1.5pt 4pt; text-align: left; vertical-align: top; }
    th { font-size: 7.5pt; color: #555; text-transform: uppercase; }
    td.cmd { font-family: Consolas, 'DejaVu Sans Mono', monospace; font-weight: 700; white-space: nowrap; }
    td.ex { font-family: Consolas, 'DejaVu Sans Mono', monospace; color: #333; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; align-items: start; }
    .two table { font-size: 7.5pt; }
    .two td { padding: 1pt 3pt; }
    .two td.cmd { width: 34%; }
    .two td.ex { width: 33%; }
    .back { break-before: page; }
    ul { margin: 2pt 0; padding-left: 14pt; }
    .types { columns: 3; column-gap: 12pt; }
    .type { break-inside: avoid; padding: .5pt 0; }
    .codes { font-family: Consolas, 'DejaVu Sans Mono', monospace; font-weight: 700; }
    .reason { display: inline-block; border: 1px solid #bbb; border-radius: 3pt; padding: 0 4pt; margin: 0 3pt 3pt 0; }
    .examples { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6pt; break-inside: avoid; }
    .example { border: 1px solid #999; border-radius: 4pt; padding: 4pt 6pt; }
    .level { font-size: 7.5pt; color: #555; text-transform: uppercase; font-weight: 600; }
    .line { font-family: Consolas, 'DejaVu Sans Mono', monospace; font-weight: 700; font-size: 11pt; margin: 2pt 0; }
    .section { break-inside: avoid; }
    .foot { color: #555; font-size: 7.5pt; margin-top: 8pt; }
    .printbar { text-align: right; margin-bottom: .5rem; }
    @media print { .printbar { display: none; } body { margin: 0; max-width: none; padding: 0; } }
</style>
</head>
<body>
<div class='printbar'><button id='rpt-print' onclick='window.print()'>Print / Save as PDF</button></div>
<div class='head'>
${logo ? `<img class='logo' src='${esc(logo)}' alt=''>` : ''}
<div>
${agency?.name ? `<div class='agency'>${esc(agency.name)}</div>` : ''}
<h1>Dispatcher Quick Reference</h1>
<div class='sub'>Press <b>F2</b> or <b>Commands</b> to open the command line. Type a line, read the line under the box, then press <b>Enter</b>.</div>
</div>
</div>

<div class='section'>
<h2>Commands</h2>
${commands}
</div>

<div class='section'>
<h2>How a line is read</h2>
<ul>
<li><b>Incident number first, or none.</b> <code>14 T caller called back</code> is for incident 014. With no number, the command is for the incident shown at the left of the box.</li>
<li><b>Units the way they are said on the radio.</b> One part of a callsign is enough: <code>E12</code> for FIRE-ENGINE-E12.</li>
<li><b>Types by any of their codes, or the start of a word in the name.</b> A code must be typed whole.</li>
<li><b>More than one fit?</b> A numbered list shows: type the number, then Enter. <b>Up arrow</b> brings back earlier lines. <b>?</b> lists every command.</li>
</ul>
</div>

${back ? '' : types}

<div class='section'>
<h2>Dispositions (X)</h2>
<div>${reasons}<span class='reason'>Other: X other <i>your words</i></span></div>
<div class='sub'>Type the start of a word: <code>X unf</code>. <code>X</code> alone lists them all.</div>
</div>

<div class='section'>
<h2>Examples</h2>
<div class='examples'>${examples}</div>
</div>

<div class='foot'>Made ${esc(input.generated)} from this CloudTAK's incident types.${back ? ' Incident types are on the back.' : ''} Print it again after the types change in Dispatcher Settings.</div>
${back ? types : ''}
</body>
</html>`;
}
