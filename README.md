# CloudTAK Dispatcher Plugin

A dispatcher plugin for [CloudTAK](https://github.com/dfpc-coe/CloudTAK) — create and manage
incidents on the map, organize them under named **Events**, assign responders, and notify them
via mission chat and direct GeoChat.

**Current version: 1.6.0.** What changed in each version: [CHANGELOG.md](CHANGELOG.md).

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
from the field. A cleared unit stays on the incident, greyed, with its three times; the **trash can** is for a unit
assigned by mistake and removes it from the record. The board shows **Unassigned**, **Dispatched** or
**On Scene** next to each active incident. Closing an incident clears every unit still on it with the close
time. The marker remarks read `Responding: E12 (on scene), M4` (cleared units drop off), the feed log gets
`ON SCENE:` and `CLEARED:` lines, every change is a note on the incident, and the report and CSV list each unit
with its times plus the incident's first on-scene time. Units assigned before this version show as Assigned
with no times.

A unit works one incident at a time. While it is Assigned or On Scene on an active incident, the assign
search and the contacts picker show it greyed with that incident's number (`E12 · on 014`, the number
without the Event prefix), and it can't be picked. Clear it there first; then it can be assigned here. The
server checks too, so two dispatchers assigning the same unit at the same moment can't both win: the second
gets `E12 is on 014. Clear it there first.` (it clears after 10 seconds; with several units picked it adds
`Nothing was assigned.`, since a refused press assigns none of them).

A unit that cleared from an incident can be sent back to it: assigning it again adds a second line for the
second trip, and the first line keeps its times (the report lists both, and the incident's first on-scene
time stays). The **✕** on a line removes that trip only.

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
first launch) can change it, and the server refuses the change for anyone else. **Dispatcher Settings → Incident
Types** is locked to the same admin account.

### Incident types (standalone)

The **Incident Type** list on a new incident starts as the plugin's built-in types. **Dispatcher Settings →
Incident Types** (CloudTAK system admin only) holds the agency's own types, each a **name** with an optional
short **code** (`MVA` for `Traffic Accident`):

- **Load from a CSV file**: two columns, code then name, one type per row (`MVA,Traffic Accident`). The code can
  be left empty (`,Welfare Check`), a header row (`code,name`, or `name` over a list of names) is skipped, and a
  name with a comma in it goes in quotes. A file with semicolons or tabs between the two columns is read the
  same way. **Download example CSV** gives a file to start from. Loading a file replaces the list. If a code or
  a name is in the file twice (upper and lower case count as the same), or a code is malformed, nothing is
  loaded and the rows at fault are named, numbered as a spreadsheet numbers them.
- **Add** one type by hand with the Code and name boxes, or remove one with its trash can.
- A code is letters and digits only, no spaces, 8 at most, and is stored in upper case.
- **Use only these incident types**: on, the built-in types are removed and dispatchers pick from the agency's
  list only, in the order of the list (the first one is preselected). Off (the default), the agency's types are
  added to the built-in ones, as before; a type named like a built-in one gives that one its code. With the
  switch on and an empty list, the built-in types stay, so the list is never empty.

The list shows the code beside the name (`MVA - Traffic Accident`). An incident stores the **name**, as before,
so markers, the feed log and reports show the name and never the code, and incidents created earlier keep the
type they have. A change reaches each dispatcher the next time they start a new incident: the list is read
again when the board starts, when an incident is opened and when the New Incident form opens. A list saved by
an older version (names only) keeps working, as names with no code. TAK-CAD mode keeps the types from its server.

### The Dispatcher header and Dispatcher Settings (standalone)

From the top, the Dispatcher shows:

- **Dispatcher**, with **Settings** and **Pop out** (**Workspace** in Multi-Monitor Mode, below).
  **Settings** opens Dispatcher Settings, shared by every event and every dispatcher on the CloudTAK, with or
  without an event open: the report header, caller details on markers, the CJIS reminder, employee numbers and
  incident types. One setting there is per computer instead: the display mode (below).
- **Callsign** (the CloudTAK callsign) and, with Employee Numbers on and someone signed in, **Employee #**. At
  the right of that line, as links: **Sign out**, and **TAK-CAD**, which connects to a TAK-CAD server (green
  with a dot while connected; press it again to disconnect).
- **Event**, the open event's name, and beside it **Broadcast** with the channel, or **DataSync** with the feed
  (✓ when subscribed). Under them, three buttons of equal width: **Switch** goes to the list of events to open
  another (the event stays open for everyone), **Report** is the open event's after-action report, and
  **Commands** shows or hides the command line (below).
- **Incidents**, with its tabs (**Active | Closed**, or **Unassigned | Active | Closed** in Multi-Monitor Mode)
  and **+ New** on one band, marked by a thin orange line on top.
  **Create Incident** opens the new incident, ready for notes, callers and units; **Back** goes to its tab.

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

### Undocked incidents and Display Mode (standalone)

The Dispatcher panel shows one incident at a time. Press **Undock** (the window icon next to **Back**
on an incident) and that incident opens in its own window; the panel goes back to the list, so several
incidents can be open and worked at once. Each window is the same incident view with everything in it
(callers, notes, units, close, reopen). **✕** closes the window; the incident stays on the board, and
clicking its row opens it in the panel again. The list marks undocked incidents and shows how many are out,
with **Close all**. The windows stay live while the panel is on another incident, the list, or closed, and
edits made in a window go through the same server calls as the panel. They close when the Event is closed.

Where the window opens is the **Display Mode** in **Dispatcher Settings**. It is a per-computer choice:
any dispatcher sets it, it is remembered in that browser across sessions and reloads, and it changes nothing
for anyone else (it describes the desk, one monitor or several, and desks often share a CloudTAK login):

- **Single Monitor Mode** (the default; a computer that never chooses gets this): the window
  floats over the map inside the CloudTAK page, draggable by its grip and resizable. New windows open side
  by side while they fit left of the panel, then step down and right, and never over a popped-out
  Dispatcher while there is room beside it. After a page reload they come back
  when the Dispatcher is opened on that Event again.
- **Multi-Monitor Mode**: the Dispatcher's pop-out button opens the **Dispatcher workspace**, one browser
  window of its own to drag onto another monitor and maximize, like CloudTAK's video wall. The Dispatcher is
  pinned to its right edge at full height; undocked incidents share the space to its left. One fills it, two
  split it in half, three in thirds, and so on, until a window would be smaller than an incident's default
  size (420 px wide, or 600 px tall); after that each new one shares a spot with one already there, full
  size, and the incidents in that spot are tabs along its top. A wide workspace is split side by side, the first window beside the
  panel; a tall one (a monitor on its side) one above the other, the first at the top. Closing a window gives
  its room back to the others, and they follow the workspace when it is resized or maximized; a window dragged
  by its title bar or resized from its corner stays where the dispatcher put it, above the others and never
  bigger than the workspace, until **Line up** on its title bar puts it back to share the space with them.
  Making the workspace smaller puts the incidents that no longer fit into shared spots the same way; a tab
  brings that incident to the front. An incident already open in a
  window has its Undock button grayed out. The map stays full size on the
  first monitor, and **Show on Map** moves it. Undock with the workspace closed opens it. The workspace is
  driven by the CloudTAK tab that opened it (live, no second sign-in) and closes when that tab is closed or
  reloaded, or when the dispatcher closes it; pressing the pop-out button again brings it back with its
  incident windows. The first time, the browser may ask to allow pop-ups for the site; if it blocks the
  workspace, things open over the map instead and the list says how to allow pop-ups. On a phone it behaves
  as Single Monitor Mode.
  Multi-Monitor Mode also splits the incident list into three tabs: **Unassigned** (open, no unit on it,
  including one whose units have all cleared), **Active** (open, at least one unit Assigned or On Scene) and
  **Closed**. Single Monitor Mode keeps the two tabs it always had (Active is every open incident).
  Closing an incident goes back to the tab it was opened from, not to Closed.

In both modes each incident in the list is a short card: the incident number and the time it was created,
the type, the address, and the callsigns of the units on it (when any are assigned). Single Monitor Mode
also shows its labels on the card (Undocked, active or closed, Unassigned / Dispatched / On Scene); in
Multi-Monitor Mode the tab already says that, and an undocked incident is marked by a stripe on its left
edge. The full incident (callers, notes, units, report number) is one click away.

**Close all** and **✕** are remembered (per browser), so closed windows stay closed.
### Local address data (standalone)

By default the incident form's address search and map-click lookup use the public OpenStreetMap
geocoder. **Dispatcher Settings → Local Address Data** (CloudTAK system admin only) lets an admin load the agency's
own **address points**, **street intersections** and **common place names** so those are searched
first, with the public geocoder as the fallback:

- **From a file** — a CSV or GeoJSON upload of point data; the kind (addresses, intersections or places) is
  read from the column names and can be changed, the admin maps the file's columns to the plugin's fields
  (guessed automatically for the usual names), sets a "data as of" date, and the rows are checked and
  swapped in only when the whole load succeeds. Replace the file any time. **Download example CSV**
  gives a sample file for the selected kind with the column names the mapping recognises and, in note rows at
  the top (skipped on import), what goes in each column.
- **From a web address** — an ArcGIS Feature Service layer (`…/FeatureServer/0`, read in pages) or a
  plain GeoJSON / CSV URL, pulled again after a set number of hours (checked when a lookup arrives,
  or with **Refresh now**). The server reads public internet addresses only: a web address that
  points to a private network, this server or a cloud metadata address (including through a
  redirect) is refused. For data kept on an internal server, load it from a file.

Typing in the Location box then offers **Place** (from two characters, narrowing as more is typed)
and **Verified** results ahead of **OpenStreetMap** ones. A map click fills the nearest verified
address point or intersection within the configured
distances (defaults 60 m / 40 m) and shows how far it is from the click, with up to three alternates.
The incident point stays where the dispatcher clicked: the click chooses the address, not the other way round.
Beyond the give-up distance (150 m) the public geocoder answers as before.
An address with units offers up to six of them as buttons (the nearest ones after a map click); typing in the
**Unit** box narrows the buttons. For a typed address, a unit the data knows puts the point on that unit. Any
other unit is typed by hand and goes on the address line as written (a bare `421` becomes `#421`).
Choosing a place also writes `Common Place Name: <place>` at the top of the incident details. A place or
intersection with no city, state or ZIP of its own takes them from the verified address point it sits at, and
**Default country** fills the Country box of every local result (local files rarely carry one). **Only show OpenStreetMap
results within my coverage area** keeps typed public results inside a circle the admin sets (a centre, which
**Use map centre** fills in, and a radius), with local address data on or off; a map click is not affected. The **Try it** box
in Dispatcher Settings shows exactly what the local data returns for a typed address or a lat/lon.

**Changing an incident's location.** When a call turns out to belong somewhere else, press **Change** beside the
address in the incident (active or closed). The same Location box as a new incident opens, filled with where the
incident is now: search, click the map, or correct the boxes, then **Save Location**. The marker moves, the feed
log gets a `LOCATION CHANGED:` line, the units on the incident are messaged the new address, and the server writes
one note with both places, `Location changed: <old address> (<lat>, <lon>) → <new address> (<lat>, <lon>)`, so the
incident's log, the report and the CSV show where it started and where it moved to.
A place chosen at the address the incident is already at only adds its name (details and marker): nothing moved, so no
line, message or note is written.

### Command line (standalone)

For dispatchers who would rather type than click. With an event open, press **F2** (or **Commands** under the
event's name) and a one-line box opens under it; **F2** always puts the cursor in it, **Esc** leaves it.
It is remembered per computer, like Display Mode, and it is off until a desk turns it on. In Multi-Monitor Mode
it is in the workspace window, where the Dispatcher is.

A line is `[incident] COMMAND [units or text]`, then **Enter**:

- **The incident number comes first and is optional.** `14 T caller called back` is a note on incident 014.
  Left out, the command is for the incident named at the left of the box: the one last opened, clicked in or
  brought to the front. A window that came back by itself after a reload does not count until it is clicked.
  For a unit's status no number is needed at all, because a unit works one incident at a time.
- **Units are typed the way they are said on the air.** A callsign is split at its hyphens, slashes and spaces,
  and any one part names the unit: for `AGENCY-NAME-H202`, type `H202` or the name. When two units fit, a
  numbered list asks which one. Part of an ID (`H2`) only ever lists; it never acts. Every unit on a line is
  settled before any of them is changed, so a line with one wrong word does nothing.
- **Types and dispositions are typed by the start of their words:** `N fire`, `X unf`. Several fits give the
  same numbered list.
- Under the box, a line says how the command was read before Enter, and what it did after. **Up** brings back
  earlier lines.

Every command runs the same code as its button, so the marker, the feed log, the messages to the units and the
employee number all follow as they do from a click.

| Type | It does | Button |
|---|---|---|
| `14` | Opens incident 014 (brings its window forward if it has one) | the incident in the list |
| `N fire, 120 main` | Opens the New Incident form with the type set and the address searched; **Enter** takes the marked address, **Enter** again creates the incident | **New** |
| `A H35 E6` | Assigns the units | the assign search |
| `O H35` | On Scene | **On Scene** |
| `C H35` | Clear | **Clear** |
| `UN H35` | Removes a unit assigned by mistake | the trash can |
| `T 2 patients, one trapped` | Adds a note | **Add note** |
| `X unf` | Closes the incident with that disposition; `X other <text>` for Other; `X` alone lists them | **Close Incident** |
| `14 R caller called back` | Reopens it. The reason goes in the notes; it is required when Employee Numbers is on | **Reopen** |
| `RN 26-00123` | Sets the report number | **Report #** |
| `CA J Smith, 555-0100, sees smoke` | Adds a caller: name, phone, note. The name or the phone may be left out | **+ Add caller** |
| `CP 2` | Makes the second caller primary | **Make primary** |
| `14 M` | Shows it on the map | **Show on Map** |
| `14 W` | Opens it in its own window | Undock |
| `WX ALL` | Closes its window (`WX`), or every incident window | **Close all** |
| `L C` | Back to the list (`L`), or to a tab: `L U`, `L A`, `L C` | **Back**, the tabs |
| `SI 4521` | Signs in with an employee number | **Sign in** |
| `SO` | Signs out | **Sign out** |
| `EV` | Switch event | **Switch** |
| `REP` | Event report | **Report** |
| `SET` | Settings | **Settings** |
| `POP` | Pops the Dispatcher out, or opens the workspace | **Pop out** / **Workspace** |
| `DOCK` | Docks it back to the panel | **Dock back to panel** |
| `?` | Lists the commands | |

A command never throws away a new incident that is being typed: it says to create or cancel it first.
Setup stays with the mouse: Dispatcher Settings, creating, archiving and deleting events, the map pin, editing
or removing a caller, changing an incident's location, and the report's period and downloads.

On a laptop, F2 may be a volume key until Fn Lock is on (often **Fn+Esc**).

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

### User Guide (standalone)

**User Guide**, at the bottom of the Events list, opens a plain-language, text-only guide for dispatchers and
call takers in its own pane over the map (full screen on a phone; in Multi-Monitor Mode, on the monitor with the
map), in the order a dispatcher meets things: opening the Dispatcher and your own settings; opening or creating
an event; creating, working, closing and reopening an incident; the command line; working several calls at once,
on one monitor or several; and exporting the data and closing the event. Its contents list names every task, and its
**Contents** button stays in view. It is part of the plugin, so it works without internet and matches the
installed version. The text is one Markdown file per section in `plugin/guide/`, which reads the same on
GitHub. A change that adds something dispatchers see adds or updates its section there;
[plugin/guide/README.md](plugin/guide/README.md) says how, and `plugin/test/guide.test.ts` checks every link
and heading.

## Layout

- `plugin/` — the CloudTAK web plugin (Vue 3 / TypeScript), discovered and bundled by CloudTAK's
  Vite build from the web app's `plugins/` dir (`app/plugins/` on CloudTAK >= 13.102.0, `api/web/plugins/` before).
  - `plugin/guide/` — the User Guide, one Markdown file per section (see its README).
- `server/` — CloudTAK API route files copied into CloudTAK's `api/stateless/routes/`
  (CloudTAK >= 13.45 — the hub/api split moved route loading there; pre-split trees are not supported):
  - `plugin-dispatcher.ts` — the standalone Events/Incidents store (CloudTAK Postgres) + CRUD
    endpoints under `/api/dispatcher/…`.
  - `plugin-takcad.ts` — a server-side proxy to the TAK-CAD TAK Server plugin (and a keyless
    Nominatim geocode helper, used by older builds of the incident form in both modes).
  - `plugin-addressing.ts` — local address data (points, intersections, places): the admin's
    sources, file loads and web pulls, and the `/api/dispatcher/address/suggest` and `…/reverse`
    lookups the incident form uses, with the public geocoder as the fallback.

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
