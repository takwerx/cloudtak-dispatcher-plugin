// The Dispatcher command line: what a typed line means. One line is
//
//     [incident] VERB [units or text]        14 A H35      O H35      T 2 patients, one trapped
//
// The incident's short number comes first and is optional: left out, the command is for the incident the
// dispatcher is working (or, for a unit's status, the incident that unit is on). Nothing after the verb is
// ever read as an incident, so a callsign made of digits and a note that starts with a number are safe.
// The single letters are the first letters of the buttons they stand for.
// Pure: its only import is unit-status.ts, which is pure too, so plugin/test/command-line.test.ts loads
// this file as it ships.
import { shortNumber, unitStatus } from './unit-status.ts';
import type { AssignedContact, DispatcherIncident } from './events-client.ts';

export interface CommandDef {
    verb:    string;
    args:    string;   // what follows the verb, as shown in the list
    does:    string;   // the button it stands for, in the Dispatcher's own words
    example: string;
}

// Every command, in the order the list (?) shows them. The parser accepts exactly these verbs.
export const COMMANDS: readonly CommandDef[] = [
    { verb: '',    args: 'number',         does: 'Open that incident',                          example: '14' },
    { verb: 'N',   args: 'type, address',  does: 'New incident: opens the form filled in',      example: 'N fire, 120 main' },
    { verb: 'A',   args: 'units',          does: 'Assign units',                                example: 'A H35 E6' },
    { verb: 'O',   args: 'units',          does: 'On Scene',                                    example: 'O H35' },
    { verb: 'C',   args: 'units',          does: 'Clear',                                       example: 'C H35' },
    { verb: 'UN',  args: 'unit',           does: 'Remove a unit assigned by mistake',           example: 'UN H35' },
    { verb: 'T',   args: 'text',           does: 'Add note',                                    example: 'T 2 patients, one trapped' },
    { verb: 'X',   args: 'disposition',    does: 'Close Incident',                              example: 'X unf' },
    { verb: 'R',   args: 'reason',         does: 'Reopen',                                      example: '14 R caller called back' },
    { verb: 'RN',  args: 'number',         does: 'Report number',                               example: 'RN 26-00123' },
    { verb: 'CA',  args: 'name, phone, note', does: 'Add caller',                               example: 'CA J Smith, 555-0100, sees smoke' },
    { verb: 'CP',  args: 'caller number',  does: 'Make that caller primary',                    example: 'CP 2' },
    { verb: 'M',   args: '',               does: 'Show on Map',                                 example: '14 M' },
    { verb: 'W',   args: '',               does: 'Undock: open in its own window',              example: '14 W' },
    { verb: 'WX',  args: '(ALL)',          does: 'Close its window, or all of them',            example: 'WX ALL' },
    { verb: 'L',   args: '(U, A or C)',    does: 'Back to the list, or to a tab',               example: 'L C' },
    { verb: 'SI',  args: 'employee number', does: 'Sign in',                                    example: 'SI 4521' },
    { verb: 'SO',  args: '',               does: 'Sign out',                                    example: 'SO' },
    { verb: 'EV',  args: '',               does: 'Switch event',                                example: 'EV' },
    { verb: 'REP', args: '',               does: 'Event report',                                example: 'REP' },
    { verb: 'SET', args: '',               does: 'Settings',                                    example: 'SET' },
    { verb: 'POP', args: '',               does: 'Pop out, or open the workspace',              example: 'POP' },
    { verb: 'DOCK', args: '',              does: 'Dock back to the panel',                      example: 'DOCK' },
    { verb: '?',   args: '',               does: 'This list',                                   example: '?' },
];

const VERBS = new Set(COMMANDS.map(c => c.verb));

export interface ParsedLine {
    incident: string | null;   // the digits typed first, as typed
    verb:     string;          // upper case; '' = the number alone (open that incident)
    rest:     string;          // everything after the verb, trimmed
}

/** A typed line as its three parts, an error to show, or null for an empty line. */
export function parseLine(line: string): ParsedLine | { error: string } | null {
    const text = line.trim();
    if (!text) return null;
    if (text === '?') return { incident: null, verb: '?', rest: '' };
    const m = /^(\d+)?\s*([A-Za-z]*)(.*)$/s.exec(text);
    if (!m) return { error: 'Not a command. Type ? for the list.' };
    const incident = m[1] ?? null;
    const verb = m[2].toUpperCase();
    const rest = m[3].trim();
    if (!verb) {
        if (incident && !rest) return { incident, verb: '', rest: '' };
        return { error: 'Not a command. Type ? for the list.' };
    }
    if (!VERBS.has(verb)) return { error: `${verb} is not a command. Type ? for the list.` };
    return { incident, verb, rest };
}

/** The words of a unit or type list: split on spaces and commas. */
export function words(rest: string): string[] {
    return rest.split(/[\s,]+/).filter(Boolean);
}

// ── Incident numbers ─────────────────────────────────────────────────────────────────────────────────

/** The incident a typed number names: `14` is `014`. Leading zeros do not matter. */
export function findIncident<T extends { number: string }>(incidents: readonly T[], typed: string): T | undefined {
    const want = typed.replace(/^0+(?=\d)/, '');
    return incidents.find(i => shortNumber(i.number).replace(/^0+(?=\d)/, '') === want);
}

/**
 * The incident a command is for: the number typed first, else the one the dispatcher is working
 * (`currentId`). An error to show when the number is not on the board, or when there is neither.
 */
export function targetIncident<T extends { id: string; number: string }>(
    incidents: readonly T[], p: ParsedLine, currentId: string | null,
): T | { error: string } {
    if (p.incident) {
        return findIncident(incidents, p.incident) ?? { error: `No incident ${p.incident} in this event.` };
    }
    const current = currentId ? incidents.find(i => i.id === currentId) : undefined;
    return current ?? { error: `Which incident? Put its number first: 14 ${p.verb} ${p.rest}`.trim() };
}

// ── Units ────────────────────────────────────────────────────────────────────────────────────────────
// Callsigns are whatever each TAK user set, often several parts: `AGENCY-NAME-H202`, two radio IDs joined
// by a slash, or the bare ID. A dispatcher types the part said on the air.

const SEPARATORS = /[-/\s]+/;

/** The parts of a callsign, upper case: `AGENCY-NAME-X35/D13` -> AGENCY, NAME, X35, D13. */
export function callsignParts(callsign: string): string[] {
    return callsign.toUpperCase().split(SEPARATORS).filter(Boolean);
}

export interface UnitMatch<T> {
    // Units the typed word names exactly: the whole callsign, one of its parts, or a run of parts
    // (`NAME-H202`). One of these is acted on; several are offered as a numbered list.
    exact:   T[];
    // Units with a part that only starts with the typed word. Never acted on, only listed.
    partial: T[];
}

export function matchUnits<T extends { callsign: string }>(typed: string, units: readonly T[]): UnitMatch<T> {
    const want = callsignParts(typed);
    const out: UnitMatch<T> = { exact: [], partial: [] };
    if (!want.length) return out;
    for (const u of units) {
        const parts = callsignParts(u.callsign);
        let exact = false;
        for (let i = 0; i + want.length <= parts.length && !exact; i++) {
            exact = want.every((w, k) => parts[i + k] === w);
        }
        if (exact) out.exact.push(u);
        else if (want.length === 1 && parts.some(p => p.startsWith(want[0]))) out.partial.push(u);
    }
    return out;
}

// What a typed word comes to among the units it could mean. Exactly one unit named exactly is the
// answer. Several, or only units it partly fits, are never guessed at: they are offered as a list.
export type UnitPick<T> = { kind: 'one'; unit: T } | { kind: 'ask'; options: T[] } | { kind: 'none' };

export function pickUnit<T extends { callsign: string }>(word: string, candidates: readonly T[]): UnitPick<T> {
    const m = matchUnits(word, candidates);
    if (m.exact.length === 1) return { kind: 'one', unit: m.exact[0] };
    const options = m.exact.length ? m.exact : m.partial;
    return options.length ? { kind: 'ask', options } : { kind: 'none' };
}

/**
 * Every typed word as the unit it means, in order, each unit once. `ask` puts a list to the dispatcher
 * and gives back the one picked (it rejects when they cancel); `none` is the error for a word that fits
 * nothing. Nothing is changed here: a line with one wrong word stops before anything is done.
 */
export async function resolveUnits<T extends { callsign: string }>(
    typed: readonly string[], candidates: readonly T[],
    opts: { ask: (word: string, options: T[]) => Promise<T>; none: (word: string) => Error },
): Promise<T[]> {
    const out: T[] = [];
    for (const w of typed) {
        const p = pickUnit(w, candidates);
        if (p.kind === 'none') throw opts.none(w);
        const unit = p.kind === 'one' ? p.unit : await opts.ask(w, p.options);
        if (!out.includes(unit)) out.push(unit);
    }
    return out;
}

/**
 * Do `act` for each resolved unit, in order; it returns the line to show. When one fails after others
 * went through, the error says what was done and what was not, since the line cannot simply be retried.
 */
export async function actOnEach<T extends { callsign: string }>(units: readonly T[], act: (unit: T) => Promise<string>): Promise<string[]> {
    const done: string[] = [];
    for (const u of units) {
        try {
            done.push(await act(u));
        } catch (e) {
            if (!done.length) throw e;
            throw new Error(`Done: ${done.join(' · ')}. Not done: ${u.callsign} (${e instanceof Error ? e.message : String(e)})`, { cause: e });
        }
    }
    return done;
}

// A unit on an incident, for On Scene / Clear / remove.
export interface UnitRow { callsign: string; inc: DispatcherIncident; unit: AssignedContact }

/**
 * The units a status command can be about, on the open incidents given: those still Assigned (for On
 * Scene), or every one still working (for Clear and remove). A unit works one incident at a time, so
 * over the whole board its callsign names the incident.
 */
export function unitRows(incidents: readonly DispatcherIncident[], want: 'assigned' | 'working'): UnitRow[] {
    return incidents.filter(i => i.status === 'active').flatMap(inc => (inc.assigned ?? [])
        .filter(u => (want === 'assigned' ? unitStatus(u) === 'assigned' : unitStatus(u) !== 'cleared'))
        .map(unit => ({ callsign: unit.callsign, inc, unit })));
}

// ── Incident types and dispositions ──────────────────────────────────────────────────────────────────

export interface NamedOption { code?: string; name: string }

const nameWords = (s: string) => s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

/**
 * The options a typed text names, best kind of match first: a code, the whole name, the start of the
 * name, then every typed word starting a word of the name ("med em" is Medical Emergency). One option
 * back is the answer; several are offered as a numbered list; none is an error.
 */
export function matchOptions<T extends NamedOption>(typed: string, options: readonly T[]): T[] {
    const text = typed.trim().toUpperCase();
    if (!text) return [];
    const byCode = options.filter(o => (o.code ?? '').toUpperCase() === text);
    if (byCode.length) return byCode;
    const whole = options.filter(o => o.name.toUpperCase() === text);
    if (whole.length) return whole;
    const starts = options.filter(o => o.name.toUpperCase().startsWith(text));
    if (starts.length) return starts;
    const want = nameWords(text);
    if (!want.length) return [];
    return options.filter((o) => {
        const have = nameWords(o.name);
        return want.every(w => have.some(h => h.startsWith(w)));
    });
}

// What follows X: a disposition named by the start of its words, or Other with its text. No text asks
// for one of them all; several fits ask for one of those.
export type DispositionRead = { disposition: string; note: string } | { ask: string[] } | { error: string };

export function readDisposition(rest: string, presets: readonly string[], other: string): DispositionRead {
    const text = rest.trim();
    if (!text) return { ask: [...presets, other] };
    const [first, ...more] = text.split(/\s+/);
    if (other.toUpperCase().startsWith(first.toUpperCase())) {
        const note = more.join(' ');
        return note ? { disposition: other, note } : { error: `${other} needs its text: X other lost contact with caller` };
    }
    const m = matchOptions(text, presets.map(name => ({ name })));
    if (!m.length) return { error: `No disposition matches "${text}".` };
    return m.length === 1 ? { disposition: m[0].name, note: '' } : { ask: m.map(d => d.name) };
}

// ── Callers ──────────────────────────────────────────────────────────────────────────────────────────

// A phone number as typed: mostly digits ("555-0100", "555 0100 ext 4"), not a sentence with a number
// in it ("3 cars involved", "apartment 302").
function looksLikePhone(field: string): boolean {
    const digits = (field.match(/\d/g) ?? []).length;
    const letters = (field.match(/[A-Za-z]/g) ?? []).length;
    return digits >= 3 && digits >= letters;
}

/**
 * `CA name, phone, note`. The name or the phone may be left out: a first field that looks like a phone
 * is the phone (a caller who gave no name), and a second field that does not is the start of the note
 * (a caller who gave no number). The note is everything after that, commas included.
 */
export function parseCaller(rest: string): { name: string; phone: string; note: string } {
    const fields = rest.split(',').map(f => f.trim());
    const note = (from: number) => fields.slice(from).filter(Boolean).join(', ');
    if (fields[0] && looksLikePhone(fields[0])) return { name: '', phone: fields[0], note: note(1) };
    if (fields[1] && looksLikePhone(fields[1])) return { name: fields[0], phone: fields[1], note: note(2) };
    return { name: fields[0] ?? '', phone: '', note: note(1) };
}

/** `N type, address`: the type is what comes before the first comma, the address everything after it. */
export function parseNew(rest: string): { type: string; address: string } {
    const i = rest.indexOf(',');
    if (i === -1) return { type: rest.trim(), address: '' };
    return { type: rest.slice(0, i).trim(), address: rest.slice(i + 1).trim() };
}

// ── Shown or hidden, per computer (like Display Mode) ────────────────────────────────────────────────

export const COMMAND_LINE_KEY = 'tak-dispatcher-command-line-v1';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(s?: Storage): Storage | undefined {
    if (s) return s;
    try { return globalThis.localStorage ?? undefined; } catch { return undefined; }
}

/** Whether this computer shows the command line. Hidden unless it was turned on here. */
export function loadCommandLine(s?: Storage): boolean {
    try { return storage(s)?.getItem(COMMAND_LINE_KEY) === 'on'; }
    catch { return false; }
}

/** Remember it for this computer. Hidden is stored as "nothing stored". */
export function saveCommandLine(shown: boolean, s?: Storage): void {
    try {
        const st = storage(s);
        if (shown) st?.setItem(COMMAND_LINE_KEY, 'on');
        else st?.removeItem(COMMAND_LINE_KEY);
    } catch { /* storage unavailable: it lasts for this page only */ }
}

// ── Typed lines to go back to with the Up arrow ──────────────────────────────────────────────────────

export const HISTORY_MAX = 30;

/** The history with one more line: newest last, no immediate repeat, capped. */
export function pushHistory(history: readonly string[], line: string): string[] {
    const text = line.trim();
    if (!text || history[history.length - 1] === text) return [...history];
    return [...history, text].slice(-HISTORY_MAX);
}
