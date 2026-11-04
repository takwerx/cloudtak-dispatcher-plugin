// Undocked incident cards: pure bookkeeping, no imports so `node --test` can load it as it ships.
// An undocked incident is one the dispatcher pulled out of the menu panel into its own floating
// card over the map, so several incidents can be worked at once. The set of open cards is a
// plain ordered list of incident ids; the float panes themselves are CloudTAK's (undock-panes.ts).

export const UNDOCK_CARD_WIDTH  = 420;
export const UNDOCK_CARD_HEIGHT = 600;

// Gap between cards tiled side by side, and the cascade step once a row is full, so a new card
// never lands exactly on the previous one.
export const UNDOCK_TILE_GAP     = 8;
export const UNDOCK_CASCADE_STEP = 32;

// Where a new card opens, left of CloudTAK's menu panel. `base` is the top-left of the first card,
// `openCount` the number of cards already open. Cards tile left to right while a whole card fits
// before the panel (the point is seeing several at once); when the row is full the next row starts
// one cascade step down and right of the base, and rows wrap back to the top before a card would
// leave the bottom of the viewport, so the Nth card is always on screen.
export function cardPosition(
    openCount: number,
    base: { x: number; y: number },
    viewport: { width: number; height: number },
    card: { width: number; height: number } = { width: UNDOCK_CARD_WIDTH, height: UNDOCK_CARD_HEIGHT },
    step = UNDOCK_CASCADE_STEP,
    gap = UNDOCK_TILE_GAP,
): { x: number; y: number } {
    const n = Math.max(0, Math.floor(openCount));
    const perRow  = Math.max(1, Math.floor((viewport.width - base.x + gap) / (card.width + gap)));
    const rows    = Math.max(1, Math.floor((viewport.height - base.y - card.height) / step) + 1);
    const col = n % perRow;
    const row = Math.floor(n / perRow) % rows;
    return { x: base.x + col * (card.width + gap) + row * step, y: base.y + row * step };
}

// The first cascade slot no open card sits on, so a new card never lands exactly on top of an open
// one (closing an earlier card frees its slot). `taken` are the open cards' top-left corners; a card
// the dispatcher dragged away no longer holds its slot. Falls back to slot `taken.length` when every
// slot in a full cycle is occupied.
export function firstFreeSlot(
    taken: readonly { x: number; y: number }[],
    base: { x: number; y: number },
    viewport: { width: number; height: number },
    card: { width: number; height: number } = { width: UNDOCK_CARD_WIDTH, height: UNDOCK_CARD_HEIGHT },
): { x: number; y: number } {
    const isTaken = (p: { x: number; y: number }) => taken.some(t => t.x === p.x && t.y === p.y);
    const cycle = Math.max(1, taken.length + 1);
    for (let n = 0; n < Math.max(cycle, 64); n++) {
        const p = cardPosition(n, base, viewport, card);
        if (!isTaken(p)) return p;
    }
    return cardPosition(taken.length, base, viewport, card);
}

// Add an id to the open set (no duplicates; order = opening order).
export function addUndocked(open: readonly string[], id: string): string[] {
    return open.includes(id) ? [...open] : [...open, id];
}

export function removeUndocked(open: readonly string[], id: string): string[] {
    return open.filter(x => x !== id);
}

export function isUndocked(open: readonly string[], id: string): boolean {
    return open.includes(id);
}

// Cards to reopen after a reload: only ids that still exist on the board, in saved order.
export function restorable(saved: readonly string[], existingIds: readonly string[]): string[] {
    const have = new Set(existingIds);
    return saved.filter((id, i) => have.has(id) && saved.indexOf(id) === i);
}

// localStorage key, one list per Event so cards from one outage never reappear in another.
export function undockStorageKey(eventId: string): string {
    return `tak-dispatcher-undocked-v1:${eventId}`;
}

export function parseSavedUndocked(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const v: unknown = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}
