// CJIS reminder: a one-line notice at the top of every standalone incident (default on).
// Shared per CloudTAK via dispatcher_settings; only a CloudTAK system admin can change it
// (the server refuses the write with a 403 for anyone else), every user reads it.
import { std } from '../../../src/std.ts';

export const CJIS_REMINDER_DEFAULT_TEXT = 'Information derived from CJIS sources must not be entered into incident records.';
export const CJIS_REMINDER_TEXT_MAX = 300;

export interface CjisReminder {
    enabled: boolean;   // anything but false means on
    text: string;       // never blank: falls back to the default
}

// The reminder as the settings map describes it. Missing keys, an older server without the
// keys, or a blank text all give the default so the line can never be empty or silently off.
export function cjisReminderFrom(settings: Record<string, unknown> | null | undefined): CjisReminder {
    const s = settings ?? {};
    const raw = typeof s.cjis_reminder_text === 'string' ? s.cjis_reminder_text.trim() : '';
    return {
        enabled: s.cjis_reminder_enabled !== false,
        text: raw || CJIS_REMINDER_DEFAULT_TEXT,
    };
}

// Whether the signed-in user is a CloudTAK system admin (the account CloudTAK creates on first
// launch, or any user an admin promoted). Read from /api/profile, the same flag the server checks.
// Unknown (older CloudTAK, network error) counts as not admin: the controls stay locked and the
// server is the real gate either way.
export async function isSystemAdmin(): Promise<boolean> {
    try {
        const p = await std('/api/profile', { method: 'GET' }) as { system_admin?: unknown };
        return p?.system_admin === true;
    } catch {
        return false;
    }
}
