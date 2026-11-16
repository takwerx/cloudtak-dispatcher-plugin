## How to export the data and close the event

Export the data from the event: one export holds every incident in it.

### Export the data

The export covers the whole event, not one incident. It lists every incident with its callers, units, notes and disposition.

1. With the event open, press **Report**, under the event’s name.
2. Check the **Reporting period**. It starts as the whole event.
3. Press the button for what you need (see the table).

| Button | What you get |
|---|---|
| **Print / Save as PDF** | A printable report. The print window opens. To keep a file, choose “Save as PDF” as the printer. |
| **CSV** | A spreadsheet with one line per incident. |
| **HTML** | The printable report as a file. Open it in any browser to read or print it. |
| **JSON** | A full data file. Save it if your admin asks for one. |

**CSV**, **HTML** and **JSON** save a file, usually to your Downloads folder. The file name starts with the incident prefix, such as FAIR-report.

**← Back**, at the top left of the report, takes you back to the incidents.

> [!TIP]
> - To export only part of the event, such as one shift, change **From** and **To**. **Reset to full event** puts them back.
> - **Popup blocked**? Allow pop-ups for CloudTAK, or press **HTML** and print that file.
> - **Report** on an event’s line in the **Events** list opens the same report. You can still export after you archive the event. After **Nuke**, nothing is left to export.

### Close an event

When the situation is over, archive the event.

1. Close every incident that is still open (see [Close an incident](70-close-reopen.md#close-an-incident)). The **Active** tab should show 0, and in Multi-Monitor Mode the **Unassigned** tab too.
2. Press **Switch**, under the event’s name. The **Events** list opens.
3. Press **Archive** on the event’s line. It works at once, without asking.

What **Archive** does:

- The event’s calls come off field units’ maps. With **Broadcast to channel** this takes about a minute.
- Every record stays. The event stays in the list, marked **Archived**. You can still open it and export its data.
- There is no button to undo it.

> [!CAUTION]
> **Do not use Nuke to close an event.** The red **Nuke** button deletes the event and every incident in it, for good. It asks you to confirm, and then it can’t be undone. If you are ever told to delete an event, export its data first (see [Export the data](#export-the-data)).
