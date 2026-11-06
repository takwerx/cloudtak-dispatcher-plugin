// Watch an element's size from the window it lives in (the Multi-Monitor workspace is a window of its own),
// and react on that window's next frame. Reacting at once can resize something else that is watched in the
// same frame, which the browser reports as "ResizeObserver loop completed with undelivered notifications";
// an observer made in the CloudTAK tab reports that to the CloudTAK tab, which shows it as a Website Error.
// CloudTAK's own floating panes defer the same way.
export function watchSize(el: HTMLElement, onResize: () => void): () => void {
    const win = el.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    if (!win || typeof win.ResizeObserver === 'undefined') return () => {};
    let frame = 0;
    const observer = new win.ResizeObserver(() => {
        if (frame) return;
        frame = win.requestAnimationFrame(() => {
            frame = 0;
            onResize();
        });
    });
    observer.observe(el);
    return () => {
        observer.disconnect();
        if (frame) win.cancelAnimationFrame(frame);
    };
}
