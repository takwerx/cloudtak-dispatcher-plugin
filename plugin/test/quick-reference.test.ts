// Proof tests for the Quick Reference sheet (User Guide → Quick Reference): it lists every command,
// this CloudTAK's incident types with all their codes and the dispositions, and its three examples
// are lines the command line really takes. Plain node, no CloudTAK and no browser:
//   node --test plugin/test/*.test.ts
// lib/quick-reference.ts is pure, so this runs the file as it ships. The last test reads the Events
// list's source to prove the button is wired to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuickReferenceHtml, quickReferenceExamples } from '../lib/quick-reference.ts';
import { COMMANDS, matchOptions, parseChain, readDisposition } from '../lib/command-line.ts';
import type { ChainPart } from '../lib/command-line.ts';
import { incidentTypeOptions } from '../lib/incident-types.ts';
import { DISPOSITIONS } from '../lib/dispositions.ts';

const OWN = [
    { code: 'MVA', name: 'Traffic Accident', aliases: ['WRECK', '1050'] },
    { code: 'FIRE', name: 'Structure Fire' },
    { code: '', name: 'Welfare Check' },
];
const page = (types = OWN, agency: { name: string; id: string; logo: string | null } | null = null) =>
    buildQuickReferenceHtml({ types, dispositions: DISPOSITIONS, generated: 'Nov 21, 2026, 10:00 AM', agency });

test('the sheet is for Letter paper and prints like the Event report', () => {
    const html = page();
    assert.match(html, /@page \{ size: letter; margin: 0\.5in; \}/);
    assert.match(html, /<button id='rpt-print'[^>]*>Print \/ Save as PDF<\/button>/);
    assert.match(html, /Made Nov 21, 2026, 10:00 AM/);
});

test('every command is on the sheet, with what it does and its example', () => {
    const html = page();
    for (const c of COMMANDS.filter(x => x.verb !== '?')) {
        assert.ok(html.includes(c.does.replace(/&/g, '&amp;')), c.does);
        assert.ok(html.includes(`<td class='ex'>${c.example}</td>`), c.example);
    }
});

test('the types are the ones offered, in their order, each with every code', () => {
    const html = page();
    assert.match(html, /Incident types \(3\)/);
    assert.ok(html.indexOf('Traffic Accident') < html.indexOf('Structure Fire'));
    assert.ok(html.includes("<span class='codes'>MVA / WRECK / 1050</span> Traffic Accident"));
    assert.ok(html.includes("<div class='type'>Welfare Check</div>"));
    // a type named by its code shows the code once
    assert.ok(page([{ code: 'SMOKE', name: 'SMOKE' }]).includes("<div class='type'><span class='codes'>SMOKE</span> </div>"));
    // the built-in list when the agency has none
    const builtIn = page(incidentTypeOptions({}));
    assert.match(builtIn, /Incident types \(17\)/);
    for (const d of DISPOSITIONS) assert.ok(builtIn.includes(`<span class='reason'>${d}</span>`), d);
});

test('names and the agency header are escaped, and only a picture is taken as the logo', () => {
    const html = page([{ code: 'X', name: '<script>alert(1)</script> & Co' }], { name: 'Agency <b>', id: '', logo: 'javascript:alert(1)' });
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co'));
    assert.ok(html.includes('Agency &lt;b&gt;'));
    assert.ok(!html.includes('javascript:'));
    assert.match(page(OWN, { name: 'A', id: '', logo: 'data:image/png;base64,AAAA' }), /<img class='logo' src='data:image\/png;base64,AAAA'/);
});

test('three examples, simple to complex, and each is a line the command line takes', () => {
    const ex = quickReferenceExamples(OWN);
    assert.deepEqual(ex.map(e => e.level), ['Simple', 'Medium', 'Complex']);
    for (const e of ex) {
        const p = parseChain(e.line, null);
        assert.ok(p && !('error' in p), e.line);
    }
    // the new-incident example uses this list's own type, by one of its extra codes, and names the others
    assert.equal(ex[1].line, 'N 1050, 120 Main St');
    assert.deepEqual(matchOptions('1050', OWN).map(t => t.name), ['Traffic Accident']);
    assert.match(ex[1].says, /<b>MVA<\/b> or <b>WRECK<\/b> works the same/);
    // complex: one line that assigns, puts on scene, sets the report numbers, adds a note and closes as Report
    const parts = parseChain(ex[2].line, null) as ChainPart[];
    assert.deepEqual(parts.map(x => [x.parsed.incident, x.parsed.verb, x.parsed.rest]), [
        ['14', 'A', 'H35 E6'], ['14', 'O', 'H35 E6'], ['14', 'RN', '26-00123, 26-00124'],
        ['14', 'T', 'both drivers cited'], ['14', 'X', 'report'],
    ]);
    assert.deepEqual(readDisposition('report', DISPOSITIONS, 'Other'), { disposition: 'Report', note: '' });
});

test('examples with no codes at all use the start of a type name, and still match', () => {
    const builtIn = incidentTypeOptions({});
    const ex = quickReferenceExamples(builtIn);
    assert.equal(ex[1].line, 'N medical, 120 Main St');
    assert.ok(matchOptions('medical', builtIn).some(t => t.name === 'Medical Emergency'));
    assert.equal(quickReferenceExamples([])[1].line, 'N fire, 120 Main St');
});

test('wiring: the Events list has one Quick Reference button, built from the settings as they are now', () => {
    const view = readFileSync(new URL('../components/EventsView.vue', import.meta.url), 'utf8');
    assert.equal(view.split("@click='printQuickReference'").length - 1, 1);
    assert.match(view, /const s = await getDispatcherSettings\(\)/);
    assert.match(view, /types: {8}incidentTypeOptions\(s\),/);
    assert.match(view, /if \(!openPrintWindow\(html\)\) quickRefError\.value = /);
    // right under the User Guide button
    assert.ok(view.indexOf("@click='openGuide()'") < view.indexOf("@click='printQuickReference'"));
});
