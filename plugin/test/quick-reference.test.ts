// Proof tests for the quick reference sheet (ops 1068, item 3): what is on the one printable page, and that
// the command line's help offers it. Plain node: lib/quick-reference.ts is pure, so it runs as it ships.
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMANDS, parseLine } from '../lib/command-line.ts';
import { DISPOSITIONS } from '../lib/dispositions.ts';
import { incidentTypeOptions } from '../lib/incident-types.ts';
import { buildQuickReferenceHtml, QUICK_REFERENCE_EXAMPLES, QUICK_REFERENCE_NAME } from '../lib/quick-reference.ts';

const NOW = new Date(2026, 10, 22, 15, 30);
const own = [
    { code: 'MVA', name: 'Traffic Accident' },
    { code: 'STR', name: 'Structure Fire' }, { code: '', name: 'Welfare Check' },
];

test('the sheet lists every command, by the same example the command line list shows', () => {
    const html = buildQuickReferenceHtml({ types: incidentTypeOptions({}), generatedAt: NOW });
    for (const c of COMMANDS) {
        assert.ok(html.includes(`<td class='code'>${c.example}</td>`) || html.includes(`>${c.example.replace(/&/g, '&amp;')}</td>`), c.example);
        assert.ok(html.includes(c.does.replace(/&/g, '&amp;')), c.does);
    }
});

test('it shows this CloudTAK\'s incident types with their codes, and the dispositions', () => {
    const html = buildQuickReferenceHtml({
        types: incidentTypeOptions({ incident_types: own, incident_types_only: true }), generatedAt: NOW,
    });
    assert.ok(html.includes('<li>MVA - Traffic Accident</li>'));
    assert.ok(html.includes('<li>STR - Structure Fire</li>'));
    assert.ok(html.includes('<li>Welfare Check</li>'));
    assert.ok(!html.includes('Medical Emergency'), 'with the switch on the built-in types are not on the sheet');
    for (const d of DISPOSITIONS) assert.ok(html.includes(`<li>${d}</li>`), d);
    assert.ok(html.includes('<li>Other '));
    // switch off: the built-in types are there too
    const all = buildQuickReferenceHtml({ types: incidentTypeOptions({ incident_types: own }), generatedAt: NOW });
    assert.ok(all.includes('<li>Medical Emergency</li>') && all.includes('<li>MVA - Traffic Accident</li>'));
});

test('every example is a line the command line reads as a command', () => {
    assert.ok(QUICK_REFERENCE_EXAMPLES.length >= 5);
    for (const e of QUICK_REFERENCE_EXAMPLES) {
        const p = parseLine(e.line);
        assert.ok(p && !('error' in p), e.line);
    }
});

test('it is made to print on one letter page: letter size, a print button that is hidden on paper, no script', () => {
    const html = buildQuickReferenceHtml({ types: incidentTypeOptions({}), generatedAt: NOW, agencyName: 'Test <Fire> & Rescue' });
    assert.match(html, /@page \{ size: letter;/);
    assert.match(html, /@media print \{ \.printbar \{ display: none; \}/);
    assert.match(html, /id='rpt-print'/, 'openPrintWindow arms this button');
    assert.ok(!/<script/i.test(html), 'a blob page inherits the CSP: no inline script');
    assert.equal(QUICK_REFERENCE_NAME, 'dispatcher-quick-reference.html');
});

test('text from the agency is escaped, so a name or a type cannot put markup on the sheet', () => {
    const html = buildQuickReferenceHtml({
        types: [{ code: 'X', name: '<img src=x onerror=alert(1)>' }], generatedAt: NOW, agencyName: '</title><b>Bold</b>',
    });
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<b>Bold'));
    assert.ok(html.includes('&lt;img src=x'));
    assert.ok(html.includes('&lt;/title&gt;&lt;b&gt;Bold'));
});

test('wiring: the command line help has a print button and a save button, built from the settings now in use', () => {
    const src = readFileSync(new URL('../components/CommandLine.vue', import.meta.url), 'utf8');
    // every name the component uses is imported (a missing import is a build error only inside CloudTAK)
    assert.match(src, /import \{ buildQuickReferenceHtml, QUICK_REFERENCE_NAME \} from '\.\.\/lib\/quick-reference\.ts';/);
    assert.match(src, /import \{ downloadFile, openPrintWindow \} from '\.\.\/lib\/report\.ts';/);
    assert.match(src, /data-test='quick-reference-print'[\s\S]*?@click='printQuickReference'/);
    assert.match(src, /data-test='quick-reference-save'[\s\S]*?@click='saveQuickReference'/);
    assert.match(src, /buildQuickReferenceHtml\(\{ types: incidentTypeOptions\(settings\)/);
    assert.match(src, /openPrintWindow\(await quickReferenceHtml\(\)\)/);
    assert.match(src, /downloadFile\(QUICK_REFERENCE_NAME, 'text\/html'/);
    // the buttons sit inside the help panel
    const help = src.slice(src.indexOf("data-test='command-help'"), src.indexOf('</template>'));
    assert.ok(help.includes('quick-reference-print'));
});
