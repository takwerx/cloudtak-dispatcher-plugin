// The User Guide (plugin/guide/*.md) and the small Markdown reader that shows it in its pane.
//   node --test plugin/test/*.test.ts
// The second half reads the real guide files, so a new section with a broken link or a repeated
// heading fails here instead of in front of a dispatcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { Block, Inline } from '../lib/guide.ts';
import {
    buildGuide, CONTENTS_ANCHOR, parseBlocks, parseInline, parseSection, resolveLink, sectionParts, slug,
} from '../lib/guide.ts';
import { DISPOSITIONS } from '../lib/dispositions.ts';

const blocks = (text: string) => parseBlocks(text.split('\n'));

test('bold, typed text and links; anything unmatched stays as text', () => {
    assert.deepEqual(parseInline('Press **Save**.'), [
        { t: 'text', v: 'Press ' }, { t: 'strong', c: [{ t: 'text', v: 'Save' }] }, { t: 'text', v: '.' },
    ]);
    assert.deepEqual(parseInline('type `2026-FAIR`'), [{ t: 'text', v: 'type ' }, { t: 'code', v: '2026-FAIR' }]);
    assert.deepEqual(parseInline('see [Close an event](70-events.md#close-an-event)'), [
        { t: 'text', v: 'see ' },
        { t: 'link', href: '70-events.md#close-an-event', c: [{ t: 'text', v: 'Close an event' }] },
    ]);
    assert.deepEqual(parseInline('**a [b](#c)**'), [
        { t: 'strong', c: [{ t: 'text', v: 'a ' }, { t: 'link', href: '#c', c: [{ t: 'text', v: 'b' }] }] },
    ]);
    assert.deepEqual(parseInline('2 ** 3 and [x] and `'), [{ t: 'text', v: '2 ** 3 and [x] and `' }]);
    assert.deepEqual(parseInline('\\*\\*not bold\\*\\* a \\| b'), [{ t: 'text', v: '**not bold** a | b' }]);
});

test('headings get the same anchors GitHub gives them', () => {
    assert.equal(slug('Set the location'), 'set-the-location');
    assert.equal(slug('C. Search finds nothing: type the address yourself'), 'c-search-finds-nothing-type-the-address-yourself');
    assert.equal(slug('You can’t change this'), 'you-cant-change-this');
    assert.equal(slug('Close ✕ and Report #'), 'close--and-report-');
    const [h3, h4] = blocks('### Set **the** location\n#### A. Search');
    assert.deepEqual(h3, { t: 'h', level: 3, id: 'set-the-location', c: parseInline('Set **the** location') });
    assert.equal(h4.t === 'h' && h4.level, 4);
});

test('paragraphs join their lines and end at a blank line or the next block', () => {
    assert.deepEqual(blocks('One line\nand the next.\n\nSecond.\n### Heading'), [
        { t: 'p', c: [{ t: 'text', v: 'One line and the next.' }] },
        { t: 'p', c: [{ t: 'text', v: 'Second.' }] },
        { t: 'h', level: 3, id: 'heading', c: [{ t: 'text', v: 'Heading' }] },
    ]);
});

test('numbered steps and bullets, with text that runs on to the next line', () => {
    assert.deepEqual(blocks('1. Press **+ New**.\n2. Pick the\n   type.\n\n- one\n- two'), [
        { t: 'ol', items: [parseInline('Press **+ New**.'), parseInline('Pick the type.')] },
        { t: 'ul', items: [parseInline('one'), parseInline('two')] },
    ]);
    // Steps straight after bullets start a new list, as on GitHub.
    const [ul, ol] = blocks('- a\n1. b');
    assert.equal(ul.t, 'ul');
    assert.equal(ol.t, 'ol');
});

test('tip, note and warning boxes use GitHub\'s names and can hold a list', () => {
    const [tip, caution, plain] = blocks('> [!TIP]\n> **Event missing?** Press refresh.\n> - a\n> - b\n\n> [!CAUTION]\n> Not Nuke.\n\n> Just a quote.');
    assert.deepEqual(tip, {
        t:      'callout',
        kind:   'tip',
        blocks: [
            { t: 'p', c: parseInline('**Event missing?** Press refresh.') },
            { t: 'ul', items: [parseInline('a'), parseInline('b')] },
        ],
    });
    assert.equal(caution.t === 'callout' && caution.kind, 'caution');
    assert.equal(plain.t === 'callout' && plain.kind, 'note');
});

test('tables need the --- line under the header; editor notes are not shown', () => {
    assert.deepEqual(blocks('| Button | What |\n|---|:--:|\n| **CSV** | A \\| B |'), [{
        t:    'table',
        head: [parseInline('Button'), parseInline('What')],
        rows: [[parseInline('**CSV**'), parseInline('A | B')]],
    }]);
    assert.equal(blocks('| not | a table |')[0].t, 'p');
    assert.deepEqual(blocks('<!-- one\nnote -->\nShown.\n<!-- two -->'), [{ t: 'p', c: parseInline('Shown.') }]);
});

test('links go to a heading, a section, or an https page; anything else is plain text', () => {
    assert.deepEqual(resolveLink('#set-the-location'), { kind: 'internal', anchor: 'set-the-location' });
    assert.deepEqual(resolveLink('70-events.md'), { kind: 'internal', anchor: 'events' });
    assert.deepEqual(resolveLink('70-events.md#close-an-event'), { kind: 'internal', anchor: 'close-an-event' });
    assert.deepEqual(resolveLink('https://example.com/x'), { kind: 'external', href: 'https://example.com/x' });
    for (const bad of ['javascript:alert(1)', 'http://example.com', 'README.md', '../index.ts', '#', '']) {
        assert.deepEqual(resolveLink(bad), { kind: 'none' }, bad);
    }
});

test('sections come from numbered files only, in number order, titled by their ## heading', () => {
    const guide = buildGuide({
        '../guide/README.md':     '# Not a section',
        '../guide/20-b.md':       '## Second\nText.',
        '../guide/5-a.md':        '<!-- note -->\n## First',
        '../guide/notes.md':      '## Not a section either',
    });
    assert.deepEqual(guide.map(s => [s.id, s.order, s.title]), [['a', 5, 'First'], ['b', 20, 'Second']]);
    assert.deepEqual(guide[1].blocks, [{ t: 'p', c: parseInline('Text.') }]);
    assert.equal(parseSection('README.md', '## x'), null);
});

test('the contents list shows each section\'s ### parts, not the smaller headings or boxes', () => {
    const [s] = buildGuide({ '10-a.md': '## A\n### Close an incident\n#### Way B\n> ### In a box\n### Export the data' });
    assert.deepEqual(sectionParts(s), [
        { id: 'close-an-incident', title: 'Close an incident' },
        { id: 'export-the-data', title: 'Export the data' },
    ]);
});

// ── The real guide ──────────────────────────────────────────────────────────────────────────────

const DIR = new URL('../guide/', import.meta.url);
const files = Object.fromEntries(readdirSync(DIR).filter(f => f.endsWith('.md'))
    .map(f => [f, readFileSync(new URL(f, DIR), 'utf8')]));
const guide = buildGuide(files);

function headings(list: Block[]): { id: string; level: number }[] {
    return list.flatMap(b => b.t === 'h' ? [{ id: b.id, level: b.level }] : b.t === 'callout' ? headings(b.blocks) : []);
}

function linksIn(nodes: Inline[]): string[] {
    return nodes.flatMap(n => n.t === 'link' ? [n.href, ...linksIn(n.c)] : n.t === 'strong' ? linksIn(n.c) : []);
}

function links(list: Block[]): string[] {
    return list.flatMap((b) => {
        if (b.t === 'h' || b.t === 'p') return linksIn(b.c);
        if (b.t === 'ol' || b.t === 'ul') return b.items.flatMap(linksIn);
        if (b.t === 'table') return [...b.head, ...b.rows.flat()].flatMap(linksIn);
        if (b.t === 'callout') return links(b.blocks);
        return [];
    });
}

test('every guide file is a section with a ## title and nothing above it', () => {
    assert.ok(guide.length >= 6);
    for (const f of Object.keys(files).filter(f => f !== 'README.md')) {
        const s = guide.find(g => g.file === f);
        assert.ok(s, `${f} is not named NN-short-name.md`);
        const first = parseBlocks(files[f].split('\n'))[0];
        assert.ok(first?.t === 'h' && first.level === 2, `${f} must start with "## Title"`);
        assert.ok(!headings(s.blocks).some(h => h.level === 2), `${f} has a second "## " heading; use ###`);
    }
});

test('section names and headings are unique across the guide, so every link has one target', () => {
    const seen = new Map<string, string>([[CONTENTS_ANCHOR, 'the contents list']]);
    for (const s of guide) {
        for (const id of [s.id, ...headings(s.blocks).map(h => h.id)]) {
            assert.ok(id, `${s.file} has an empty heading`);
            assert.ok(!seen.has(id), `"${id}" in ${s.file} is also used by ${seen.get(id)}`);
            seen.set(id, s.file);
        }
    }
});

test('every link in the guide goes somewhere, and works the same on GitHub', () => {
    const inFile = new Map(guide.map(s => [s.file, new Set(headings(s.blocks).map(h => h.id))]));
    for (const s of guide) {
        for (const href of links(s.blocks)) {
            const to = resolveLink(href);
            assert.notEqual(to.kind, 'none', `${s.file}: link "${href}" goes nowhere`);
            if (to.kind !== 'internal') continue;
            const [file, anchor] = href.split('#');
            const target = file || s.file;
            assert.ok(inFile.has(target), `${s.file}: "${href}" names a file that is not a section`);
            if (anchor) assert.ok(inFile.get(target)?.has(anchor), `${s.file}: "${href}" has no heading "${anchor}" in ${target}`);
        }
    }
});

test('the guide is text only: no pictures and no HTML (editor notes in <!-- --> are fine)', () => {
    for (const [f, text] of Object.entries(files)) {
        if (f === 'README.md') continue;
        const shown = text.replace(/<!--[\s\S]*?-->/g, '').replace(/`[^`\n]*`/g, '');
        assert.doesNotMatch(shown, /!\[[^\]]*\]\(/, `${f} has a picture; say in words where things are instead`);
        assert.doesNotMatch(shown, /<\/?[a-z][^>]*>/i, `${f} contains HTML`);
    }
});

test('the README lists every section, in order', () => {
    const contents = files['README.md'].split('## Contents')[1]?.split('\n## ')[0] ?? '';
    const listed = [...contents.matchAll(/^\d+\. \[[^\]]+\]\(([^)]+)\)/gm)].map(m => m[1]);
    assert.deepEqual(listed, guide.map(s => s.file));
});

test('the guide names every disposition the Close Incident chooser offers', () => {
    const close = files['70-close-reopen.md'];
    for (const d of DISPOSITIONS) assert.ok(close.includes(`**${d}**`), `70-close-reopen.md does not name "${d}"`);
});
