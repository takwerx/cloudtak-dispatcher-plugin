# CloudTAK Dispatcher Plugin

A dispatcher plugin for [CloudTAK](https://github.com/dfpc-coe/CloudTAK) — create and manage
incidents on the map, organize them under named **Events**, assign responders, and notify them
via mission chat and direct GeoChat.

## Modes

The plugin auto-detects its environment on load:

- **Standalone** (no external dependency) — Events and Incidents are stored server-side in
  CloudTAK's own database and shared live across every dispatcher on that CloudTAK. An **Event**
  (e.g. `2025-FESTIVAL`) is tied 1:1 to a DataSync feed and holds many Incidents. Incidents
  persist through close (and can be reopened); they are removed only when the Event is nuked.
- **TAK-CAD** — if the TAK-CAD TAK Server plugin is detected, the full CAD UI (Vehicles,
  Personnel, incident types/roles) lights up on top of the standalone capabilities.

## Layout

- `plugin/` — the CloudTAK web plugin (Vue 3 / TypeScript), discovered and bundled by CloudTAK's
  Vite build into `web/plugins/`.
- `server/` — CloudTAK API route files copied into CloudTAK's `api/stateless/routes/`
  (CloudTAK >= 13.45 — the hub/api split moved route loading there; pre-split trees are not supported):
  - `plugin-dispatcher.ts` — the standalone Events/Incidents store (CloudTAK Postgres) + CRUD
    endpoints under `/api/dispatcher/…`.
  - `plugin-takcad.ts` — a server-side proxy to the TAK-CAD TAK Server plugin (and a keyless
    Nominatim geocode helper), used only in TAK-CAD mode.

## Install

This plugin has two halves that must land in two different places in your CloudTAK source tree —
`plugin/` (the web UI, into `api/web/plugins/`) and `server/` (the API routes, into
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
installer does — copies `plugin/` → `api/web/plugins/tak-dispatcher/`, copies `server/*.ts` →
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

**Removing:**

```bash
./install.sh --remove /path/to/CloudTAK
```

Run `./install.sh --help` for all options (`--no-build` copies files without rebuilding).
Requires `bash`, `docker` + `docker compose` (and `git` for `--pull`).

## Requirements

- CloudTAK 13.2+

## License

Proprietary © takwerx. All rights reserved.
