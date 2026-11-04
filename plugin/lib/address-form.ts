// What the incident form does with a chosen address, kept out of the component so the proof tests
// (plugin/test/address-parse.test.ts) can run it. No CloudTAK imports: plain functions.

// A unit as it is compared: "#421", "# 421" and " 421 " are all unit 421.
const unitKey = (u: string) => u.trim().replace(/^#\s*/, '').toUpperCase();

export function sameUnit(a: string, b: string): boolean {
    const k = unitKey(a);
    return !!k && k === unitKey(b);
}

// The street line with its unit. The unit is added unless the line already ends with it
// ("125 N MAIN ST APT 1" and unit "1"). It is never looked for inside the line: "1" is also in
// the house number 125 and "A" in MAIN, and a unit must not be lost to that. A bare unit
// ("421", "4B", "B") gets the # sign, so it is not read as part of the street name; one typed
// with the sign keeps a single one.
export function streetWithUnit(street: string, unit: string): string {
    const s = street.trim(), u = unit.trim().replace(/^#\s*/, '');
    if (!u) return s;
    const S = s.toUpperCase(), U = u.toUpperCase();
    if (S.endsWith(` ${U}`) || S.endsWith(`#${U}`)) return s;
    const sign = unit.trim().startsWith('#') || /^(\d[A-Za-z0-9-]*|[A-Za-z])$/.test(u);
    return `${s} ${sign ? '#' : ''}${u}`.trim();
}

// How many units are offered as buttons under a chosen address. A large building has far more
// than the narrow pane can show: the rest are typed in the Unit box.
export const UNIT_CHOICES = 6;

// The unit buttons: the first few as the data gives them (nearest first after a map click), or,
// once something is in the Unit box, the first few that start with it, an exact one first.
export function unitChoices<T extends { unit: string }>(units: T[], typed: string): { shown: T[]; more: number } {
    const t = unitKey(typed);
    const all = !t ? units : [
        ...units.filter(u => unitKey(u.unit) === t),
        ...units.filter(u => unitKey(u.unit) !== t && unitKey(u.unit).startsWith(t)),
    ];
    return { shown: all.slice(0, UNIT_CHOICES), more: Math.max(0, all.length - UNIT_CHOICES) };
}

// The unit the data knows by exactly what is in the Unit box, if there is one.
export function unitNamed<T extends { unit: string }>(units: T[], typed: string): T | undefined {
    return units.find(u => sameUnit(typed, u.unit));
}

const PLACE_LINE = /^Common Place Name: [^\n]*\n?/;

// The incident details with the chosen place on the first line, or without that line when the
// chosen location is not a place. The line always names the current choice, never an earlier one.
export function detailsWithPlace(details: string, placeName: string | null | undefined): string {
    const rest = details.replace(PLACE_LINE, '');
    if (!placeName) return rest;
    const line = `Common Place Name: ${placeName}`;
    return rest ? `${line}\n${rest}` : line;
}
