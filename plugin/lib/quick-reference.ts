// The Dispatcher quick reference sheet: one page a desk can print on letter paper or save as a PDF, made
// from what is in use on this CloudTAK: the command list, the incident types with their codes (the
// agency's own, or the built-in ones), the dispositions, and a few worked examples. It is a
// self-contained HTML document, printed by the browser like the event report (lib/report.ts
// openPrintWindow); there is no PDF library, since plugin dependencies must exist inside CloudTAK.
// Pure: its only imports are pure files, so plugin/test/quick-reference.test.ts loads this as it ships.
import { COMMANDS } from './command-line.ts';
import { DISPOSITIONS, DISPOSITION_OTHER } from './dispositions.ts';
import { incidentTypeLabel } from './incident-types.ts';
import type { IncidentTypeOption } from './incident-types.ts';

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A few lines to copy from, in the order a call goes. Each one is a line that works as typed.
export const QUICK_REFERENCE_EXAMPLES: readonly { line: string; says: string }[] = [
    { line: 'N fire, 120 main',          says: 'Start a new incident: type Fire, address 120 Main.' },
    { line: 'A H35 E6',                  says: 'Assign units H35 and E6 to the incident you are working.' },
    { line: 'O H35',                     says: 'H35 is On Scene.' },
    { line: 'T 2 patients, one trapped', says: 'Add a note.' },
    { line: 'RN 26-00123',               says: 'Set the report number.' },
    { line: '14 T caller called back',   says: 'A number first sends a command to that incident (014).' },
    { line: '14 A H35 E6 ; O H35 ; T 2 trapped', says: 'Several commands in one go, all for incident 014.' },
    { line: 'A +E99',                    says: 'Put E99, a unit that is not on TAK, on the incident.' },
    { line: 'C H35',                     says: 'H35 is Clear.' },
    { line: 'X unf',                     says: 'Close the incident as Unfounded.' },
];

export const QUICK_REFERENCE_NAME = 'dispatcher-quick-reference.html';

export interface QuickReferenceInput {
    types:         readonly IncidentTypeOption[];   // incidentTypeOptions(settings): what New Incident offers
    agencyName?:   string;
    generatedAt:   Date;
    // Left out, the sheet has the commands this plugin ships.
    commands?:     readonly { example: string; does: string }[];
}

export function buildQuickReferenceHtml(input: QuickReferenceInput): string {
    const commands = input.commands ?? COMMANDS;
    const when = input.generatedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    // Two tables side by side, so the whole sheet fits one page.
    const rows = (list: readonly { example: string; does: string }[]) => list
        .map(c => `<tr><td class='code'>${esc(c.example)}</td><td>${esc(c.does)}</td></tr>`)
        .join('');
    const half = Math.ceil(commands.length / 2);
    const commandTables = `<div class='two'><table>${rows(commands.slice(0, half))}</table><table>${rows(commands.slice(half))}</table></div>`;
    const typeItems = input.types
        .map(t => `<li>${esc(incidentTypeLabel(t))}</li>`)
        .join('');
    const dispositions = [...DISPOSITIONS, `${DISPOSITION_OTHER} (add its words: X other lost contact)`]
        .map(d => `<li>${esc(d)}</li>`)
        .join('');
    const examples = QUICK_REFERENCE_EXAMPLES
        .map(e => `<tr><td class='code'>${esc(e.line)}</td><td>${esc(e.says)}</td></tr>`)
        .join('');

    return `<!doctype html>
<html>
<head>
<meta charset='utf-8'>
<title>Dispatcher quick reference</title>
<style>
    @page { size: letter; margin: 0.5in; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 1rem auto; max-width: 7.5in; padding: 0 .5rem; font-size: 9pt; line-height: 1.2; }
    h1 { font-size: 15pt; margin: 0 0 .1rem; }
    h2 { font-size: 10.5pt; margin: .55rem 0 .2rem; border-bottom: 1px solid #999; padding-bottom: .1rem; }
    .sub { color: #555; font-size: 8.5pt; margin-bottom: .4rem; }
    table { border-collapse: collapse; width: 100%; }
    td { padding: .06rem .4rem .06rem 0; vertical-align: top; border-bottom: 1px solid #e3e3e3; }
    td.code { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 600; white-space: nowrap; width: 2.5in; }
    .two { display: flex; gap: 1rem; align-items: flex-start; }
    .two table { flex: 1 1 0; }
    .two td.code { width: auto; }
    ul { margin: 0; padding-left: 1.1rem; }
    ul.cols { columns: 2; column-gap: 1rem; }
    li { padding: 0; break-inside: avoid; }
    .note { color: #444; font-size: 8.5pt; margin: .2rem 0; }
    section { break-inside: avoid; }
    .printbar { text-align: right; margin-bottom: .5rem; }
    @media print { .printbar { display: none; } body { margin: 0; max-width: none; } }
</style>
</head>
<body>
<div class='printbar'><button id='rpt-print' onclick='window.print()'>Print / Save as PDF</button></div>
<h1>${input.agencyName ? `${esc(input.agencyName)} — ` : ''}Dispatcher quick reference</h1>
<div class='sub'>Made ${esc(when)} from this CloudTAK. Press F2 for the command line. Type ? there for this list.</div>

<section>
<h2>Commands</h2>
<div class='note'>Put an incident number first to send a command to that incident (14 T text). Left out, it is the incident you are working. Capital or small letters both work. Put a semicolon between commands to run several in one go (A H35 ; O H35). Put a + before a unit that is not on TAK (A +E99).</div>
${commandTables}
</section>

<section>
<h2>Incident types and codes</h2>
<div class='note'>Type a code or the start of a name after N (N mva, N fire). Several fits give a numbered list.</div>
<ul class='cols'>${typeItems}</ul>
</section>

<section>
<h2>Dispositions (X)</h2>
<div class='note'>Type the start of a word: X unf.</div>
<ul class='cols'>${dispositions}</ul>
</section>

<section>
<h2>Examples</h2>
<table>${examples}</table>
</section>
</body>
</html>
`;
}
