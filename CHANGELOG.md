# Changelog

## Next release

- **Employee numbers (optional, off by default).** The CloudTAK admin can turn on **Employee Numbers** in the
  new **Dispatcher Settings** screen (the gear, open even with no Event). Each dispatcher then signs in with
  their number; it is stamped on incidents, notes, who took the call and who closed it, and shown in the
  report. Field devices never receive it. With the switch off nothing changes.
- **Reopen asks for a reason (only with Employee Numbers on).** The reason is written to the incident notes
  as "Reopened: <reason>". With the switch off, Reopen is one click, as before.
- **Dispatcher Settings.** The CJIS reminder and other shared settings moved here from Manage.
- **CSV export, only when Employee Numbers is on:** three columns (`created_by_no`, `initial_dispatcher_no`,
  `closed_by_no`) are added after `dispatcher`, so every column after it moves three to the right. A script
  that reads the CSV by column position needs updating; with the switch off the columns are unchanged.

## 1.4.0

- **Several callers on one incident.** Each incident keeps a list of callers with the time of each call. The
  New Incident form records the first one; add, edit or remove callers later, and pick the primary caller.
- **Caller name and callback phone reach the field.** Every caller is listed in the incident marker, and the
  primary caller's number is dialable on field devices. **Manage → Caller Details** turns this off for the
  whole CloudTAK. Callers are in the report and CSV.
- **Send incidents to a channel, no DataSync needed.** When you create an Event, choose **Broadcast to
  channel**: every device in that channel gets the incidents, including devices that connect later.
- **Unit status.** Each unit on an incident goes **Assigned → On Scene → Cleared**, and the server stamps
  each time. The board shows who is on scene; the report and CSV list each unit's times.
- **Close reason.** Closing an incident asks how it ended (a preset or Other). It is shown on the closed
  incident, in the feed log, the report and the CSV.
- **CJIS reminder.** Every incident shows a one-line reminder not to enter CJIS information. Only the
  CloudTAK admin account can turn it off or change the wording, and only that account can change the
  custom call types.

Updating keeps every Event and incident you already have; incidents from earlier versions simply have no
callers, unit times or close reason.

## 1.3.0

- **Report Number on incidents.** Add an optional report number when you create an incident, or later.
  It shows on the card and in the CSV, JSON and HTML exports.

## 1.2.1

- **Dispatcher menu item back on CloudTAK 13.102+.** `install.sh` now puts the plugin where newer CloudTAK
  builds look for it.
