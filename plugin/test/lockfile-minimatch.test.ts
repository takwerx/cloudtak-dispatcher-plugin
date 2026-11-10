// Proof test for the minimatch Dependabot alert (ops #530, GHSA: denial of service via globparts
// amplification, affects minimatch >= 7.0.0 and < 11.0.1). Plain node, no install needed:
//   node --test plugin/test/*.test.ts
// Reads plugin/package-lock.json and fails if any copy of minimatch in the vulnerable range comes back,
// or if the override that keeps it out is removed. Build-time packages only; none of this ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const major = (v: string) => Number(v.split('.')[0]);
const minor = (v: string) => Number(v.split('.')[1]);
const patch = (v: string) => Number(v.split('.')[2].split('-')[0]);
const vulnerable = (v: string) => {
    if (major(v) < 7) return false;
    if (major(v) > 11) return false;
    if (major(v) === 11) return minor(v) === 0 && patch(v) < 1;
    return true;
};

test('the lockfile has no minimatch in the vulnerable range', () => {
    const copies = Object.entries<{ version: string }>(lock.packages)
        .filter(([path]) => path === 'node_modules/minimatch' || path.endsWith('/node_modules/minimatch'));
    assert.ok(copies.length > 0, 'no minimatch found in the lockfile; has the test lost its target?');
    for (const [path, p] of copies) {
        assert.ok(!vulnerable(p.version), `${path} is ${p.version}, vulnerable (needs 11.0.1 or newer)`);
    }
});

test('package.json keeps the minimatch override', () => {
    assert.equal(pkg.overrides?.minimatch, '^11.0.1');
});

test('glob 10 (cannot run on minimatch 11) is not in the lockfile', () => {
    // glob 10 returns no matches at all on minimatch 11, so the override above needs archiver-utils on glob 13.
    for (const [path, p] of Object.entries<{ version: string }>(lock.packages)) {
        if (path === 'node_modules/glob' || path.endsWith('/node_modules/glob')) {
            assert.ok(major(p.version) >= 13, `${path} is ${p.version}; glob below 13 breaks on minimatch 11`);
        }
    }
});
