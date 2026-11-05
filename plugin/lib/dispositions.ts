import type { DispatcherIncident } from './events-client.ts';

// How a standalone incident ended. The dispatcher picks one of these when pressing Close Incident;
// "Other" takes a few words of free text. Edit this list to change the chooser: the server stores
// whatever text it is sent (trimmed, capped), so no server change is needed. Pure: no CloudTAK
// imports, so plugin/test/disposition-report.test.ts runs this file as it ships.

export const DISPOSITIONS: readonly string[] = [
    'Cleared - No Report',
    'Report',
    'Unfounded',
    'Warning',
    'Gone on Arrival',
    'Canceled',
];

// The free-text choice. Stored as `disposition: 'Other'` with the text in `disposition_note`.
export const DISPOSITION_OTHER = 'Other';

// Same caps as the server (DISPOSITION_MAX / DISPOSITION_NOTE_MAX in server/plugin-dispatcher.ts).
export const DISPOSITION_MAX = 40;
export const DISPOSITION_NOTE_MAX = 80;
// Reopening a closed incident asks why; the server requires it and writes "Reopened: <reason>".
export const REOPEN_REASON_MAX = 120;

// "Unfounded", or "Other — lost contact with caller". Empty string when the incident has none.
export function dispositionLabel(i: Pick<DispatcherIncident, 'disposition' | 'disposition_note'>): string {
    if (!i.disposition) return '';
    return i.disposition_note ? `${i.disposition} — ${i.disposition_note}` : i.disposition;
}
