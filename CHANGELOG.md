# Changelog

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
