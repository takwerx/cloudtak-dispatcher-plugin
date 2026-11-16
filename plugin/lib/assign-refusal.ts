// The server's "unit is busy" refusal on an assignment (one incident per unit). Pure, so
// plugin/test/assign-refusal.test.ts runs it with plain node.

// How long the refusal message stays under the incident; the greyed unit keeps saying where it is.
export const ASSIGN_REFUSAL_MS = 10_000;

// True for the 409 the server sends when a unit is still working another incident. CloudTAK's std()
// throws an Error carrying the response body ({ status, message }) as `body`. Any other failure
// (network, timeout, a closed incident) is not this, and its message stays until the next action.
export function isBusyRefusal(e: unknown): boolean {
    const body = (e as { body?: unknown } | null)?.body;
    return !!body && typeof body === 'object' && (body as { status?: unknown }).status === 409;
}

// A message that clears itself after `ms`, unless something else has replaced it by then.
export function makeFlash(read: () => string, write: (text: string) => void, ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
        show(text: string) {
            write(text);
            clearTimeout(timer);
            timer = setTimeout(() => { if (read() === text) write(''); }, ms);
        },
        stop() { clearTimeout(timer); },
    };
}
