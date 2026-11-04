# CloudTAK Dispatcher Plugin

A dispatcher plugin for [CloudTAK](https://github.com/dfpc-coe/CloudTAK) — create and manage
incidents on the map, organize them under named **Events**, assign responders, and notify them
via mission chat and direct GeoChat.

**Current version: 1.5.0.** What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Modes

The plugin auto-detects its environment on load:

- **Standalone** (no external dependency) — Events and Incidents are stored server-side in
  CloudTAK's own database and shared live across every dispatcher on that CloudTAK. An **Event**
  (e.g. `2025-FESTIVAL`) is tied 1:1 to a DataSync feed and holds many Incidents. Incidents
  persist through close (and can be reopened); they are removed only when the Event is nuked.
- **TAK-CAD** — if the TAK-CAD TAK Server plugin is detected, the full CAD UI (Vehicles,
  Personnel, incident types/roles) lights up on top of the standalone capabilities.

Standalone incidents keep a list of **callers** (name, phone, optional note, time of call). The New
Incident form records the first caller; add more, edit them, or pick the **primary** caller from the
incident at any time, active or closed. Every caller is listed in the incident marker's remarks, and a
dialable copy of the primary caller's number goes in the marker's `<contact phone>` so field clients can
offer a call. **Dispatcher Settings → Caller Details** turns that off for the whole CloudTAK (default on): with it off,
no caller name, phone or note reaches a field device. Every caller is included in the after-action report
and CSV. A database from the earlier single-caller version moves its caller into the list on start.

### Unit status (standalone)

Each unit on an incident is **Assigned**, then **On Scene**, then **Cleared**. The dispatcher presses the
button (**On Scene**, **Clear**) when the unit radios in, and the server stamps the time, so nothing comes
from the field. A cleared unit stays on the incident, greyed, with its three times; the **✕** is for a unit
assigned by mistake and removes it from the record. The board shows **Unassigned**, **Dispatched** or
**On Scene** next to each active incident. Closing an incident clears every unit still on it with the close
time. The marker remarks read `Responding: E12 (on scene), M4` (cleared units drop off), the feed log gets
`ON SCENE:` and `CLEARED:` lines, every change is a note on the incident, and the report and CSV list each unit
with its times plus the incident's first on-scene time. Units assigned before this version show as Assigned
with no times.

### Disposition on close (standalone)

Closing an incident asks for a **disposition**, how the call ended: pick a preset (**Cleared - No Report**,
**Report**, **Unfounded**, **Warning**, **Gone on Arrival**, **Canceled**) or **Other** and type it in the box
beside it, then press **Close Incident**. The list is `plugin/lib/dispositions.ts`; the server stores the text
it is sent, so changing the list needs no server change. The disposition is written as a `Closed: …` note,
shown on the closed incident's card and detail, in the report and CSV, and on the `INCIDENT CLOSED` feed-log
line. With Employee Numbers on, **Reopen** asks for a reason (required, 120 characters) and writes it as a
`Reopened: …` note with the employee number; the feed log's `INCIDENT REOPENED:` line ends with it. With it
off, Reopen works as before: no reason asked, none written.
Reopening clears the disposition (the `Closed:` note stays); closing again asks again. There is no editing
it in place.

### CJIS reminder (standalone)

Every standalone incident opens with a one-line **CJIS reminder** ("Information derived from CJIS sources
must not be entered into incident records.", default on). **Dispatcher Settings → CJIS Reminder** turns it off or changes
the wording for the whole CloudTAK; only the CloudTAK system admin account (the one CloudTAK creates on
first launch) can change it, and the server refuses the change for anyone else. **Dispatcher Settings → Custom Call
Types** is locked to the same admin account.

### Dispatcher Settings and Manage (standalone)

Settings shared by every event and every dispatcher on the CloudTAK are under **Dispatcher Settings**, the
gear in the Dispatcher's top bar, which opens with or without an event: the report header, caller details
on markers, the CJIS reminder, employee numbers and custom call types. The gear on an open event is
**Manage**, for that event only: its after-action report.

### Employee numbers: who took, dispatched and closed each call (standalone, optional)

Off by default; with it off the Dispatcher works exactly as before. For desks that share one CloudTAK
login, the CloudTAK system admin can turn on **Dispatcher Settings → Employee Numbers**. Then a yellow bar
under the Dispatcher's header reads **Sign in with your employee number** (digits only; type it and press
**Sign in** or Enter). Nothing is blocked while no one is signed in. Once signed in, that line shows
`Employee #<number>`, the CloudTAK callsign, and **Sign out**; at shift change one person signs out and
the next signs in. It is not a password login: it records who did what. It lasts until the browser tab
closes; a reload keeps it. On the New Incident form the **Taken by #** box follows whoever is signed in
(unless a different number was typed into it), and is outlined in yellow when empty. The number is saved:

- on each caller as **Taken by #**, when the caller is added (the New Incident form's **Taken by #** box is
  pre-filled from the header and can be changed when taking a call for someone else);
- as the incident's **Initial Dispatcher #** when the first unit is assigned (later assignments do not
  change it);
- as **Closed by #** when it is closed (reopening clears it; the `Closed: …` note keeps each closer);
- after every note (`E12 assigned · <number>`);
- as who **created** the incident, shown on the report and in the CSV only.

The detail, the printed report and the CSV (`created_by_no`, `initial_dispatcher_no`, `closed_by_no`,
Taken by in the callers column, note authors) show them. The **Dispatcher** field and the field units'
marker keep the CloudTAK callsign either way. With no number entered nothing is blocked; the numbers
stay empty.

### Undocked incidents (standalone)

The Dispatcher panel shows one incident at a time. Press **Undock** (the window icon next to **Back**
on an incident) and that incident opens in its own window over the map; the panel goes back to the list,
so several incidents can be open and worked at once. Each window is the same incident view with everything
in it (callers, notes, units, close, reopen), draggable by its grip and resizable. New windows open side
by side while they fit left of the panel, then step down and right. **✕** closes the window; the incident stays on the board, and
clicking its row opens it in the panel again. The list marks undocked incidents and shows how many are out, with **Close all**. The
windows stay live while the panel is on another incident, the list, or closed, and edits made in a window
go through the same server calls as the panel. They close when the Event is closed. After a page reload (per
browser) they come back when the Dispatcher is opened on that Event again. **Close all** and **✕** are
remembered, so closed windows stay closed.

### Delivery to field units (standalone)

Each Event chooses how its incidents reach field devices when it is created:

- **DataSync feed** (default) — each incident is a marker in the Event's DataSync feed. Field
  users subscribe to the feed to see it, and can use the feed's log and chat.
- **Broadcast to channel** — each incident is a CloudTAK **Core Event** shared with one channel.
  The CloudTAK server sends it to everyone in that channel and re-sends it every 10 seconds, so
  it appears on every device in the channel with nothing to subscribe to, including devices that
  connect later. It is one way (field users can't edit it), and a closed incident is marked
  `CLOSED` and goes stale on devices after a set time: **Dispatcher Settings → Broadcast Mode Incident Closed
  Marker Retention** offers 0, 5, 10, 15, 30 or 60 minutes (default 60; 0 drops the marker within
  about a minute). Only the CloudTAK system admin account can change it. The time is applied when
  an incident is closed, so changing it does not move incidents that are already closed. TAK clients
  drop the marker at that time; the CloudTAK web map first greys it out and removes it per the
  user's own **Settings → Display → Remove Stale Elements** (Immediate, 10 Minutes, 30 Minutes,
  1 Hour or Never). Needs a CloudTAK with Core Events and
  its Admin Connection connected. The incidents also appear in CloudTAK's own Core Events list.

## Layout

- `plugin/` — the CloudTAK web plugin (Vue 3 / TypeScript), discovered and bundled by CloudTAK's
  Vite build from the web app's `plugins/` dir (`app/plugins/` on CloudTAK >= 13.102.0, `api/web/plugins/` before).
- `server/` — CloudTAK API route files copied into CloudTAK's `api/stateless/routes/`
  (CloudTAK >= 13.45 — the hub/api split moved route loading there; pre-split trees are not supported):
  - `plugin-dispatcher.ts` — the standalone Events/Incidents store (CloudTAK Postgres) + CRUD
    endpoints under `/api/dispatcher/…`.
  - `plugin-takcad.ts` — a server-side proxy to the TAK-CAD TAK Server plugin (and a keyless
    Nominatim geocode helper), used only in TAK-CAD mode.

## Install

This plugin has two halves that must land in two different places in your CloudTAK source tree —
`plugin/` (the web UI, into `app/plugins/` — `api/web/plugins/` on CloudTAK older than 13.102.0) and `server/` (the API routes, into
`api/stateless/routes/` — requires CloudTAK >= 13.45).
CloudTAK's built-in `WEB_PLUGINS` env var **cannot** install it: it only handles the web half, it
clones the whole repo (nesting the plugin one level too deep for Vite), and it drops the server
`*.ts` files where the web build type-checks them and fails. So use one of the two paths below.

### Option 1 — infra-TAK console (no terminal needed)

If your CloudTAK was deployed by [infra-TAK](https://github.com/takwerx/infra-TAK), install/update/
remove this plugin from the **CloudTAK Plugins marketplace** in the console. It clones this repo,
copies the two halves into place, and rebuilds the CloudTAK API image for you.

### Option 2 — standalone CloudTAK (`install.sh`)

For CloudTAK deployments **not** managed by infra-TAK. `install.sh` does exactly what the infra-TAK
installer does — copies `plugin/` → `app/plugins/tak-dispatcher/` (`api/web/plugins/` on older CloudTAK, auto-detected), copies `server/*.ts` →
`api/stateless/routes/` (refusing on pre-13.45 trees), then rebuilds and restarts the CloudTAK API image.

```bash
# clone this repo somewhere on the CloudTAK host
git clone https://github.com/takwerx/cloudtak-dispatcher-plugin
cd cloudtak-dispatcher-plugin

# install into your CloudTAK checkout (defaults to ~/CloudTAK)
./install.sh /path/to/CloudTAK
```

The rebuild takes 5–15 minutes. When it finishes, in CloudTAK go to **Settings → Refresh App** to
activate the new service worker (a normal hard-refresh does **not** work — the service worker
intercepts requests), or close all CloudTAK tabs and reopen. The plugin appears at the bottom of
the right-side menu.

**Updating** (pull the latest version and rebuild):

```bash
./install.sh --pull /path/to/CloudTAK
```

**After updating CloudTAK itself**, re-run `./install.sh --pull /path/to/CloudTAK`. CloudTAK
sometimes moves where it builds plugins from (13.102.0 did); re-running puts the plugin where
your new CloudTAK version looks for it. If the menu item is missing after an update, this is
the fix.

**Removing:**

```bash
./install.sh --remove /path/to/CloudTAK
```

Run `./install.sh --help` for all options (`--no-build` copies files without rebuilding).
Requires `bash`, `docker` + `docker compose` (and `git` for `--pull`).

## Requirements

- CloudTAK 13.45+

## License

Proprietary © takwerx. All rights reserved.
