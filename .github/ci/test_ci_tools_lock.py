#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""ops #1198: the CI tools lock file stays free of known-vulnerable Vue packages.

Run it: python3 -I .github/ci/test_ci_tools_lock.py        (standard library only, Python 3.9+)

.github/ci/tools/package-lock.json is what the PR check installs with `npm ci`. Dependabot raised
GHSA-g2v6-rqmx-r4w6 (XSS in @vue/server-renderer, all versions below 3.5.42) against it. The CI tools never load
@vue/server-renderer, but the lock must not carry it vulnerable. Pins:
  * @vue/server-renderer in the lock is 3.5.42 or newer;
  * every @vue/* package and vue itself is one single version (Vue publishes them together);
  * package.json pins vue to exactly the version the lock holds (so `npm ci` cannot fail, and a bump of
    one without the other is caught here, not on a runner).
Add a package and its first fixed version to MIN_VERSION when a new advisory lands.
It exits 1 and prints every problem it finds.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
TOOLS = ROOT / '.github' / 'ci' / 'tools'

# package name in node_modules/ -> first version that is NOT vulnerable.
MIN_VERSION = {
    'node_modules/@vue/server-renderer': (3, 5, 42),  # GHSA-g2v6-rqmx-r4w6
}


def _ver(text):
    m = re.match(r'^(\d+)\.(\d+)\.(\d+)', text or '')
    return tuple(int(x) for x in m.groups()) if m else None


def check(lock, pkg):
    """Return the list of problems for one parsed lock file and one parsed package.json."""
    problems = []
    packages = lock.get('packages', {})
    for path, floor in MIN_VERSION.items():
        entry = packages.get(path)
        if entry is None:
            continue  # not in the lock at all is fine
        have = _ver(entry.get('version'))
        if have is None or have < floor:
            problems.append('%s is %s, needs %s or newer' % (
                path, entry.get('version'), '.'.join(map(str, floor))))
    vue_versions = {
        path: entry.get('version') for path, entry in packages.items()
        if path == 'node_modules/vue' or path.startswith('node_modules/@vue/')
    }
    if len(set(vue_versions.values())) > 1:
        problems.append('vue packages differ in version: %s' % json.dumps(vue_versions, sort_keys=True))
    pinned = (pkg.get('dependencies') or {}).get('vue')
    locked = vue_versions.get('node_modules/vue')
    if pinned != locked:
        problems.append('package.json pins vue %s but the lock holds %s' % (pinned, locked))
    return problems


def main():
    lock = json.loads((TOOLS / 'package-lock.json').read_text(encoding='utf-8'))
    pkg = json.loads((TOOLS / 'package.json').read_text(encoding='utf-8'))
    problems = check(lock, pkg)
    for p in problems:
        print('FAIL: ' + p)
    if problems:
        return 1
    print('ok: CI tools lock has no known-vulnerable Vue package')
    return 0


if __name__ == '__main__':
    sys.exit(main())
