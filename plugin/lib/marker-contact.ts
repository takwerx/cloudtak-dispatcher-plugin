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

// "Caller: <name> · <phone>", leaving out whichever is blank; '' when both are.
export function callerRemark(name?: string | null, phone?: string | null): string {
    const bits = [String(name ?? '').trim(), String(phone ?? '').trim()].filter(Boolean);
    return bits.length ? `Caller: ${bits.join(' · ')}` : '';
}

// The <contact> for an incident marker: callsign always, phone only when there is a dialable one.
// Always send it. CloudTAK merges an updated marker key by key and cannot remove one, so leaving
// `contact` out would keep the old phone on the marker after the phone is cleared or Caller
// Details is turned off. A contact without a phone replaces the old one.
export function markerContact(callsign: string, rawPhone: string | null | undefined): { callsign: string; phone?: string } {
    const dial = dialablePhone(rawPhone);
    return dial ? { callsign, phone: dial } : { callsign };
}
