// Who Can Use Dispatcher (Dispatcher Settings, CloudTAK system admin only): the TAK groups whose members
// may use the Dispatcher on this CloudTAK. An empty list lets every signed-in user in, as before the
// list existed. With groups listed, only their members and CloudTAK system admins see the Dispatcher;
// the server refuses everyone else on every Dispatcher route (<access-pure> in server/plugin-dispatcher.ts).
// Pure, so plugin/test/group-access.test.ts runs this file as it ships.
export const ALLOWED_GROUPS_SETTING = 'allowed_groups';
export const ALLOWED_GROUPS_MAX = 200;
export const ALLOWED_GROUP_NAME_MAX = 128;

// The saved list, from what getDispatcherSettings() returns. Anything else reads as empty.
export function allowedGroupsFrom(settings: Record<string, unknown> | null | undefined): string[] {
    const v = settings?.[ALLOWED_GROUPS_SETTING];
    if (!Array.isArray(v)) return [];
    return v.filter((g): g is string => typeof g === 'string').map(g => g.trim()).filter(Boolean);
}

// The list with one more group, or what is wrong with the typed name. Names match without regard to case,
// the same way the server matches them.
export function addAllowedGroup(list: string[], typed: string): { list: string[] } | { problem: string } {
    const name = typed.trim();
    if (!name) return { problem: 'Type or pick a group name.' };
    if (name.length > ALLOWED_GROUP_NAME_MAX) return { problem: `A group name is at most ${ALLOWED_GROUP_NAME_MAX} characters.` };
    if (list.some(g => g.toLowerCase() === name.toLowerCase())) return { problem: `${name} is already in the list.` };
    if (list.length >= ALLOWED_GROUPS_MAX) return { problem: `At most ${ALLOWED_GROUPS_MAX} groups.` };
    return { list: [...list, name] };
}

// Whether a typed name is one of the groups the admin is in (the picker's list). A name that is not asks
// for a second Add: a misspelled name matches no one, so a list of only that name lets no one in.
export function isKnownGroup(mine: string[], typed: string): boolean {
    const name = typed.trim().toLowerCase();
    return mine.some(g => g.toLowerCase() === name);
}
