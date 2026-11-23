// Units that are not on TAK (ops 1068, item 5). A unit that is off shift, has no TAK device or is not signed
// in still calls in on the radio, and a dispatcher needs to put it on the incident to document what it did.
// It is not a TAK contact, so it has no TAK uid and gets no messages; it is a callsign typed by the
// dispatcher, kept on the incident like any other unit (Assigned, On Scene, Cleared, with the server's times).
// Its uid is made from the callsign (`offtak:E99`), so the same callsign is the same unit on every incident
// of an Event and the one-incident-per-unit rule holds for it too. The server makes the uid itself and checks
// the callsign by the same rules (server/plugin-dispatcher.ts, <off-tak-pure>). Pure: no CloudTAK imports, so
// plugin/test/off-tak.test.ts runs this file as it ships.

export const OFF_TAK_PREFIX = 'offtak:';
export const OFF_TAK_CALLSIGN_MAX = 40;

// What the board and the sheets say about such a unit.
export const OFF_TAK_LABEL = 'Not on TAK';
const OFF_TAK_WORDS = 'not on TAK';

// A unit as the incident keeps it: only these two fields matter here.
export interface OffTakUnit { uid: string; off_tak?: boolean }

// A callsign as typed, ready to keep: one space between words, none around it.
export function offTakCallsign(v: string): string {
    return v.replace(/\s+/g, ' ').trim();
}

// What is wrong with a callsign for a unit not on TAK, in a plain sentence; '' when it is fine. Letters,
// digits and . _ / - and spaces only, so it cannot carry markup or break a CSV cell or a command line.
export function offTakCallsignProblem(callsign: string): string {
    const c = offTakCallsign(callsign);
    if (!c) return 'Type the callsign of the unit.';
    if (c.length > OFF_TAK_CALLSIGN_MAX) return `The callsign is longer than ${OFF_TAK_CALLSIGN_MAX} characters.`;
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(c)) return 'A callsign is letters, digits and . _ / - only, starting with a letter or digit.';
    return '';
}

// The unit's id: the callsign in upper case, so E99 and e99 are one unit.
export function offTakUid(callsign: string): string {
    return OFF_TAK_PREFIX + offTakCallsign(callsign).toUpperCase();
}

// The unit as it is sent to the server: the server makes its own uid from the callsign and keeps this flag.
export function offTakUnit(callsign: string): { uid: string; callsign: string; off_tak: true } {
    const c = offTakCallsign(callsign);
    return { uid: offTakUid(c), callsign: c, off_tak: true };
}

export function isOffTak(u: OffTakUnit): boolean {
    return u.off_tak === true && u.uid.startsWith(OFF_TAK_PREFIX);
}

// Messages (an assignment, a note) go to a unit with a TAK device only.
export function onTak<T extends OffTakUnit>(units: readonly T[]): T[] {
    return units.filter(u => !isOffTak(u));
}

// The words after a callsign in a list or a report: ` (not on TAK)`, or nothing for a TAK unit.
export function offTakTag(u: OffTakUnit): string {
    return isOffTak(u) ? ` (${OFF_TAK_WORDS})` : '';
}

// A word typed after A on the command line that names a unit not on TAK: `+E99`. null when it is not one.
export function offTakWord(word: string): string | null {
    return word.startsWith('+') && word.length > 1 ? word.slice(1) : null;
}
