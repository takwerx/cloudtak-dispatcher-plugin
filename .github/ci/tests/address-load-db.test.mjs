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

    const during = await state('race', load)
    assert.equal(during.body?.state, 'committing', 'the page can see the commit is still running')

    let abortDone = false
    const aborting = abort('race', load).then(r => { abortDone = true; return r })
    await Promise.race([aborting, new Promise(r => setTimeout(r, 1500))])
    assert.equal(abortDone, false, 'the abort waits for the running commit instead of deleting its rows')
    release()

    const c = await committing
    const a = await aborting
    assert.equal(c.status, 200, JSON.stringify(c.body))
    assert.equal(a.body.cancelled, false, 'the abort found the load live and left it alone')
    const f = await facts('race')
    assert.equal(f.live_rows, 3, 'the new rows are live')
    assert.equal(f.record_count, f.live_rows, 'the count shown matches the rows there')
    assert.equal(f.all_rows, 3, 'the old rows are gone, nothing staged is left behind')
    assert.equal(f.streets, 'NEW')
    assert.equal(f.status, 'ok')
    assert.equal(f.last_error, null, 'a good load is not marked Upload cancelled')
    assert.equal((await state('race', load)).body.state, 'live')
})

test('abort sent after a slow commit already finished (the case seen in #108): no Upload cancelled', async () => {
    await source('late')
    const load = await stage('late', [point(1, 'Elm'), point(2, 'Elm')])
    assert.equal((await state('late', load)).body.state, 'staged')
    assert.equal((await commit('late', load)).status, 200)
    const a = await abort('late', load)
    assert.equal(a.status, 200)
    assert.equal(a.body.cancelled, false)
    const f = await facts('late')
    assert.equal(f.live_rows, 2)
    assert.equal(f.record_count, 2)
    assert.equal(f.status, 'ok')
    assert.equal(f.last_error, null, 'the source must not say Upload cancelled after a good load')
    const st = (await state('late', load)).body
    assert.equal(st.state, 'live', 'the page asking afterwards learns the load is live')
    assert.equal(st.source.record_count, 2)
})

test('a real cancel still works: staged rows go, the previous data stays, a later commit is refused', async () => {
    await source('cancel')
    await live('cancel', [point(1, 'Keep'), point(2, 'Keep')])
    const load = await stage('cancel', [point(1, 'Drop'), point(2, 'Drop'), point(3, 'Drop')])
    const a = await abort('cancel', load)
    assert.equal(a.body.cancelled, true)
    let f = await facts('cancel')
    assert.equal(f.all_rows, 2, 'the staged rows are thrown away')
    assert.equal(f.streets, 'KEEP', 'the previous data is still live')
    assert.equal(f.status, 'ok')
    assert.equal(f.last_error, 'Upload cancelled')
    assert.equal((await state('cancel', load)).body.state, 'gone')
    // A commit that arrives after the abort (it was slower on the wire) changes nothing.
    const c = await commit('cancel', load)
    assert.equal(c.status, 400)
    f = await facts('cancel')
    assert.equal(f.streets, 'KEEP')
    assert.equal(f.record_count, 2)
})
