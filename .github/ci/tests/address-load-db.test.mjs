// Proof tests for committing and cancelling an address load (#108), against a real Postgres.
// Loads the real server/plugin-addressing.ts and drives its routes. The database client is the one
// CloudTAK itself runs (postgres-js 3.4.9, from the CI tools lock), called the way drizzle calls it
// (client.unsafe, client.begin); drizzle's sql template is the stand-in in ./stubs/drizzle-orm.mjs.
// Needs an empty Postgres and the CI tools installed. Run it the same way CI does:
//   CI_TOOLS=<folder npm ci'd from .github/ci/tools> PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres \
//   node --import ./.github/ci/tests/register.mjs --test .github/ci/tests/address-load-db.test.mjs
//
// The race (#108): a big commit outlives the page's 20 s timeout, the page then sends an abort.
// The abort must never throw away rows the commit is making live, and must never mark a good load
// "Upload cancelled".
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { render } from './stubs/drizzle-orm.mjs'

assert.ok(process.env.CI_TOOLS, 'set CI_TOOLS to the folder the CI tools were installed in')
const { default: postgres } = await import(pathToFileURL(join(process.env.CI_TOOLS, 'node_modules', 'postgres', 'src', 'index.js')).href)
const addressing = await import('../../../server/plugin-addressing.ts')

const client = postgres({ max: 5, onnotice: () => {} })
const raw = (text) => client.unsafe(text)

// Called after every statement the server runs; a test sets it to hold the server at one point.
let afterStatement = async () => {}
const pgOf = (c) => ({
    async execute(q) {
        const { text, params } = render(q)
        const rows = await c.unsafe(text, params)
        await afterStatement(text)
        return rows
    },
    async transaction(fn) { return await c.begin((tx) => fn(pgOf(tx))) },
})
const config = { pg: pgOf(client) }

const routes = {}
const schema = {}
for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    schema[m] = async (path, _opts, handler) => { routes[`${m.toUpperCase()} ${path}`] = handler }
}

async function call(key, params, body = {}) {
    const handler = routes[key]
    assert.ok(handler, `no route ${key}`)
    const out = { status: 200, body: undefined }
    const res = { status(s) { out.status = s; return res }, json(b) { out.body = b; return res } }
    await handler({ params, body, query: {} }, res)
    return out
}

const LOADS = '/dispatcher/address/sources/:sourceid/loads'
const start = (src) => call(`POST ${LOADS}`, { sourceid: src })
const push = (src, load, rows) => call(`POST ${LOADS}/:loadid/rows`, { sourceid: src, loadid: load }, { rows })
const commit = (src, load) => call(`POST ${LOADS}/:loadid/commit`, { sourceid: src, loadid: load }, { dropped: 0 })
const abort = (src, load) => call(`POST ${LOADS}/:loadid/abort`, { sourceid: src, loadid: load })
const state = (src, load) => call(`GET ${LOADS}/:loadid`, { sourceid: src, loadid: load })

const point = (n, street) => ({ house_number: n, street_name: street, city: 'Town', lat: 44 + n / 1000, lon: -123 })

async function source(id) {
    await raw(`INSERT INTO dispatcher_address_sources (id, kind, name, mode) VALUES ('${id}', 'points', '${id}', 'file')`)
}
// Load rows and make them live, the way the page does it: start, rows, commit.
async function stage(src, rows) {
    const load = (await start(src)).body.load_id
    const r = await push(src, load, rows)
    assert.equal(r.body.accepted, rows.length)
    return load
}
async function live(src, rows) {
    const load = await stage(src, rows)
    const c = await commit(src, load)
    assert.equal(c.status, 200, JSON.stringify(c.body))
    return load
}
const facts = async (src) => (await raw(`
    SELECT s.status, s.last_error, s.record_count,
           (SELECT count(*)::int FROM dispatcher_address_rows r WHERE r.source_id = s.id AND r.active) AS live_rows,
           (SELECT count(*)::int FROM dispatcher_address_rows r WHERE r.source_id = s.id) AS all_rows,
           (SELECT string_agg(DISTINCT street, ',' ORDER BY street) FROM dispatcher_address_rows r WHERE r.source_id = s.id AND r.active) AS streets
    FROM dispatcher_address_sources s WHERE s.id = '${src}'`))[0]

before(async () => {
    globalThis.__caller = { email: 'admin@example.org', is_admin: () => true }
    await raw('DROP TABLE IF EXISTS dispatcher_address_rows, dispatcher_address_sources CASCADE')
    // The server's own table bootstrap creates the tables.
    await addressing.default(schema, config)
    assert.equal((await raw(`SELECT to_regclass('dispatcher_address_rows') IS NOT NULL AS ok`))[0].ok, true)
})
after(async () => { afterStatement = async () => {}; await client.end() })

test('abort sent while a Replace is being committed: the new rows go live, nothing is lost', async () => {
    await source('race')
    await live('race', [point(1, 'Old'), point(2, 'Old')])
    const load = await stage('race', [point(1, 'New'), point(2, 'New'), point(3, 'New')])

    // Hold the commit right after it counted the staged rows, as a slow commit on 1.46 million
    // rows would be when the page gives up at 20 s and sends the abort.
    let reached, release
    const atCount = new Promise(r => { reached = r })
    const gate = new Promise(r => { release = r })
    afterStatement = async (text) => {
        if (text.includes('count(*)::int AS n FROM dispatcher_address_rows')) { afterStatement = async () => {}; reached(); await gate }
    }
    const committing = commit('race', load)
    await atCount
    const during = routes[`GET ${LOADS}/:loadid`] ? await state('race', load) : null

    let abortDone = false
    const aborting = abort('race', load).then(r => { abortDone = true; return r })
    await Promise.race([aborting, new Promise(r => setTimeout(r, 1500))])
    const abortWaited = !abortDone
    release()
    const c = await committing
    const a = await aborting

    // The data first: what a dispatcher searching these addresses gets.
    assert.equal(c.status, 200, JSON.stringify(c.body))
    const f = await facts('race')
    assert.equal(f.live_rows, 3, 'the new rows are live (the abort must not have thrown them away)')
    assert.equal(f.record_count, f.live_rows, 'the count shown matches the rows there')
    assert.equal(f.all_rows, 3, 'the old rows are gone, nothing staged is left behind')
    assert.equal(f.streets, 'NEW')
    assert.equal(f.status, 'ok')
    assert.equal(f.last_error, null, 'a good load is not marked Upload cancelled')
    // Then how: the abort waited for the commit, found the load live, and the page could see it running.
    assert.equal(abortWaited, true, 'the abort waits for the running commit')
    assert.equal(a.body.cancelled, false, 'the abort found the load live and left it alone')
    assert.equal(during?.body?.state, 'committing', 'the page can see the commit is still running')
    assert.equal((await state('race', load)).body.state, 'live')
})

test('abort sent after a slow commit already finished (the case seen in #108): no Upload cancelled', async () => {
    await source('late')
    const load = await stage('late', [point(1, 'Elm'), point(2, 'Elm')])
    assert.equal((await commit('late', load)).status, 200)
    const a = await abort('late', load)
    assert.equal(a.status, 200)
    const f = await facts('late')
    assert.equal(f.live_rows, 2)
    assert.equal(f.record_count, 2)
    assert.equal(f.status, 'ok')
    assert.equal(f.last_error, null, 'the source must not say Upload cancelled after a good load')
    assert.equal(a.body.cancelled, false)
})

test('load state: the page can ask what became of a load (staged, live, gone)', async () => {
    await source('state')
    const kept = await stage('state', [point(1, 'Ash')])
    assert.equal((await state('state', kept)).body.state, 'staged')
    assert.equal((await commit('state', kept)).status, 200)
    const st = (await state('state', kept)).body
    assert.equal(st.state, 'live', 'the page asking after a lost answer learns the load is live')
    assert.equal(st.source.record_count, 1)
    const dropped = await stage('state', [point(2, 'Ash')])
    assert.equal((await abort('state', dropped)).body.cancelled, true)
    assert.equal((await state('state', dropped)).body.state, 'gone')
})

test('regression, a real cancel still works: staged rows go, the previous data stays, a later commit is refused', async () => {
    await source('cancel')
    await live('cancel', [point(1, 'Keep'), point(2, 'Keep')])
    const load = await stage('cancel', [point(1, 'Drop'), point(2, 'Drop'), point(3, 'Drop')])
    const a = await abort('cancel', load)
    assert.equal(a.status, 200)
    let f = await facts('cancel')
    assert.equal(f.all_rows, 2, 'the staged rows are thrown away')
    assert.equal(f.streets, 'KEEP', 'the previous data is still live')
    assert.equal(f.status, 'ok')
    assert.equal(f.last_error, 'Upload cancelled')
    // A commit that arrives after the abort (it was slower on the wire) changes nothing.
    const c = await commit('cancel', load)
    assert.equal(c.status, 400)
    f = await facts('cancel')
    assert.equal(f.streets, 'KEEP')
    assert.equal(f.record_count, 2)
})

// Rename (#108, item 4). The page sends only { name }; nothing else on the source may change.
const patch = (src, body) => call('PATCH /dispatcher/address/sources/:sourceid', { sourceid: src }, body)
const row = async (src) => (await raw(`
    SELECT name, mapping, status_keep, data_as_of, record_count, status, last_error,
           (SELECT count(*)::int FROM dispatcher_address_rows r WHERE r.source_id = s.id AND r.active) AS live_rows
    FROM dispatcher_address_sources s WHERE s.id = '${src}'`))[0]

test('rename: only the name changes; the records, mapping, filter and as-of date stay', async () => {
    await source('ren')
    await raw(`UPDATE dispatcher_address_sources SET mapping = '{"house_number":"NUM"}'::jsonb, status_keep = '["CURRENT"]'::jsonb WHERE id = 'ren'`)
    await live('ren', [point(1, 'Oak'), point(2, 'Oak')])
    const before = await row('ren')
    const r = await patch('ren', { name: '  North region  ' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.source.name, 'North region', 'the name is saved, trimmed')
    const after = await row('ren')
    assert.equal(after.name, 'North region')
    assert.deepEqual(after.mapping, before.mapping)
    assert.deepEqual(after.status_keep, before.status_keep)
    assert.equal(after.data_as_of.getTime(), before.data_as_of.getTime())
    assert.equal(after.record_count, 2)
    assert.equal(after.live_rows, 2, 'the loaded records are still searchable')
    assert.equal(after.status, 'ok')
})

test('rename: a blank name is refused and the old name kept', async () => {
    await source('blank')
    const r = await patch('blank', { name: '   ' })
    assert.equal(r.status, 400)
    assert.equal((await row('blank')).name, 'blank')
})

test('rename sent while a load is being committed: the rename waits, and the load\'s as-of date and count are kept', async () => {
    await source('renrace')
    const load = await stage('renrace', [point(1, 'Pine'), point(2, 'Pine')])
    assert.equal((await row('renrace')).data_as_of, null, 'no load has gone live yet')

    let reached, release
    const atCount = new Promise(r => { reached = r })
    const gate = new Promise(r => { release = r })
    afterStatement = async (text) => {
        if (text.includes('count(*)::int AS n FROM dispatcher_address_rows')) { afterStatement = async () => {}; reached(); await gate }
    }
    const committing = commit('renrace', load)
    await atCount
    let renamed = false
    const renaming = patch('renrace', { name: 'Pine county' }).then(r => { renamed = true; return r })
    await Promise.race([renaming, new Promise(r => setTimeout(r, 1000))])
    const renameWaited = !renamed
    release()
    assert.equal((await committing).status, 200)
    const r = await renaming
    assert.equal(r.status, 200, JSON.stringify(r.body))

    const f = await row('renrace')
    assert.equal(f.name, 'Pine county')
    assert.notEqual(f.data_as_of, null, 'the commit\'s as-of date was not put back to the value the rename read')
    assert.equal(f.record_count, 2)
    assert.equal(f.live_rows, 2)
    assert.equal(f.status, 'ok')
    assert.equal(renameWaited, true, 'the rename waits for the running commit')
})

test('regression, Replace file still saves a new mapping and filter, and can clear the filter', async () => {
    await source('remap')
    let r = await patch('remap', { mapping: { house_number: 'ADDR_NUM' }, status_keep: ['ACTIVE'] })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    let f = await row('remap')
    assert.deepEqual(f.mapping, { house_number: 'ADDR_NUM' })
    assert.deepEqual(f.status_keep, ['ACTIVE'])
    assert.equal(f.name, 'remap', 'the name is not touched')
    r = await patch('remap', { mapping: { house_number: 'NUM' }, status_keep: null })
    assert.equal(r.status, 200)
    f = await row('remap')
    assert.deepEqual(f.mapping, { house_number: 'NUM' })
    assert.equal(f.status_keep, null, 'null clears the filter, as the page sends it')
    // A web source's address and interval.
    r = await patch('remap', { url: 'https://example.org/a.csv', refresh_hours: 12, data_as_of: '2026-01-02T12:00:00Z' })
    assert.equal(r.status, 200)
    const w = (await raw(`SELECT url, refresh_hours, data_as_of FROM dispatcher_address_sources WHERE id = 'remap'`))[0]
    assert.equal(w.url, 'https://example.org/a.csv')
    assert.equal(w.refresh_hours, 12)
    assert.equal(w.data_as_of.toISOString(), '2026-01-02T12:00:00.000Z')
    assert.equal((await patch('remap', { url: 'ftp://x' })).status, 400)
})
