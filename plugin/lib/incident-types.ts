// Incident types for the standalone New Incident form: the built-in list, the admin's own list
// (Dispatcher Settings → Incident Types: loaded from a CSV file or typed in) and the admin switch
// that hides the built-in ones. A type is a NAME with an optional short CODE ("MVA" for "Traffic
// Accident"), and more codes if the agency wants several ways to type it on the command line
// (`aliases`: "WRECK" and "1050" also start a Traffic Accident). The first code is the one the
// dropdown shows. An incident stores the name as text, as it always has, so markers and reports are
// unchanged; the codes live only in this list. Pure: no CloudTAK imports, so
// plugin/test/incident-types.test.ts runs this file as it ships. The server checks a saved list by
// the same rules (server/plugin-dispatcher.ts, <incident-types-pure>).

// The built-in types. TAK-CAD mode loads its server's types but falls back to these.
export const DEFAULT_INCIDENT_TYPES = [
    'Medical Emergency', 'Medical Assist', 'Fire', 'Traffic Accident',
    'Hazardous Spill', 'Criminal Activity', 'Fight', 'Public Disturbance', 'Bomb Threat',
    'Animal Control', 'Gas Leak', 'Water Main Break', 'Missing Person',
    'Crowd Control', 'VIP Security', 'Welfare Check', 'Other',
];

// One line of the Incident Type dropdown. `code` is '' when the type has none. `aliases` are its other
// codes, left out when there are none; a type with no code has none either.
export interface IncidentTypeOption { code: string; name: string; aliases?: string[] }

// Shared settings (dispatcher_settings), both CloudTAK system admin only: the admin's list, and the
// switch "use only these incident types".
export const INCIDENT_TYPES_SETTING = 'incident_types';
export const INCIDENT_TYPES_ONLY_SETTING = 'incident_types_only';

// Same caps as the server.
export const INCIDENT_TYPE_CODE_MAX = 8;
export const INCIDENT_TYPE_NAME_MAX = 60;
export const INCIDENT_TYPES_MAX = 300;
export const INCIDENT_TYPE_CODES_MAX = 10;   // codes per type, the first one included

// The biggest CSV file the card reads. A full list (300 types of a code and a 60-character name) is about
// 25 KB; ten codes for every type would be about 210 KB, but a real list gives a few types a few codes,
// so this still leaves room for quotes and a spreadsheet's extra columns. A bigger file is refused before
// it is read, so a wrong file (a log, a picture) cannot freeze the admin's browser tab.
export const INCIDENT_TYPE_FILE_MAX_BYTES = 200 * 1024;

// What to tell the admin about a file of `size` bytes: empty text when it can be read.
export function incidentTypeFileProblem(size: number): string {
    return size > INCIDENT_TYPE_FILE_MAX_BYTES
        ? `That file is too big (over ${INCIDENT_TYPE_FILE_MAX_BYTES / 1024} KB). A list of incident types has one short line per type.`
        : '';
}

// A code as typed, ready to store: no spaces around it, upper case.
export function incidentTypeCode(v: string): string {
    return v.trim().toUpperCase();
}

// A name as typed, ready to store: one space between words, none around it.
export function incidentTypeName(v: string): string {
    return v.replace(/\s+/g, ' ').trim();
}

// Letters and digits only, no spaces, INCIDENT_TYPE_CODE_MAX at most.
export function isIncidentTypeCode(code: string): boolean {
    return code.length <= INCIDENT_TYPE_CODE_MAX && /^[A-Za-z0-9]+$/.test(code);
}

// Every code of a type, the one the dropdown shows first.
export function incidentTypeCodes(t: IncidentTypeOption): string[] {
    return [t.code, ...(t.aliases ?? [])].filter(Boolean);
}

// A type with these codes: the first is the one shown, the rest are its aliases.
export function withIncidentTypeCodes(name: string, codes: string[]): IncidentTypeOption {
    const [code = '', ...aliases] = codes;
    return aliases.length ? { code, name, aliases } : { code, name };
}

// The admin's list as saved. An older list is plain names (["Brush Fire"]): those load as names with
// no code. Anything that is not a type is skipped rather than failing the read, and so is a second
// type with a name already in the list; a code that is malformed or already taken is dropped.
export function savedIncidentTypes(v: unknown): IncidentTypeOption[] {
    if (!Array.isArray(v)) return [];
    const out: IncidentTypeOption[] = [];
    const names = new Set<string>();
    const codes = new Set<string>();
    for (const t of v) {
        const o = (t && typeof t === 'object' ? t : { name: t }) as { code?: unknown; name?: unknown; aliases?: unknown };
        const name = typeof o.name === 'string' ? incidentTypeName(o.name) : '';
        if (!name || names.has(name.toLowerCase())) continue;
        const mine: string[] = [];
        for (const c of [o.code, ...(Array.isArray(o.aliases) ? o.aliases : [])]) {
            const code = typeof c === 'string' ? incidentTypeCode(c) : '';
            if (!code || !isIncidentTypeCode(code) || codes.has(code) || mine.length >= INCIDENT_TYPE_CODES_MAX) continue;
            codes.add(code);
            mine.push(code);
        }
        names.add(name.toLowerCase());
        out.push(withIncidentTypeCodes(name, mine));
    }
    return out;
}

// The switch as read from the settings: only true turns it on.
export function incidentTypesOnly(settings: Record<string, unknown> | null | undefined): boolean {
    return settings?.[INCIDENT_TYPES_ONLY_SETTING] === true;
}

// The types a dispatcher picks from, in dropdown order, from what getDispatcherSettings() returns.
//   Switch on:  the admin's list and nothing else, in the admin's order. With an empty list the
//               built-in types stay, so the dropdown is never empty.
//   Switch off: the built-in types (without Other), then the admin's types by name, then Other. A
//               type in the admin's list with a built-in type's name gives that one its codes.
export function incidentTypeOptions(settings: Record<string, unknown>): IncidentTypeOption[] {
    const own = savedIncidentTypes(settings?.[INCIDENT_TYPES_SETTING]);
    if (incidentTypesOnly(settings) && own.length) return own;
    const byName = new Map(own.map(t => [t.name.toLowerCase(), t]));
    const builtIn = DEFAULT_INCIDENT_TYPES.map((name) => {
        const mine = byName.get(name.toLowerCase());
        return mine ? withIncidentTypeCodes(name, incidentTypeCodes(mine)) : { code: '', name };
    });
    const builtInNames = new Set(builtIn.map(t => t.name.toLowerCase()));
    const extra = own
        .filter(t => !builtInNames.has(t.name.toLowerCase()))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // Keep 'Other' at the bottom, the admin's types above it.
    return [...builtIn.filter(t => t.name !== 'Other'), ...extra, ...builtIn.filter(t => t.name === 'Other')];
}

// What the dropdown shows for one type: "MVA - Traffic Accident", or the name alone. Aliases are for
// typing and are not shown.
export function incidentTypeLabel(t: IncidentTypeOption): string {
    return t.code ? `${t.code} - ${t.name}` : t.name;
}

// "Row 4", "Rows 4 and 9", "Rows 4, 9 and 12".
function rowsLabel(rows: number[]): string {
    if (rows.length === 1) return `Row ${rows[0]}`;
    return `Rows ${rows.slice(0, -1).join(', ')} and ${rows[rows.length - 1]}`;
}

// One thing wrong with a list, and the first row it is about (problems are listed in row order).
interface TypeProblem { row: number; text: string }

// One row of a file, or one code of a type in a list: the type it is for and its row.
interface TypeRow { code: string; name: string; row: number }

// `file`: the rows of a CSV file, where a row with a name already seen gives that type one more code.
// Otherwise the codes of a list of types, numbered by place, where a name may be there only once.
function typeProblems(list: TypeRow[], file: boolean): TypeProblem[] {
    const problems: TypeProblem[] = [];
    // What was seen (the code, or the name as first spelled), the rows it was seen in and, for a
    // name, how many codes its type has.
    const codes = new Map<string, { text: string; rows: number[] }>();
    const names = new Map<string, { text: string; rows: number[]; codes: number }>();
    for (const t of list) {
        if (t.code && !isIncidentTypeCode(t.code)) {
            problems.push({ row: t.row, text: `Row ${t.row}: the code "${t.code}" must be letters and digits only, no spaces, ${INCIDENT_TYPE_CODE_MAX} at most.` });
        } else if (t.code) {
            const hit = codes.get(t.code.toLowerCase()) ?? { text: t.code, rows: [] };
            hit.rows.push(t.row);
            codes.set(t.code.toLowerCase(), hit);
        }
        if (!t.name) {
            problems.push({ row: t.row, text: `Row ${t.row}: the name is missing.` });
        } else if (t.name.length > INCIDENT_TYPE_NAME_MAX) {
            problems.push({ row: t.row, text: `Row ${t.row}: the name is longer than ${INCIDENT_TYPE_NAME_MAX} characters.` });
        } else {
            const hit = names.get(t.name.toLowerCase());
            if (!hit) {
                names.set(t.name.toLowerCase(), { text: t.name, rows: [t.row], codes: t.code ? 1 : 0 });
                continue;
            }
            if (!hit.rows.includes(t.row)) hit.rows.push(t.row);
            if (file && !t.code) {
                problems.push({ row: t.row, text: `Row ${t.row}: "${hit.text}" is already on row ${hit.rows[0]}. Another row for the same type must add a code.` });
            } else if (t.code && ++hit.codes === INCIDENT_TYPE_CODES_MAX + 1) {
                problems.push({ row: t.row, text: `Row ${t.row}: "${hit.text}" has more than ${INCIDENT_TYPE_CODES_MAX} codes.` });
            }
        }
    }
    for (const c of codes.values()) {
        if (c.rows.length > 1) problems.push({ row: c.rows[0], text: `${rowsLabel(c.rows)}: the code ${c.text.toUpperCase()} is used more than once.` });
    }
    if (!file) {
        for (const n of names.values()) {
            if (n.rows.length > 1) problems.push({ row: n.rows[0], text: `${rowsLabel(n.rows)}: the name "${n.text}" is used more than once.` });
        }
    }
    return problems;
}

// Row order; problems about the same row keep the order they were found in.
function inRowOrder(problems: TypeProblem[]): string[] {
    return problems.map((p, i) => ({ ...p, i })).sort((a, b) => (a.row - b.row) || (a.i - b.i)).map(p => p.text);
}

function tooMany(count: number): string[] {
    return count > INCIDENT_TYPES_MAX ? [`There are ${count} types; ${INCIDENT_TYPES_MAX} is the most.`] : [];
}

// What is wrong with a list, one plain sentence per problem; empty when it can be saved. Types are
// numbered by their place in the list.
export function incidentTypeProblems(types: IncidentTypeOption[]): string[] {
    const list = types.flatMap((t, i) => {
        const codes = incidentTypeCodes(t);
        return (codes.length ? codes : ['']).map(code => ({ code, name: t.name, row: i + 1 }));
    });
    return [...inRowOrder(typeProblems(list, false)), ...tooMany(types.length)];
}

// A CSV file as rows of cells, split on `sep`. Quotes around a cell let it hold the separator; ""
// inside quotes is a quote.
function csvRows(text: string, sep: string): string[][] {
    const rows: string[][] = [];
    let cells: string[] = [];
    let cell = '';
    let quoted = false;
    const s = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quoted) {
            if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"' && !cell.trim()) {
            quoted = true;
            cell = '';
        } else if (c === sep) {
            cells.push(cell);
            cell = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            cells.push(cell);
            rows.push(cells);
            cells = [];
            cell = '';
        } else {
            cell += c;
        }
    }
    if (cell || cells.length) {
        cells.push(cell);
        rows.push(cells);
    }
    return rows;
}

// What separates the columns, and what the messages call it.
const SEPARATORS: Record<string, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab' };

// The rows of the admin's file, cells tidied. The separator is a comma. A spreadsheet set up for
// another region saves semicolons, and a copy out of a spreadsheet has tabs: one of those is the
// separator instead when it splits more rows than the comma does and at least half of them. When
// it splits only a few, nobody can tell a separator from a name with a semicolon in it, so those
// rows are named (`unsure`) rather than read one way or the other.
function typeRows(text: string): { rows: string[][]; sep: string; unsure: TypeProblem[] } {
    const reads = Object.keys(SEPARATORS).map((sep) => {
        const rows = csvRows(text, sep).map(cells => cells.map(incidentTypeName));
        const filled = rows.filter(cells => cells.some(Boolean)).length;
        // Rows (numbered from 1) that have something after the first cell.
        const split = rows.flatMap((cells, i) => (cells.slice(1).some(Boolean) ? [i + 1] : []));
        return { rows, sep, filled, split };
    });
    let best = reads[0];
    for (const r of reads.slice(1)) {
        if (r.split.length > best.split.length && r.split.length * 2 >= r.filled) best = r;
    }
    const unsure = reads
        .filter(r => r.split.length > best.split.length)
        .flatMap(r => r.split.map(row => ({
            row,
            text: `Row ${row}: has a ${SEPARATORS[r.sep]} in it. Use a comma between the code and the name, or put quotes around a name that has a ${SEPARATORS[r.sep]} in it.`,
        })));
    return { rows: best.rows, sep: best.sep, unsure };
}

// What a header row calls the name column.
const NAME_HEADERS = new Set(['name', 'type', 'incident type', 'description']);

// A header row is header words and nothing else: "code" then a name word, or a name word alone. A
// row that only starts with the word (a type whose code is CODE) is a type.
function isTypeHeader(cells: string[]): boolean {
    const [first, second = '', ...rest] = cells.map(c => c.toLowerCase());
    if (rest.some(Boolean)) return false;
    return second ? first === 'code' && NAME_HEADERS.has(second) : NAME_HEADERS.has(first);
}

// Read the admin's CSV file: two columns, code then name, one code per row. The code may be left
// empty (",Welfare Check"), and a row with a single cell is a name with no code. A type with more than
// one code has one row per code, all with its name: the first row's code is the one the dropdown
// shows, the others are aliases for the command line, and the type keeps the place of its first row.
// Blank rows and a first row of header words ("code,name", or "name" alone) are skipped. Semicolons
// or tabs between the columns are read too. Codes come back in upper case. Any problem refuses the
// whole file: `errors` names the rows as a spreadsheet numbers them, and `types` is then empty.
export function parseIncidentTypeCsv(text: string): { types: IncidentTypeOption[]; errors: string[] } {
    const list: TypeRow[] = [];
    const file = typeRows(text);
    const problems: TypeProblem[] = [...file.unsure];
    let header = true;
    file.rows.forEach((cells, i) => {
        if (cells.every(c => !c)) return;
        const first = header;
        header = false;
        if (first && isTypeHeader(cells)) return;
        if (cells.slice(2).some(Boolean)) {
            problems.push({ row: i + 1, text: `Row ${i + 1}: more than two columns. Put quotes around a name that has a ${SEPARATORS[file.sep]} in it.` });
            return;
        }
        list.push(cells.length === 1
            ? { code: '', name: cells[0], row: i + 1 }
            : { code: incidentTypeCode(cells[0]), name: cells[1], row: i + 1 });
    });
    // One type per name, in the order of its first row, with its codes in row order.
    const byName = new Map<string, { name: string; codes: string[] }>();
    for (const t of list) {
        const hit = byName.get(t.name.toLowerCase());
        if (!hit) byName.set(t.name.toLowerCase(), { name: t.name, codes: t.code ? [t.code] : [] });
        else if (t.code) hit.codes.push(t.code);
    }
    const types = [...byName.values()].map(t => withIncidentTypeCodes(t.name, t.codes));
    const errors = [...inRowOrder([...problems, ...typeProblems(list, true)]), ...tooMany(types.length)];
    if (!types.length && !errors.length) errors.push('No incident types were found in the file.');
    return errors.length ? { types: [], errors } : { types, errors };
}

// The file behind "Download example CSV": made-up rows that show a code, a type with a second code
// (one more row with the same name), a name with a comma in it and a type with no code.
export const INCIDENT_TYPE_EXAMPLE_NAME = 'incident-types-example.csv';
export const INCIDENT_TYPE_EXAMPLE_CSV = [
    'code,name',
    'MVA,Traffic Accident',
    'WRECK,Traffic Accident',
    'STR,Structure Fire',
    'MED,Medical Emergency',
    'ALARM,"Alarm, Commercial"',
    ',Welfare Check',
    '',
].join('\r\n');
