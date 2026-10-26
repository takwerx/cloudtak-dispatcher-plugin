# Security

## Reporting a vulnerability

Please report it privately: open this repository's **Security** tab and choose
**Report a vulnerability**
([direct link](https://github.com/takwerx/cloudtak-dispatcher-plugin/security/advisories/new)).
Do not open a public issue, and do not post details, logs or proof-of-concept
data where others can read them.

## Supported versions

Only the latest release gets security fixes. Update before reporting.

## What to expect

We acknowledge a report within 3 working days, tell you whether we can
reproduce it, and keep you updated until a fix ships. Confirmed issues are
fixed in a new release and credited to you if you want.

## Scope

The web plugin in `plugin/`, the API routes in `server/` and `install.sh`, including authentication on the `/api/dispatcher/` routes, what is stored in CloudTAK's database, and what the TAK-CAD proxy forwards. Vulnerabilities in CloudTAK or TAK Server themselves belong with those projects.
