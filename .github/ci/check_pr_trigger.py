"""Fail if pr-checks.yml only runs for PRs aimed at some branches (ops #466).

A `branches:` filter under `pull_request` means a PR stacked on a feature branch gets no checks at all.
Usage: python3 -I .github/ci/check_pr_trigger.py [path/to/pr-checks.yml]
Exit 0 = every PR is checked, 1 = a filter is present (or the trigger is missing), 2 = could not run.
"""
import sys

try:
    import yaml
except ImportError:
    print("PyYAML is not installed (pip install pyyaml)", file=sys.stderr)
    sys.exit(2)

path = sys.argv[1] if len(sys.argv) > 1 else ".github/workflows/pr-checks.yml"
with open(path, "rb") as fh:
    doc = yaml.safe_load(fh)

# YAML 1.1 reads the key `on` as the boolean True.
trigger = doc.get("on", doc.get(True))
pr = trigger.get("pull_request") if isinstance(trigger, dict) else None
if pr is None and not (isinstance(trigger, dict) and "pull_request" in trigger):
    print("::error file=%s::no pull_request trigger" % path)
    sys.exit(1)
bad = [k for k in ("branches", "branches-ignore", "paths", "paths-ignore") if pr and k in pr]
if bad:
    print("::error file=%s::pull_request has a %s filter; every PR must be checked, whatever branch or "
          "files it touches" % (path, "/".join(bad)))
    sys.exit(1)
print("pr-checks.yml runs on every pull request")
