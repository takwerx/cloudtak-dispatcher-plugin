// Small rules for the Local Address Data sources list (#108, items 3 to 5): the Name box when a
// file is picked, renaming a source, and the short one-line view of each source. No imports, so the
// tests load it as it ships:  node --test plugin/test/*.test.ts

// The server's limit on a source name (Create and Update Address Source).
export const NAME_MAX = 120;

// A file's name without its extension: "Lane County.csv" -> "Lane County".
export function fileBaseName(fileName: string): string {
    const base = String(fileName ?? '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
    return base.slice(0, NAME_MAX);
}

// The Name box after a file is picked (or a web address is read). The box follows the picked file
// unless the admin typed a name of their own for this upload. After a load finishes the page sets
// `typed` back to false, so the next file picked gets its own name, not the last source's (#108,
// item 3). When replacing a file the name is the source's and never changes.
export function nameAfterPick(current: { name: string; typed: boolean; replacing: boolean }, suggested: string): string {
    if (current.replacing) return current.name;
    if (current.typed && current.name.trim()) return current.name;
    return suggested;
}

// Why a new name can't be saved, in plain words, or '' when it can (#108, item 4).
export function renameProblem(newName: string, currentName: string): string {
    const n = String(newName ?? '').trim();
    if (!n) return 'Type a name';
    if (n.length > NAME_MAX) return `A name can be at most ${NAME_MAX} characters`;
    if (n === currentName.trim()) return 'That is already its name';
    return '';
}

// A source can be renamed unless data is being loaded into it right now: the load holds the source
// until it finishes, so a rename would only wait.
export function canRename(s: { id: string; status: string }, refreshing: string[]): boolean {
    return s.status !== 'loading' && !refreshing.includes(s.id);
}

// The source list starts short when there are many sources (#108, item 5): one line each, details
// on a click, so Try it stays near the top.
export const COMPACT_FROM = 4;

export function startCompact(count: number): boolean {
    return count >= COMPACT_FROM;
}

// A source's details stay open in the short view when something needs the admin's eye: the last
// load failed or left a message.
export function needsAttention(s: { status: string; last_error: string | null }): boolean {
    return s.status === 'failed' || !!s.last_error;
}
