#!/usr/bin/env bash
#
# install.sh — deploy the CloudTAK Dispatcher plugin into a CloudTAK checkout.
#
# For people running CloudTAK WITHOUT infra-TAK. CloudTAK's native WEB_PLUGINS env
# var cannot deploy this plugin, because (1) it clones the whole repo so the Vue
# plugin ends up one level too deep for Vite's glob, and (2) it drops the server
# *.ts files under web/plugins/ where the web build (vue-tsc) tries to type-check
# them and fails — and the /api/dispatcher/* routes never reach api/routes/, so the
# plugin loads but every API call 404s ("can't reach API").
#
# This script does exactly what the infra-TAK console's plugin marketplace does:
#   • copy  plugin/        → <CloudTAK>/api/web/plugins/tak-dispatcher/   (web plugin)
#   • copy  server/*.ts    → <CloudTAK>/api/routes/                       (server routes)
#   • rebuild + restart the CloudTAK API image so both are baked in.
#
# Usage:
#   Install:  ./install.sh [/path/to/CloudTAK]
#   Update:   ./install.sh --pull [/path/to/CloudTAK]      (git pull, then reinstall + rebuild)
#   Remove:   ./install.sh --remove [/path/to/CloudTAK]
#
# Options:
#   /path/to/CloudTAK   Your CloudTAK checkout (the dir containing docker-compose.yml).
#                       Defaults to ~/CloudTAK.
#   --pull              git pull this plugin repo first, so you get the latest version.
#   --no-build          Copy/remove files only; skip the docker rebuild + restart.
#   --remove            Uninstall: delete the copied files, then rebuild.
#
# Requires: bash; git (only for --pull); and (unless --no-build) docker + docker compose.

set -euo pipefail

INSTALL_DIR_NAME="tak-dispatcher"   # web-plugin dir name; matches the infra-TAK installer

# --- resolve this repo's location (so the script works from any cwd) ---------------
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    sed -n '/^# Usage:/,/^# Requires:/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# --- parse args --------------------------------------------------------------------
CT_DIR=""
DO_BUILD=1
DO_PULL=0
ACTION="install"
for arg in "$@"; do
    case "$arg" in
        --pull)     DO_PULL=1 ;;
        --no-build) DO_BUILD=0 ;;
        --remove)   ACTION="remove" ;;
        -h|--help)  usage; exit 0 ;;
        -*)         echo "Unknown option: $arg" >&2; echo >&2; usage >&2; exit 2 ;;
        *)          CT_DIR="$arg" ;;
    esac
done
CT_DIR="${CT_DIR:-$HOME/CloudTAK}"

# --- validate the CloudTAK checkout ------------------------------------------------
if [ ! -d "$CT_DIR" ]; then
    echo "ERROR: CloudTAK dir not found: $CT_DIR" >&2
    echo "       Pass the path explicitly:  ./install.sh /path/to/CloudTAK" >&2
    exit 1
fi
if [ ! -d "$CT_DIR/api" ]; then
    echo "ERROR: $CT_DIR does not look like a CloudTAK checkout (no api/ dir)." >&2
    exit 1
fi
if [ "$DO_BUILD" -eq 1 ] && [ ! -f "$CT_DIR/docker-compose.yml" ]; then
    echo "ERROR: no docker-compose.yml in $CT_DIR — cannot rebuild." >&2
    echo "       Re-run with --no-build to copy files only, then rebuild yourself." >&2
    exit 1
fi

WEB_DEST="$CT_DIR/api/web/plugins/$INSTALL_DIR_NAME"
# CloudTAK 13.45+ (hub/api split) loads server routes from api/stateless/routes/ and
# no longer compiles api/routes/. The routes in this repo target the 13.45+ contract
# (ConfigStateless, api/common libs), so a pre-split tree cannot build them — refuse
# rather than install files that either break the build (new tree semantics on old
# CloudTAK) or die silently.
LEGACY_ROUTES="$CT_DIR/api/routes"
if [ -d "$CT_DIR/api/stateless/routes" ]; then
    ROUTES_DEST="$CT_DIR/api/stateless/routes"
else
    ROUTES_DEST=""
fi

echo "CloudTAK:  $CT_DIR"
echo "Plugin:    $REPO_DIR"
echo "Action:    $ACTION"
echo

# --- optional self-update of the plugin repo ---------------------------------------
if [ "$DO_PULL" -eq 1 ]; then
    if [ ! -d "$REPO_DIR/.git" ]; then
        echo "ERROR: --pull given but $REPO_DIR is not a git checkout." >&2
        exit 1
    fi
    echo "Pulling latest plugin source..."
    git -C "$REPO_DIR" pull
    echo
fi

if [ "$ACTION" = "remove" ]; then
    # --- uninstall -----------------------------------------------------------------
    if [ -d "$WEB_DEST" ]; then
        rm -rf "$WEB_DEST"
        echo "Removed web plugin: api/web/plugins/$INSTALL_DIR_NAME"
    fi
    for src in "$REPO_DIR"/server/*.ts; do
        [ -e "$src" ] || continue
        fname="$(basename "$src")"
        for dest in "$ROUTES_DEST" "$LEGACY_ROUTES"; do
            [ -n "$dest" ] || continue
            if [ -f "$dest/$fname" ]; then
                rm -f "$dest/$fname"
                echo "Removed server route: ${dest#$CT_DIR/}/$fname"
            fi
        done
    done
else
    # --- install / update ----------------------------------------------------------
    if [ ! -d "$REPO_DIR/plugin" ]; then
        echo "ERROR: $REPO_DIR/plugin not found — run this from the plugin repo." >&2
        exit 1
    fi
    if [ -z "$ROUTES_DEST" ]; then
        echo "ERROR: this CloudTAK predates the 13.45 hub/api split (no api/stateless/routes/)." >&2
        echo "       The dispatcher server routes require CloudTAK >= 13.45 — update CloudTAK first." >&2
        exit 1
    fi
    mkdir -p "$CT_DIR/api/web/plugins" "$ROUTES_DEST"

    # Web plugin: replace the dir wholesale so removed files don't linger.
    rm -rf "$WEB_DEST"
    cp -R "$REPO_DIR/plugin" "$WEB_DEST"
    echo "Installed web plugin: api/web/plugins/$INSTALL_DIR_NAME"

    # Server routes: every *.ts in server/ → api/stateless/routes/ (auto-loaded by
    # schema.load). Also sweep stale copies out of the pre-split api/routes/ so an
    # upgraded tree doesn't carry dead duplicates.
    shopt -s nullglob
    for src in "$REPO_DIR"/server/*.ts; do
        fname="$(basename "$src")"
        cp "$src" "$ROUTES_DEST/$fname"
        echo "Installed server route: ${ROUTES_DEST#$CT_DIR/}/$fname"
        [ -f "$LEGACY_ROUTES/$fname" ] && rm -f "$LEGACY_ROUTES/$fname" && echo "Removed stale pre-split copy: api/routes/$fname"
    done
    shopt -u nullglob
fi

echo

# --- rebuild -----------------------------------------------------------------------
if [ "$DO_BUILD" -eq 0 ]; then
    echo "Skipped rebuild (--no-build). To apply, run in $CT_DIR:"
    echo "    docker compose build --no-cache api && docker compose up -d --force-recreate api"
    exit 0
fi

echo "Rebuilding CloudTAK API image — this takes 5–15 minutes..."
( cd "$CT_DIR" && docker compose build --no-cache api )
echo "Restarting CloudTAK API container..."
( cd "$CT_DIR" && docker compose up -d --force-recreate api )

echo
if [ "$ACTION" = "remove" ]; then
    echo "✓ Plugin removed."
else
    echo "✓ Plugin installed."
    echo "  → In CloudTAK: Settings → Refresh App to activate the new service worker."
    echo "    (Cmd+Shift+R does NOT work — the service worker intercepts requests.)"
    echo "    Or close all CloudTAK tabs and reopen. The plugin appears at the"
    echo "    bottom of the right-side menu."
fi
