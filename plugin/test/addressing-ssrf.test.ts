// Proof tests for the web-pull guard: a source's web address may only reach the public internet.
//   node --test plugin/test/addressing-ssrf.test.ts
// The code between `// <addressing-net>` markers in server/plugin-addressing.ts is cut out of the
// real file and run (with the same imports and a stand-in for CloudTAK's Err class). It is the code
// that ships. Without the guard these tests fail: the server on this machine is reached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';

const server = readFileSync(new URL('../../server/plugin-addressing.ts', import.meta.url), 'utf8');
const block = server.slice(server.indexOf('// <addressing-net>'), server.indexOf('// </addressing-net>'));
assert.ok(block.includes('export async function safeFetch'), 'could not find the net block in the server file');

const prelude = `
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
class Err extends Error { constructor(status, err, message) { super(message); this.status = status; } }
`;
const dir = mkdtempSync(join(tmpdir(), 'addressing-net-'));
const file = join(dir, 'net.ts');
writeFileSync(file, prelude + block);
const m = await import(pathToFileURL(file).href);

// A web server on this machine that counts the requests it gets, and what each one asked for.
const seen: string[] = [];
const srv = http.createServer((req, res) => {
    seen.push(String(req.url));
    if (req.url === '/hello') { res.end('{"ok":true}'); return; }
    if (req.url === '/gz') { res.setHeader('content-encoding', 'gzip'); res.end(zlib.gzipSync('compressed hello')); return; }
    if (req.url === '/to-hello') { res.statusCode = 302; res.setHeader('location', '/hello'); res.end(); return; }
    if (req.url === '/loop') { res.statusCode = 302; res.setHeader('location', '/loop'); res.end(); return; }
    if (req.url === '/to-metadata') { res.statusCode = 302; res.setHeader('location', 'http://169.254.169.254/latest/meta-data/'); res.end(); return; }
    if (req.url === '/big') { res.end('x'.repeat(5000)); return; }
    if (req.url === '/empty') { res.statusCode = 204; res.end(); return; }
    res.statusCode = 404; res.end('no');
});
await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
const port = (srv.address() as AddressInfo).port;
test.after(() => srv.close());

const allowLocal = { blocked: () => false, timeoutMs: 5000 };

test('isBlockedAddress: private, loopback, link-local and metadata addresses are refused', () => {
    for (const ip of [
        '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1',
        '169.254.169.254', '100.64.0.1', '100.127.255.255', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
        '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3',
        '::ffff:169.254.169.254', '64:ff9b::a00:1', '2002:7f00:1::', '2001:db8::1', 'not an address', '',
    ]) assert.equal(m.isBlockedAddress(ip), true, ip);
});

test('isBlockedAddress: public addresses are allowed', () => {
    for (const ip of [
        '8.8.8.8', '1.1.1.1', '104.18.2.3', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.1.1',
        '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '2002:0808:0808::1',
    ]) assert.equal(m.isBlockedAddress(ip), false, ip);
});

test('safeFetch: an address on this machine is refused and the server is never asked', async () => {
    seen.length = 0;
    for (const url of [`http://127.0.0.1:${port}/hello`, `http://localhost:${port}/hello`, `http://[::1]:${port}/hello`,
        `http://[::ffff:127.0.0.1]:${port}/hello`, `http://2130706433:${port}/hello`, `http://0x7f.0.0.1:${port}/hello`]) {
        await assert.rejects(m.safeFetch(url, { timeoutMs: 5000 }), /private network/, url);
    }
    assert.deepEqual(seen, [], 'a request reached the server on this machine');
});

test('safeFetch: the cloud metadata address and private ranges are refused', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.17.0.1:5000/api']) {
        await assert.rejects(m.safeFetch(url, { timeoutMs: 5000 }), /private network/, url);
    }
});

test('safeFetch: only http and https', async () => {
    await assert.rejects(m.safeFetch('file:///etc/passwd', { timeoutMs: 1000 }), /http/);
    await assert.rejects(m.safeFetch('ftp://example.com/x.csv', { timeoutMs: 1000 }), /http/);
    await assert.rejects(m.safeFetch('not a url', { timeoutMs: 1000 }), /not valid/);
});

test('safeFetch: a redirect to a private address is refused', async () => {
    // The first hop is allowed (stand-in for a public server); only the metadata address is blocked.
    const blocked = (ip: string) => ip === '169.254.169.254';
    seen.length = 0;
    await assert.rejects(m.safeFetch(`http://127.0.0.1:${port}/to-metadata`, { timeoutMs: 5000, blocked }), /private network/);
    assert.deepEqual(seen, ['/to-metadata']);
});

test('safeFetch: a public answer comes back as a normal Response', async () => {
    const r = await m.safeFetch(`http://127.0.0.1:${port}/hello`, allowLocal);
    assert.equal(r.ok, true);
    assert.deepEqual(await r.json(), { ok: true });
});

test('safeFetch: follows a redirect, unzips, caps size, stops a redirect loop', async () => {
    const r1 = await m.safeFetch(`http://127.0.0.1:${port}/to-hello`, allowLocal);
    assert.equal(r1.status, 200);
    assert.equal(await r1.text(), '{"ok":true}');
    const r2 = await m.safeFetch(`http://127.0.0.1:${port}/gz`, allowLocal);
    assert.equal(await r2.text(), 'compressed hello');
    await assert.rejects(m.safeFetch(`http://127.0.0.1:${port}/big`, { ...allowLocal, maxBytes: 1000 }), /larger than 80 MB/);
    await assert.rejects(m.safeFetch(`http://127.0.0.1:${port}/loop`, allowLocal), /too many times/);
    const r3 = await m.safeFetch(`http://127.0.0.1:${port}/empty`, allowLocal);
    assert.equal(r3.status, 204);
    const r4 = await m.safeFetch(`http://127.0.0.1:${port}/nope`, allowLocal);
    assert.equal(r4.ok, false);
    assert.equal(r4.status, 404);
});

test('the web pulls in the server file all go through safeFetch', () => {
    // Nominatim (a fixed public address) is the only plain fetch left.
    const plain = server.split('\n').filter(l => /\bfetch\(/.test(l) && !/safeFetch\(/.test(l) && !/^\s*\/\//.test(l));
    assert.equal(plain.length, 2, plain.join('\n'));
    assert.ok(plain.every(l => l.includes('NOMINATIM_BASE')), plain.join('\n'));
});
