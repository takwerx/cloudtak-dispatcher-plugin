// Proof test for install.sh and the Dockerfile.dockerignore it writes (ops #504, public issue #37).
// CloudTAK's .dockerignore leaves out app/plugins/*, so install.sh writes a Dockerfile.dockerignore that
// puts plugin folders back. It used to put back only its own, so every other web plugin on the box (TAK Sim,
// LiveWX Radar) was on disk but missing from the built image. These tests run the real install.sh with
// --no-build against a throwaway CloudTAK folder. Run: node --test .github/ci/tests/install-dockerignore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const INSTALL = new URL('../../../install.sh', import.meta.url).pathname;
// What CloudTAK main ships: everything under app/plugins is left out except *.ts and the README.
const UPSTREAM_DOCKERIGNORE = '**/node_modules\napp/plugins/*\n!app/plugins/*.ts\n!app/plugins/README.md\n';
const INFRATAK_FILE = '# infra-TAK (ops #299): generated from .dockerignore; re-includes the installed CloudTAK plugins.\n'
    + UPSTREAM_DOCKERIGNORE + '\n!app/plugins/tak-sim\n';

// A CloudTAK checkout with the given plugin folders already in app/plugins/.
function cloudtak(others = ['tak-sim', 'livewx-radar'], extra = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'));
    mkdirSync(join(dir, 'api/stateless/routes'), { recursive: true });
    mkdirSync(join(dir, 'app/src'), { recursive: true });
    for (const n of others) {
        mkdirSync(join(dir, 'app/plugins', n), { recursive: true });
        writeFileSync(join(dir, 'app/plugins', n, 'index.ts'), '// ' + n + '\n');
    }
    writeFileSync(join(dir, '.dockerignore'), UPSTREAM_DOCKERIGNORE);
    for (const [f, text] of Object.entries(extra)) writeFileSync(join(dir, f), text);
    return dir;
}
const run = (dir, ...args) => spawnSync('bash', [INSTALL, '--no-build', ...args, dir], { encoding: 'utf8' });
const override = (dir) => join(dir, 'Dockerfile.dockerignore');
const reincluded = (dir) => readFileSync(override(dir), 'utf8').split('\n').filter(l => l.startsWith('!app/plugins/') && !l.includes('*') && !l.endsWith('.md'));
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test('install keeps every plugin folder in the build, not just the Dispatcher', () => {
    const dir = cloudtak();
    try {
        const r = run(dir);
        assert.equal(r.status, 0, r.stderr);
        const lines = reincluded(dir);
        for (const n of ['tak-dispatcher', 'tak-sim', 'livewx-radar']) {
            assert.ok(lines.includes('!app/plugins/' + n), n + ' must be re-included, got: ' + lines.join(' '));
        }
        // The re-includes come after CloudTAK's `app/plugins/*`; before it they would change nothing.
        const text = readFileSync(override(dir), 'utf8');
        assert.ok(text.indexOf('!app/plugins/tak-sim') > text.indexOf('\napp/plugins/*\n'));
    } finally { cleanup(dir); }
});

test('running install twice gives the same file', () => {
    const dir = cloudtak();
    try {
        run(dir);
        const first = readFileSync(override(dir), 'utf8');
        assert.equal(run(dir).status, 0);
        assert.equal(readFileSync(override(dir), 'utf8'), first);
    } finally { cleanup(dir); }
});

test('a file written by an older install.sh (Dispatcher only) is rewritten to keep the other plugins', () => {
    const old = '# managed by cloudtak-dispatcher-plugin install.sh\n# copy of CloudTAK\'s .dockerignore + our re-include; re-run install.sh after updating CloudTAK\n'
        + UPSTREAM_DOCKERIGNORE + '\n# re-include the Dispatcher web plugin\n!app/plugins/tak-dispatcher\n';
    const dir = cloudtak(['tak-sim', 'livewx-radar'], { 'Dockerfile.dockerignore': old });
    try {
        assert.equal(run(dir).status, 0);
        assert.deepEqual(reincluded(dir).sort(),
            ['!app/plugins/livewx-radar', '!app/plugins/tak-dispatcher', '!app/plugins/tak-sim']);
    } finally { cleanup(dir); }
});

test('a file infra-TAK wrote is left byte for byte alone', () => {
    const dir = cloudtak(['tak-sim', 'livewx-radar'], { 'Dockerfile.dockerignore': INFRATAK_FILE });
    try {
        const r = run(dir);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(readFileSync(override(dir), 'utf8'), INFRATAK_FILE);
        const gone = run(dir, '--remove');
        assert.equal(gone.status, 0, gone.stderr);
        assert.equal(readFileSync(override(dir), 'utf8'), INFRATAK_FILE, '--remove must not touch it either');
    } finally { cleanup(dir); }
});

test("an operator's own file is left alone, with a warning", () => {
    const mine = '# my own\napp/plugins/*\n';
    const dir = cloudtak(['tak-sim'], { 'Dockerfile.dockerignore': mine });
    try {
        const r = run(dir);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(readFileSync(override(dir), 'utf8'), mine);
        assert.match(r.stderr, /not ours/);
    } finally { cleanup(dir); }
});

test('--remove keeps the other plugins in the build, and deletes the file when none are left', () => {
    const dir = cloudtak();
    try {
        run(dir);
        assert.equal(run(dir, '--remove').status, 0);
        assert.deepEqual(reincluded(dir).sort(), ['!app/plugins/livewx-radar', '!app/plugins/tak-sim']);
        assert.ok(!existsSync(join(dir, 'app/plugins/tak-dispatcher')));
    } finally { cleanup(dir); }
    const alone = cloudtak([]);
    try {
        run(alone);
        assert.ok(existsSync(override(alone)));
        assert.equal(run(alone, '--remove').status, 0);
        assert.ok(!existsSync(override(alone)), 'with no plugins left the stale override must go');
    } finally { cleanup(alone); }
});

test('no file is written when CloudTAK does not leave plugins out', () => {
    const dir = cloudtak(['tak-sim'], { '.dockerignore': '**/node_modules\n' });
    try {
        assert.equal(run(dir).status, 0);
        assert.ok(!existsSync(override(dir)));
    } finally { cleanup(dir); }
});
