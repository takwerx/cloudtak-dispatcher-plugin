// Bring part of an incident into view by scrolling only the incident's own scroll box. The browser's
// scrollIntoView also scrolls every overflow:hidden box around it, which in CloudTAK can shift the whole
// map layout with no scrollbar to put it back. No imports on purpose: plugin/test/reveal.test.ts loads
// this file as it ships.

export type RevealBlock = 'nearest' | 'center';

/**
 * The scrollTop that shows `box` inside `view` (both in the same screen coordinates; view is the visible
 * part of the scroll box). nearest: scroll as little as possible, top first when the box is taller than
 * the view; center: put the box in the middle.
 */
export function revealScrollTop(
    view: { top: number; bottom: number; scrollTop: number },
    box: { top: number; bottom: number },
    block: RevealBlock = 'nearest',
): number {
    const viewH = view.bottom - view.top;
    const boxH = box.bottom - box.top;
    const alignTop = view.scrollTop + box.top - view.top;
    let next: number;
    if (boxH >= viewH) next = alignTop;
    else if (block === 'center') next = alignTop - (viewH - boxH) / 2;
    else if (box.top < view.top) next = alignTop;
    else if (box.bottom > view.bottom) next = view.scrollTop + box.bottom - view.bottom;
    else next = view.scrollTop;
    return Math.max(0, Math.round(next));
}

/** Scroll the nearest scrolling box around `el` (and nothing else) so `el` shows. */
export function revealInScrollBox(el: HTMLElement | null | undefined, block: RevealBlock = 'nearest'): void {
    if (!el) return;
    // The element may live in another window (the Multi-Monitor workspace): use that window's styles.
    const win = el.ownerDocument.defaultView;
    if (!win) return;
    let box = el.parentElement;
    while (box) {
        const oy = win.getComputedStyle(box).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight) break;
        box = box.parentElement;
    }
    if (!box) return;
    const v = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const top = v.top + box.clientTop;
    box.scrollTop = revealScrollTop({ top, bottom: top + box.clientHeight, scrollTop: box.scrollTop }, r, block);
}
