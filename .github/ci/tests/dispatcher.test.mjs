// Proof tests for the broadcast-to-channel delivery (ops #410): the logic that lives in code,
// not on screen. Run: node --import ./.github/ci/tests/register.mjs --test .github/ci/tests/
// Needs node 22.18+ (runs the plugin's .ts files directly).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const fd = await import('../../../plugin/lib/field-delivery.ts')
const mm = await import('../../../plugin/lib/map-marker.ts')

const MINUTE = 60 * 1000
const incident = (over = {}) => ({
    uid: 'inc-1', number: '26-001', name: 'Structure Fire', type: 'Fire', address: '1 Main St',
    lat: 44.5, lon: -123.2, time: '2026-11-01T20:00:00.000Z', dispatcher: 'Dana', details: 'smoke showing',
    delivery: 'broadcast', channel: 'TAKDEV-EMU', coreEventId: null, closedAt: null, ...over,
})
const mapStore = () => {
    const ops = []
    return { ops, worker: { db: {
        add: async (feat, o) => { ops.push({ op: 'add', feat, o }) },
        remove: async (uid, o) => { ops.push({ op: 'remove', uid, o }) },
    } } }
}
const calls = () => globalThis.__calls
const writes = () => calls().filter(c => c.method !== 'GET')
const respond = (url, opts) => {
    if (url.startsWith('/api/marti/group')) return { data: [{ name: 'OTHER', bitpos: 3 }, { name: 'TAKDEV-EMU', bitpos: 7 }] }
    if (url === '/api/core/event' && opts.method === 'POST') return { id: 'core-1' }
    if (url.startsWith('/api/dispatcher/incidents/')) return { incident: {} }
    return {}
}

beforeEach(() => { globalThis.__calls = []; globalThis.__chats = []; globalThis.__respond = respond })

// --- delivery choice -------------------------------------------------------------------------

test('broadcast: showIncident creates one Core Event shared with the channel and draws no plugin marker', async () => {
    const ms = mapStore()
    await fd.showIncident(ms, incident({ uid: 'b-new' }))
    assert.deepEqual(ms.ops, [], 'no DataSync marker may be dropped for a broadcast incident')
    const post = writes().filter(c => c.url === '/api/core/event')
    assert.equal(post.length, 1, 'exactly one Core Event is created')
    assert.deepEqual(post[0].body.channels, [7], 'shared with the channel bitpos')
    assert.equal(post[0].body.editable, true)
    assert.equal(post[0].body.ended, null)
    assert.equal(post[0].body.name, '26-001 Structure Fire')
    assert.deepEqual(post[0].body.geometry.coordinates, [-123.2, 44.5])
    assert.equal(post[0].body.metadata.incident, 'b-new')
    // the new Core Event id is saved on the incident so later updates PATCH instead of creating again
    const save = writes().find(c => c.url === '/api/dispatcher/incidents/b-new')
    assert.deepEqual(save.body, { core_event_id: 'core-1' }, 'the Core Event id is saved back on the incident')
})

test('broadcast: never asks for a DataSync feed (no feed log, no feed chat, no mission calls)', async () => {
    await mm.postMissionCallLog('', incident())
    await mm.postFeedChat(mapStore(), { guid: '', name: '' }, 'hello')
    assert.equal(calls().length, 0, 'an empty feed makes no request')
    assert.equal(globalThis.__chats.length, 0, 'an empty feed sends no chat')
    await fd.showIncident(mapStore(), incident({ uid: 'b-nofeed', feedGuid: undefined }))
    assert.ok(!calls().some(c => c.url.includes('/missions')), 'no mission/feed request in broadcast mode')
})

test('feed log and feed chat still work for a real DataSync feed', async () => {
    await mm.postMissionCallLog('My Feed', incident())
    assert.equal(calls()[0].url, '/api/marti/missions/My%20Feed/log')
    await mm.postFeedChat(mapStore(), { guid: 'g-1', name: 'My Feed' }, 'hello')
    assert.deepEqual(globalThis.__chats, [{ guid: 'g-1', name: 'My Feed', message: 'hello' }])
})

test('broadcast: a second update PATCHes the same Core Event, never creates another', async () => {
    const ms = mapStore()
    await fd.showIncident(ms, incident({ uid: 'b-twice' }))
    await fd.showIncident(ms, incident({ uid: 'b-twice', name: 'Structure Fire (2nd alarm)' }))   // board hasn't returned the id yet
    const posts = writes().filter(c => c.method === 'POST' && c.url === '/api/core/event')
    assert.equal(posts.length, 1, 'one create only')
    const patch = writes().find(c => c.method === 'PATCH' && c.url === '/api/core/event/core-1')
    assert.ok(patch, 'second update goes to the known Core Event')
})

test('broadcast: updating a known Core Event sends no channels or editable (403 for non-creators)', async () => {
    await fd.showIncident(mapStore(), incident({ coreEventId: 'core-9' }))
    const patch = writes().find(c => c.url === '/api/core/event/core-9')
    assert.equal(patch.method, 'PATCH')
    assert.ok(!('channels' in patch.body), 'channels must not be sent on update')
    assert.ok(!('editable' in patch.body), 'editable must not be sent on update')
    assert.ok(!calls().some(c => c.url.startsWith('/api/marti/group')), 'no channel lookup needed on update')
})

test('broadcast without a channel is refused before anything is sent', async () => {
    await assert.rejects(fd.showIncident(mapStore(), incident({ uid: 'b-nochan', channel: null })), /no channel/)
    assert.equal(writes().length, 0)
})

test('unknown channel is refused and the channel list is re-read next time', async () => {
    await assert.rejects(fd.showIncident(mapStore(), incident({ uid: 'b-badchan', channel: 'NOPE' })), /not found/)
    assert.equal(writes().length, 0)
    const before = calls().filter(c => c.url.startsWith('/api/marti/group')).length
    await fd.showIncident(mapStore(), incident({ uid: 'b-goodchan' }))
    assert.equal(calls().filter(c => c.url.startsWith('/api/marti/group')).length, before + 1)
})

test('datasync: showIncident drops the plugin marker and touches no Core Event', async () => {
    const ms = mapStore()
    await fd.showIncident(ms, incident({ delivery: 'datasync', feedGuid: 'feed-1', channel: null }))
    assert.equal(ms.ops.length, 1)
    assert.equal(ms.ops[0].op, 'add')
    assert.deepEqual(ms.ops[0].feat.origin, { mode: 'Mission', mode_id: 'feed-1' })
    assert.equal(calls().length, 0)
    // an incident with no delivery field at all (older rows) is DataSync too
    const ms2 = mapStore()
    await fd.showIncident(ms2, incident({ delivery: undefined }))
    assert.equal(ms2.ops.length, 1)
    assert.equal(calls().length, 0)
})

test('long names are cut to the 64 characters CloudTAK allows', async () => {
    await fd.showIncident(mapStore(), incident({ uid: 'b-long', name: 'x'.repeat(100) }))
    assert.equal(writes().find(c => c.url === '/api/core/event').body.name.length, 64)
})

// --- close / reopen / withdraw ---------------------------------------------------------------

test('close: name starts with CLOSED and ended is closed time + 60 minutes', async () => {
    const closedAt = '2026-11-01T21:00:00.000Z'
    await fd.closeIncidentInField(mapStore(), incident({ coreEventId: 'core-2', closedAt }))
    const patch = writes().find(c => c.url === '/api/core/event/core-2')
    assert.equal(patch.body.name, 'CLOSED 26-001 Structure Fire')
    assert.equal(patch.body.ended, new Date(Date.parse(closedAt) + 60 * MINUTE).toISOString())
})

test('close with no closedAt yet stamps now, so ended is about an hour out', async () => {
    const t0 = Date.now()
    await fd.closeIncidentInField(mapStore(), incident({ coreEventId: 'core-3' }))
    const ended = Date.parse(writes().find(c => c.url === '/api/core/event/core-3').body.ended)
    assert.ok(ended >= t0 + 60 * MINUTE && ended <= Date.now() + 60 * MINUTE)
})

test('reopen: the CLOSED prefix goes and ended is cleared (null)', async () => {
    await fd.showIncident(mapStore(), incident({ coreEventId: 'core-4', closedAt: null }))
    const patch = writes().find(c => c.url === '/api/core/event/core-4')
    assert.equal(patch.body.name, '26-001 Structure Fire')
    assert.equal(patch.body.ended, null, 'null is sent so CloudTAK clears ended')
    assert.ok('ended' in patch.body)
})

test('close in datasync mode still removes the marker (as before)', async () => {
    const ms = mapStore()
    await fd.closeIncidentInField(ms, incident({ delivery: 'datasync' }))
    assert.deepEqual(ms.ops, [{ op: 'remove', uid: 'inc-1', o: { mission: true } }])
    assert.equal(calls().length, 0)
})

test('withdraw: ends the Core Event about a minute out', async () => {
    const t0 = Date.now()
    await fd.withdrawIncident(mapStore(), incident({ coreEventId: 'core-5' }))
    const patch = writes().find(c => c.url === '/api/core/event/core-5')
    assert.deepEqual(Object.keys(patch.body), ['ended'])
    const ended = Date.parse(patch.body.ended)
    assert.ok(ended >= t0 + 59 * 1000 && ended <= Date.now() + 61 * 1000)
})

test('withdraw never pushes a closed incident\'s end time later', async () => {
    const closedAt = new Date(Date.now() - 59 * MINUTE).toISOString()   // ends in about 1 minute or less
    await fd.withdrawIncident(mapStore(), incident({ coreEventId: 'core-6', closedAt }))
    assert.equal(writes().length, 0)
    const longClosed = new Date(Date.now() - 5 * MINUTE).toISOString()   // ends in 55 minutes: pull it in
    await fd.withdrawIncident(mapStore(), incident({ coreEventId: 'core-6', closedAt: longClosed }))
    assert.equal(writes().length, 1)
})

test('withdraw with no Core Event does nothing', async () => {
    await fd.withdrawIncident(mapStore(), incident({ uid: 'never-sent' }))
    assert.equal(calls().length, 0)
})

// --- remarks / marker --------------------------------------------------------------------------

test('buildRemarks joins type, start, dispatcher and details, skipping blanks', () => {
    const r = mm.buildRemarks(incident())
    assert.match(r, /^Fire \| Start: \d\d:\d\d \| Dispatcher: Dana \| smoke showing$/)
    assert.equal(mm.buildRemarks(incident({ dispatcher: '', details: '' })).split(' | ').length, 2)
})

// --- both features together (caller details from ops #403 + broadcast from ops #410) ----------

test('broadcast + caller details: the Core Event remarks carry the caller, and clearing it removes it', async () => {
    await fd.showIncident(mapStore(), incident({ uid: 'b-caller', coreEventId: 'core-5',
        callerName: 'Pat Doe', callerPhone: '+1 555 010 2999' }))
    const withCaller = writes().find(c => c.method === 'PATCH' && c.url === '/api/core/event/core-5')
    assert.match(withCaller.body.remarks, /\| Caller: Pat Doe · \+1 555 010 2999 \|/)
    globalThis.__calls = []
    await fd.showIncident(mapStore(), incident({ uid: 'b-caller', coreEventId: 'core-5', callerName: '', callerPhone: '' }))
    const cleared = writes().find(c => c.method === 'PATCH' && c.url === '/api/core/event/core-5')
    assert.ok(!/Caller/.test(cleared.body.remarks), 'a cleared caller (or Caller Details off) leaves no caller in the remarks')
})
