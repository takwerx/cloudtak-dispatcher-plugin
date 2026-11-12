# Changelog

## 1.6.1

- **One unit, one incident.** A unit that is Assigned or On Scene on an open incident can no longer be put on a
  second incident in the same Event. It shows greyed in the assign search and the contacts picker, with the
  incident it is on (`E12 · on 014`). Clear it there first. If two dispatchers pick the same unit at the same
  moment, the second one is told and nothing is assigned. A unit that already cleared can go back to the same
  incident for a second trip: the first trip keeps its times. Units already on two incidents before this update
  stay as they are; only new assignments are checked.
- **Address search with no internet.** When the CloudTAK server cannot reach the address service, the New
  Incident form stays open with what you typed, and one line under the address box says address search isn't
  available. Drop a pin and type the address.
- **You are told when a marker, feed log or chat did not go out.** After **Create Incident**, if one of them
  failed, the incident list shows a note ("was created, but: ...") with a dismiss button. Before, the
  message was lost when the list opened.
- **New incident windows open beside a popped-out Dispatcher** (Single Monitor Mode), not on top of it.
- **Lists are saved the proper way in the database.** Units, notes, callers and settings were stored as text
  that looks like a list. They are now stored as real lists, and old rows are fixed once when the server starts.
  Nothing changes on screen. Going back to an older version still works. (Contributed by Sentinel6Systems.)
- Wording: the Settings and README text now say **Event report** and **trash can**, as the buttons are called.
- Build-time update of `vue`. It is not part of what runs in CloudTAK.
- Cleaner build output in CloudTAK (no behaviour change).

## 1.6.0

- **Multi-Monitor Mode and Undock** (contributed by Sentinel6Systems). Open an incident in its own window with
  the new window button; the panel goes back to the list. The window is the full incident (callers, notes,
  units, close and reopen). **Close all** clears every undocked window. In **Dispatcher Settings → Display Mode**
  each computer picks Single or Multi-Monitor. The default is Single, so nothing moves unless a desk opts in.
- **Workspace for a second monitor.** In Multi-Monitor Mode the **Pop out** button becomes **Workspace**: one
  window to drag onto another monitor, with the Dispatcher pinned on its right and undocked incidents sharing
  the rest. Crowded spots share space with tabs. The map stays on the first monitor.
- **Unassigned / Active / Closed tabs** in Multi-Monitor Mode, so calls with no unit on them stand apart from
  the ones being worked. Single Monitor Mode keeps Active and Closed.
- **Shorter list and a clearer header.** The list shows number, time, type, address and units. The header has
  labelled **Settings** and **Pop out** buttons, callsign and **Sign out** on one line, **Switch event**, and
  **Event report** opens the report directly.
- **Reload keeps the Dispatcher open.** After you reload the page, the Dispatcher comes back instead of
  dropping you on the map, until you close it. If you switched TAK-CAD off, it stays off after a reload.
- Build-time security fix: updated `minimatch` (Dependabot alert 28). It is not part of what runs in CloudTAK.

## 1.5.1

- **install.sh no longer drops other CloudTAK plugins.** On a box with more than one web plugin (TAK Sim, LiveWX Radar),
  the build-context file install.sh wrote kept only the Dispatcher, so the others were on disk but missing from the
  rebuilt image and their menu items disappeared. It now keeps every installed plugin folder in the build, and
  leaves a `Dockerfile.dockerignore` written by infra-TAK alone.

## 1.5.0

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
- **Broadcast mode: how long a closed incident stays on field devices.** The CloudTAK admin can pick 0, 5, 10,
  15, 30 or 60 minutes in **Dispatcher Settings** (default 60, same as before; 0 drops it within about a
  minute). It applies when an incident is closed. Other accounts see the setting but can't change it.

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
