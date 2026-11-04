// Pure helpers for the caller phone on an incident marker. No CloudTAK imports, so
// plugin/test/marker-contact.test.ts can run them with plain node.

// Dial-friendly form of a phone number for <contact phone>: digits with an optional leading
// '+'. Anything after an extension marker (x / ext / #) is dropped, since it would otherwise
// be dialed as part of the number. Returns '' when there is nothing dialable.
export function dialablePhone(raw: string | null | undefined): string {
    const head = String(raw ?? '').split(/\s*(?:ext\.?|x|#)/i)[0].trim();
    const digits = head.replace(/\D/g, '');
    if (!digits) return '';
    return (head.startsWith('+') ? '+' : '') + digits;
}

// A caller as the marker sees it (the shape the server sends in `callers`).
export interface MarkerCaller {
    name?:    string | null;
    phone?:   string | null;
    note?:    string | null;
    primary?: boolean;
}

// The primary caller: the one marked primary, else the first. undefined when there are none.
export function primaryCaller<T extends MarkerCaller>(callers?: T[] | null): T | undefined {
    const list = callers ?? [];
    return list.find(c => c.primary) ?? list[0];
}

// One caller as "<name> · <phone> — <note>", leaving out whatever is blank.
function callerText(c: MarkerCaller): string {
    const who = [String(c.name ?? '').trim(), String(c.phone ?? '').trim()].filter(Boolean).join(' · ');
    const note = String(c.note ?? '').trim();
    return [who, note].filter(Boolean).join(' — ');
}

// The marker remarks for the callers: "Caller: <one>" for a single caller, or
// "Callers: <primary> (primary); <next>; ..." for several, primary first and the rest in the order
// received. '' when there are none. Callers come ONLY from this list, never from the notes log,
// so passing [] (Caller Details off) keeps every caller name, phone and note off the marker.
export function callersRemark(callers?: MarkerCaller[] | null): string {
    const list = (callers ?? []).filter(c => callerText(c));
    if (!list.length) return '';
    if (list.length === 1) return `Caller: ${callerText(list[0])}`;
    const primary = primaryCaller(list);
    const ordered = [...list.filter(c => c === primary), ...list.filter(c => c !== primary)];
    return `Callers: ${ordered.map(c => callerText(c) + (c === primary ? ' (primary)' : '')).join('; ')}`;
}

// The <contact> for an incident marker: callsign always, phone only when there is a dialable one.
// Always send it. CloudTAK merges an updated marker key by key and cannot remove one, so leaving
// `contact` out would keep the old phone on the marker after the phone is cleared or Caller
// Details is turned off. A contact without a phone replaces the old one.
export function markerContact(callsign: string, rawPhone: string | null | undefined): { callsign: string; phone?: string } {
    const dial = dialablePhone(rawPhone);
    return dial ? { callsign, phone: dial } : { callsign };
}

// The <contact> for a marker built from a caller list: the PRIMARY caller's phone (a CoT contact
// holds one phone). Same always-send rule as markerContact.
export function markerContactFor(callsign: string, callers?: MarkerCaller[] | null): { callsign: string; phone?: string } {
    return markerContact(callsign, primaryCaller(callers)?.phone);
}
