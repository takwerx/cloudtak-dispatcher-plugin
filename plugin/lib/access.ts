// Who may use the Dispatcher. A CloudTAK system admin can limit it to chosen TAK groups in Dispatcher
// Settings → Who Can Use The Dispatcher (setting `allowed_groups`, a list of TAK group names). An empty
// list is off: everyone signed in gets the Dispatcher. The server is the gate (every route refuses a user
// outside the list with a 403, server/plugin-dispatcher.ts <access-gate>); this file only decides what the
// browser shows. No imports, so plugin/test/access-server.test.ts loads it as it ships.
export const ALLOWED_GROUPS_SETTING = 'allowed_groups';
export const ALLOWED_GROUPS_MAX = 100;
export const ALLOWED_GROUP_NAME_MAX = 200;

// What GET /api/dispatcher/access says about the signed-in user.
export interface DispatcherAccess {
    allowed: boolean;   // may use the Dispatcher
    limited: boolean;   // the admin's list is on
    admin: boolean;     // a CloudTAK system admin (always allowed)
}

// Show the menu item unless the server clearly said no. An answer we cannot read (an older server without
// the route, a network error, nothing) keeps the menu: the server still refuses the calls that matter.
export function menuAllowed(access: unknown): boolean {
    if (!access || typeof access !== 'object') return true;
    return (access as { allowed?: unknown }).allowed !== false;
}

// The admin's list as the settings map describes it: text names only, trimmed, no blanks, no repeats
// (ignoring case). Anything that is not a list of names reads as none.
export function allowedGroupsFrom(settings: Record<string, unknown> | null | undefined): string[] {
    const raw = (settings ?? {})[ALLOWED_GROUPS_SETTING];
    return Array.isArray(raw) ? cleanGroupNames(raw) : [];
}

export function cleanGroupNames(list: unknown[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of list) {
        if (typeof item !== 'string') continue;
        const name = item.trim();
        if (!name || name.length > ALLOWED_GROUP_NAME_MAX) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

// The list with `name` added, or null when there is nothing to add (blank, already there, too long, list full).
export function withGroup(list: string[], name: string): string[] | null {
    const t = name.trim();
    if (!t || t.length > ALLOWED_GROUP_NAME_MAX || list.length >= ALLOWED_GROUPS_MAX) return null;
    if (list.some(g => g.toLowerCase() === t.toLowerCase())) return null;
    return [...list, t];
}

export function withoutGroup(list: string[], name: string): string[] {
    return list.filter(g => g !== name);
}
