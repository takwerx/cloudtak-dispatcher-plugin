// The operator: the employee number of the person at this terminal. Optional, OFF by default: a CloudTAK
// system admin turns it on in Dispatcher Settings → Employee Numbers (setting `operator_numbers`). Off, none of this
// shows and the Dispatcher works as before. On, for desks that share one CloudTAK login (the login says
// which desk, not who): the operator types their number once (the header asks), and every write carries
// it as `operator`. The server records it as who created the incident, who took each call (`taken_by` on
// the caller), the initial dispatcher (first unit assignment), who closed it, and on every note
// (server/plugin-dispatcher.ts, <operator-pure>). The `dispatcher` field (the CloudTAK callsign) is unchanged either way.
//
// Kept in sessionStorage: it lasts for this browser tab (reloads and the floating pane included) and
// is gone when the tab or browser closes, so the next shift is asked again instead of inheriting it.
// No storage (private mode) just means it is asked again after a reload.
const OPERATOR_KEY = 'tak-dispatcher-operator-v1';
export const OPERATOR_MAX = 16;
export const OPERATOR_SETTING = 'operator_numbers';

// The admin switch as the settings map describes it: only true turns it on.
export function operatorNumbersFrom(settings: Record<string, unknown> | null | undefined): boolean {
    return (settings ?? {})[OPERATOR_SETTING] === true;
}

// What the operator typed, as a valid employee number (digits only, trimmed), or null.
export function parseOperator(v: string | null | undefined): string | null {
    const t = String(v ?? '').trim();
    return t.length > 0 && t.length <= OPERATOR_MAX && /^[0-9]+$/.test(t) ? t : null;
}

export function loadOperator(): string | null {
    try {
        return parseOperator(sessionStorage.getItem(OPERATOR_KEY));
    } catch {
        return null;
    }
}

export function saveOperator(id: string | null): void {
    try {
        if (id) sessionStorage.setItem(OPERATOR_KEY, id);
        else sessionStorage.removeItem(OPERATOR_KEY);
    } catch {
        // ignore storage failures (private mode / quota)
    }
}
