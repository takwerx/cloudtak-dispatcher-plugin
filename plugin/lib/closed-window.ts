// How long a closed incident stays on field devices in broadcast mode (whole minutes).
// Shared per CloudTAK as dispatcher_settings key `closed_marker_minutes`; only a CloudTAK system
// admin can change it (the server refuses the write with a 403 for anyone else), every user reads
// it. No imports on purpose: plugin/test/closed-window.test.ts loads this file as it ships.
//
// Broadcast mode never deletes a Core Event. CloudTAK caps each CoT's stale time at the Event's
// `ended` and re-sends on its cycle, so devices drop the marker once `ended` passes. The window
// is applied when the incident is closed (and when an Event is archived or nuked); changing the
// setting later does not rewrite Core Events that are already closed.

export const CLOSED_MARKER_MINUTES_DEFAULT = 60;
export const CLOSED_MARKER_MINUTES_MIN = 0;
export const CLOSED_MARKER_MINUTES_MAX = 1440;   // one day

/** The choices the Manage dropdown offers (the server accepts any whole number in the range). */
export const CLOSED_MARKER_MINUTE_CHOICES: readonly number[] = [0, 5, 10, 15, 30, 60];

/** Archive / nuke, and a 0-minute window: end the Core Event a minute out so devices drop it within about a minute. */
export const WITHDRAW_MS = 60 * 1000;

// The window the board last read from the settings (IncidentListView / ManagePanel / EventsView
// refresh it); the default applies until then. Kept here rather than in the Vue store so
// field-delivery.ts needs nothing from Vue.
let current = CLOSED_MARKER_MINUTES_DEFAULT;

/** The current window in minutes. */
export function closedMarkerMinutes(): number {
    return current;
}

/** Remember the window for the next close / withdraw. A bad value falls back to the default. */
export function setClosedMarkerMinutes(minutes: unknown): number {
    current = isClosedMarkerMinutes(minutes) ? minutes : CLOSED_MARKER_MINUTES_DEFAULT;
    return current;
}

/** True for a value the setting may store: a whole number of minutes within the allowed range. */
export function isClosedMarkerMinutes(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value)
        && value >= CLOSED_MARKER_MINUTES_MIN && value <= CLOSED_MARKER_MINUTES_MAX;
}

// The window as the settings map describes it. A missing key, an older server without the key,
// or a bad value all give the default, so closing an incident never fails on this setting.
export function closedMarkerMinutesFrom(settings: Record<string, unknown> | null | undefined): number {
    const v = (settings ?? {}).closed_marker_minutes;
    return isClosedMarkerMinutes(v) ? v : CLOSED_MARKER_MINUTES_DEFAULT;
}

/**
 * The Core Event `ended` time (ms since epoch) for an incident closed at `closedAtMs`.
 * 0 minutes means "as soon as practical": a minute from now (CloudTAK enforces a 30-second
 * stale floor, so an `ended` in the past would be no quicker).
 */
export function closedMarkerEndMs(closedAtMs: number, minutes: number, nowMs = Date.now()): number {
    const m = isClosedMarkerMinutes(minutes) ? minutes : CLOSED_MARKER_MINUTES_DEFAULT;
    if (m === 0) return nowMs + WITHDRAW_MS;
    return closedAtMs + m * 60 * 1000;
}

/**
 * Archive / nuke guard: a closed incident already ending (or ended) by the withdraw time must not
 * be pushed back out, because moving `ended` later would put an expired marker back on devices.
 * True when the withdraw PATCH should be sent.
 */
export function shouldWithdraw(endingMs: number | null, nowMs = Date.now()): boolean {
    return endingMs === null || endingMs > nowMs + WITHDRAW_MS;
}
