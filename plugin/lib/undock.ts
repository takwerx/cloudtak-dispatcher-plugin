// Undocked incident cards: pure bookkeeping, no imports so `node --test` can load it as it ships.
// An undocked incident is one the dispatcher pulled out of the menu panel into its own floating
// card over the map, so several incidents can be worked at once. The set of open cards is a
// plain ordered list of incident ids; the float panes themselves are CloudTAK's (undock-panes.ts).

export const UNDOCK_CARD_WIDTH  = 420;
export const UNDOCK_CARD_HEIGHT = 600;

// Multi-Monitor Mode workspace: the Dispatcher panel is pinned to the right edge at this width; incident
// cards tile in the area to its left.
export const WORKSPACE_PANEL_WIDTH = 440;
// Multi-Monitor workspace layout: the cards share the workspace. One card fills it, two split it in half,
// three in thirds, and so on, until a card would be smaller than an incident's default size. Past that,
// the extra cards share a spot with one already there, full size, one in front: the cards in a shared
// spot are listed as tabs along its top, and a tab brings that card to the front (WorkspaceCard.vue).
// A wide workspace is split side by side, the first card beside the Dispatcher panel on the right; a tall
// one (a monitor turned on its side) is split one above the other, the first at the top. Cards touch, with
// no margins: their borders separate them. A card the dispatcher moves or resizes leaves the layout.
export const WORKSPACE_MIN_CARD_WIDTH  = UNDOCK_CARD_WIDTH;
export const WORKSPACE_MIN_CARD_HEIGHT = UNDOCK_CARD_HEIGHT;

/** True when the workspace is split one above the other (taller than wide). */
export function workspaceIsTall(area: { width: number; height: number }): boolean {
    return area.height > area.width;
}

/** How many spots the workspace has before a card would be smaller than the default incident size. */
export function workspaceTileCount(area: { width: number; height: number }): number {
    const fit = workspaceIsTall(area)
        ? area.height / WORKSPACE_MIN_CARD_HEIGHT
        : area.width / WORKSPACE_MIN_CARD_WIDTH;
    return Math.max(1, Math.floor(fit));
}

/** Which spot card `index` (0 = the first undocked) of `count` cards in the layout is in. */
export function workspaceSpotOf(index: number, count: number, area: { width: number; height: number }): number {
    const n = Math.max(1, Math.floor(count));
    const i = Math.min(Math.max(0, Math.floor(index)), n - 1);
    return i % Math.min(n, workspaceTileCount(area));
}

/** Where card `index` of `count` cards in the layout sits: the whole of its spot. */
export function workspaceTileRect(
    index: number,
    count: number,
    area: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
    const W = Math.max(0, area.width);
    const H = Math.max(0, area.height);
    const tiles = Math.min(Math.max(1, Math.floor(count)), workspaceTileCount(area));
    const t = workspaceSpotOf(index, count, area);
    if (workspaceIsTall(area)) {
        const y = Math.round(t * H / tiles);
        return { x: 0, y, w: W, h: Math.round((t + 1) * H / tiles) - y };
    }
    const x = W - Math.round((t + 1) * W / tiles);
    return { x, y: 0, w: W - Math.round(t * W / tiles) - x, h: H };
}

// Keep a dragged card reachable: its title bar stays inside the workspace area, so it can always be
// grabbed again (at least `grab` px of it stays visible horizontally; the top edge never goes above 0).
export function clampCard(
    x: number,
    y: number,
    area: { width: number; height: number },
    card: { width: number },
    grab = 80,
): { x: number; y: number } {
    const maxX = Math.max(0, area.width - grab);
    const minX = Math.min(0, grab - card.width);
    const maxY = Math.max(0, area.height - 40);
    return {
        x: Math.round(Math.min(Math.max(x, minX), maxX)),
        y: Math.round(Math.min(Math.max(y, 0), maxY)),
    };
}

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
// the dispatcher dragged away no longer holds its slot. `keepClear` are panes a new card must not cover
// at all (the popped-out Dispatcher, which opens where the first card would): every slot whose card
// would overlap one is skipped, unless none is clear of them, and then they are ignored. Falls back to
// slot `taken.length` when every slot in a full cycle is occupied.
export function firstFreeSlot(
    taken: readonly { x: number; y: number }[],
    base: { x: number; y: number },
    viewport: { width: number; height: number },
    card: { width: number; height: number } = { width: UNDOCK_CARD_WIDTH, height: UNDOCK_CARD_HEIGHT },
    keepClear: readonly { x: number; y: number; width: number; height: number }[] = [],
): { x: number; y: number } {
    const isTaken = (p: { x: number; y: number }) => taken.some(t => t.x === p.x && t.y === p.y);
    const covers = (p: { x: number; y: number }) => keepClear.some(k =>
        p.x < k.x + k.width && k.x < p.x + card.width && p.y < k.y + k.height && k.y < p.y + card.height);
    const cycle = Math.max(1, taken.length + 1);
    for (let n = 0; n < Math.max(cycle, 64); n++) {
        const p = cardPosition(n, base, viewport, card);
        if (!isTaken(p) && !covers(p)) return p;
    }
    if (keepClear.length) return firstFreeSlot(taken, base, viewport, card);
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

// Unsaved input carried from the panel into an incident's new window (a half-typed note, an open caller form,
// a close or reopen in progress). Keys as IncidentDetail writes them.
export type Draft = Record<string, unknown>;

/** An incident window's title: number and type ("Incident" while the incident is not on the board). */
export function incidentTitle(inc: { number: string; type?: string | null } | null | undefined): string {
    return inc ? `${inc.number} ${inc.type ?? ''}`.trim() : 'Incident';
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
