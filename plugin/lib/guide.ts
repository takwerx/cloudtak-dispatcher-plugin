// The User Guide: one Markdown file per section in plugin/guide/, shown in its own floating pane
// (components/GuideFloat.vue, opened from the Events list). Text only, by design: no screenshots to
// go stale as the screens change; the steps say in words where each button is. Only the small part
// of Markdown a plain how-to guide needs is read (plugin/guide/README.md lists it), so the same files
// read the same on GitHub. The files become a tree that the Vue components render as elements: no
// HTML from them ever reaches the page. Pure: no imports, so plugin/test/guide.test.ts runs this
// file as it ships.

export type Inline =
    | { t: 'text'; v: string }
    | { t: 'strong'; c: Inline[] }
    | { t: 'code'; v: string }
    | { t: 'link'; href: string; c: Inline[] };

// GitHub's alert names (> [!TIP]), so a box looks the same on GitHub and in the pane.
export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export type Block =
    | { t: 'h'; level: 2 | 3 | 4; id: string; c: Inline[] }
    | { t: 'p'; c: Inline[] }
    | { t: 'ol' | 'ul'; items: Inline[][] }
    | { t: 'callout'; kind: CalloutKind; blocks: Block[] }
    | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

export interface GuideSection {
    id:     string;   // from the file name: 30-create-incident.md -> create-incident
    order:  number;   // the file name's number; the pane shows sections in this order
    file:   string;
    title:  string;   // the file's first "## " heading
    blocks: Block[];
}

// A section file: a number, a hyphen, a short lower-case name. Anything else (README.md) is not a section.
export const SECTION_FILE = /^(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

// The contents list's anchor (the pane's Contents button goes there); no section or heading may use it.
export const CONTENTS_ANCHOR = 'contents';

// Element ids in the pane carry this prefix so they can't clash with CloudTAK's own.
export function guideAnchorId(anchor: string): string {
    return `dispatcher-guide-${anchor}`;
}

// GitHub's heading anchors: lower case, punctuation dropped, each space a hyphen. A link written for
// GitHub ("#set-the-location") then works in the pane too.
export function slug(text: string): string {
    return text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

export function plainText(nodes: Inline[]): string {
    return nodes.map(n => (n.t === 'text' || n.t === 'code') ? n.v : plainText(n.c)).join('');
}

// **bold**, `typed text`, [link](target) and backslash escapes. Anything unmatched stays as text.
export function parseInline(src: string): Inline[] {
    const out: Inline[] = [];
    let text = '';
    const flush = () => {
        if (text) out.push({ t: 'text', v: text });
        text = '';
    };
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#+\-.!|>]/.test(src[i + 1])) {
            text += src[i + 1];
            i += 2;
            continue;
        }
        if (ch === '*' && src[i + 1] === '*') {
            const end = src.indexOf('**', i + 2);
            if (end > i + 2) {
                flush();
                out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) });
                i = end + 2;
                continue;
            }
        }
        if (ch === '`') {
            const end = src.indexOf('`', i + 1);
            if (end > i + 1) {
                flush();
                out.push({ t: 'code', v: src.slice(i + 1, end) });
                i = end + 1;
                continue;
            }
        }
        if (ch === '[') {
            const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
            if (m) {
                flush();
                out.push({ t: 'link', href: m[2], c: parseInline(m[1]) });
                i += m[0].length;
                continue;
            }
        }
        text += ch;
        i++;
    }
    flush();
    return out;
}

const HEADING   = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const ITEM      = /^(?:(\d+)\.|[-*])\s+(.*)$/;
const ALERT     = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i;
const TABLE_SEP = /^:?-+:?$/;

// A line that starts a new block, so it ends a paragraph or a list item's text.
function startsBlock(line: string): boolean {
    const t = line.trim();
    return HEADING.test(t) || t.startsWith('>') || t.startsWith('|') || t.startsWith('<!--') || ITEM.test(line);
}

function splitRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells: string[] = [];
    let cell = '';
    for (let i = 0; i < s.length; i++) {
        // An escaped pipe stays in the cell; parseInline turns "\|" back into "|".
        if (s[i] === '\\' && s[i + 1] === '|') {
            cell += '\\|';
            i++;
        } else if (s[i] === '|') {
            cells.push(cell.trim());
            cell = '';
        } else {
            cell += s[i];
        }
    }
    cells.push(cell.trim());
    return cells;
}

export function parseBlocks(lines: string[]): Block[] {
    const blocks: Block[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const t = line.trim();
        if (!t) {
            i++;
            continue;
        }

        // <!-- notes for whoever edits the file --> are never shown (GitHub hides them too).
        if (t.startsWith('<!--')) {
            while (i < lines.length && !lines[i].includes('-->')) i++;
            i++;
            continue;
        }

        const h = HEADING.exec(t);
        if (h) {
            const c = parseInline(h[2]);
            const level = Math.min(4, Math.max(2, h[1].length)) as 2 | 3 | 4;
            blocks.push({ t: 'h', level, id: slug(plainText(c)), c });
            i++;
            continue;
        }

        // > [!TIP] boxes. The quoted lines are read again as blocks, so a box can hold a list.
        if (t.startsWith('>')) {
            const inner: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('>')) {
                inner.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            const alert = ALERT.exec(inner[0]?.trim() ?? '');
            if (alert) inner.shift();
            const kind = (alert ? alert[1].toLowerCase() : 'note') as CalloutKind;
            blocks.push({ t: 'callout', kind, blocks: parseBlocks(inner) });
            continue;
        }

        if (t.startsWith('|')) {
            const rows: string[][] = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                rows.push(splitRow(lines[i]));
                i++;
            }
            if (rows.length >= 2 && rows[1].every(cell => TABLE_SEP.test(cell))) {
                blocks.push({
                    t:    'table',
                    head: rows[0].map(parseInline),
                    rows: rows.slice(2).map(r => r.map(parseInline)),
                });
            } else {
                blocks.push({ t: 'p', c: parseInline(rows.map(r => r.join(' ')).join(' ')) });
            }
            continue;
        }

        // Numbered steps or bullets. An item's text goes on until a blank line or the next block;
        // there are no lists inside lists.
        const first = ITEM.exec(line);
        if (first) {
            const ordered = first[1] !== undefined;
            const items: string[] = [];
            while (i < lines.length && lines[i].trim()) {
                const m = ITEM.exec(lines[i]);
                if (m) {
                    if ((m[1] !== undefined) !== ordered) break;
                    items.push(m[2].trim());
                } else if (startsBlock(lines[i])) {
                    break;
                } else {
                    items[items.length - 1] += ` ${lines[i].trim()}`;
                }
                i++;
            }
            blocks.push({ t: ordered ? 'ol' : 'ul', items: items.map(parseInline) });
            continue;
        }

        const para: string[] = [];
        while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines[i]))) {
            para.push(lines[i].trim());
            i++;
        }
        blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
    }
    return blocks;
}

// One section file. null for a file that isn't a section (see SECTION_FILE).
export function parseSection(file: string, text: string): GuideSection | null {
    const m = SECTION_FILE.exec(file);
    if (!m) return null;
    const blocks = parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'));
    const first = blocks[0];
    const titled = first?.t === 'h' && first.level === 2;
    return {
        id:     m[2],
        order:  Number(m[1]),
        file,
        title:  titled ? plainText(first.c) : m[2],
        blocks: titled ? blocks.slice(1) : blocks,
    };
}

// Every section file, in number order. Keys are file paths; only the file name counts.
export function buildGuide(files: Record<string, string>): GuideSection[] {
    const sections: GuideSection[] = [];
    for (const [path, text] of Object.entries(files)) {
        const s = parseSection(path.split('/').pop() ?? path, text);
        if (s) sections.push(s);
    }
    return sections.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
}

export type LinkTarget =
    | { kind: 'internal'; anchor: string }
    | { kind: 'external'; href: string }
    | { kind: 'none' };

// Where a link points. Inside the guide: "#a-heading", "70-events.md" (that section) or
// "70-events.md#a-heading"; headings are unique across the guide (the unit tests check), so the
// anchor alone finds it. Outside the guide: https only. Anything else is shown as plain text.
export function resolveLink(href: string): LinkTarget {
    if (/^https:\/\/\S+$/i.test(href)) return { kind: 'external', href };
    const hash = href.indexOf('#');
    const file = hash === -1 ? href : href.slice(0, hash);
    const anchor = hash === -1 ? '' : href.slice(hash + 1);
    if (file) {
        const m = SECTION_FILE.exec(file);
        return m ? { kind: 'internal', anchor: anchor || m[2] } : { kind: 'none' };
    }
    return anchor ? { kind: 'internal', anchor } : { kind: 'none' };
}

// A section's parts (its ### headings) for the contents list, so a reader can jump straight to a task.
export function sectionParts(section: GuideSection): { id: string; title: string }[] {
    return section.blocks.flatMap(b => b.t === 'h' && b.level === 3 ? [{ id: b.id, title: plainText(b.c) }] : []);
}
