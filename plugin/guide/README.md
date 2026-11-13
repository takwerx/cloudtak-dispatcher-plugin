# Dispatcher User Guide

A plain-language, text-only guide for dispatchers and call takers. In CloudTAK it opens from **User Guide**
at the bottom of the Dispatcher's **Events** list, in its own panel over the map. It ships inside the plugin,
so it works without internet and matches the installed version.

## Contents

1. [What the Dispatcher is for](10-what.md)
2. [How to open the Dispatcher](20-open.md)
3. [Your own settings](30-your-settings.md)
4. [How to open or create an event](40-events.md)
5. [How to create an incident](50-create-incident.md)
6. [How to work the call](60-work-the-call.md)
7. [How to close and reopen an incident](70-close-reopen.md)
8. [How to type commands instead of clicking](80-command-line.md)
9. [How to work several calls at once](83-several-calls.md)
10. [How to use a second monitor](86-second-monitor.md)
11. [How to export the data and close the event](90-reports.md)
12. [How to set up the Dispatcher (for admins)](95-admin-setup.md)

## Adding to the guide

A change that adds or changes something a dispatcher sees also adds or updates its part of this guide.

- **One file per section**, named `NN-short-name.md`. The panel shows the files in number order and picks up a
  new one by itself. The numbers go up in tens, so a new section fits between two others (`35-…` between
  `30-…` and `40-…`). Add the new file to the contents list above.
- **The file starts with `## Title`.** Use `###` for its parts and `####` below that. The panel's contents
  list shows every `##` and `###`, so name each part after the task ("Close an incident"). Headings are link
  targets, so each one must be unique in the whole guide.
- **Write for a dispatcher under stress:** short sentences, "you", one action per numbered step, button and
  box names in bold exactly as they read on screen. No technical words; where the screen uses one, say in a
  few plain words what it means.
- **Text only, no screenshots.** Pictures go out of date with every screen change. Say in words where each
  button is: "at the top right", "at the bottom of the incident", "next to **Callers**". Examples use made-up
  data only (COUNTY FAIR, FAIR-001).
- **Check:** `node --test plugin/test/guide.test.ts` reads every file and fails on a missing title, a
  repeated heading, a link that goes nowhere, a picture, or a file missing from the contents list.

The panel reads this much Markdown, so the files look the same here on GitHub:

| Write | To get |
|---|---|
| `## Title`, `### Part`, `#### Smaller part` | The section title and its headings |
| A blank line between paragraphs | Paragraphs |
| `1. Press **Save**.` | Numbered steps (no list inside a list) |
| `- Text` | Bullets |
| `**Save**` | A button or box name |
| `` `2026-FAIR` `` | Text to type |
| `[Close an event](90-reports.md#close-an-event)` or `[Set the location](#set-the-location)` | A link to another part of the guide |
| `> [!TIP]` (or `NOTE`, `IMPORTANT`, `WARNING`, `CAUTION`) on its own line, then `> Text` lines | A tip, note or warning box |
| A table with a `---` line under its header row | A table |
| `<!-- Note to editors -->` | Nothing: a note for whoever edits the file |
