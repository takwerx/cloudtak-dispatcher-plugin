// Proof tests for the broadcast-to-channel delivery (ops #410): the logic that lives in code,
// not on screen. Run: node --import ./.github/ci/tests/register.mjs --test .github/ci/tests/
// Needs node 22.18+ (runs the plugin's .ts files directly).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const fd = await import('../../../plugin/lib/field-delivery.ts')
const mm = await import('../../../plugin/lib/map-marker.ts')
const cw = await import('../../../plugin/lib/closed-window.ts')
const cc = await import('../../../plugin/lib/contacts-client.ts')

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

test('close: the admin-set window (closed_marker_minutes) replaces the 60 minutes; 0 ends a minute from now', async () => {
    const closedAt = '2026-11-01T21:00:00.000Z'
    try {
        cw.setClosedMarkerMinutes(cw.closedMarkerMinutesFrom({ closed_marker_minutes: 15 }))
        await fd.closeIncidentInField(mapStore(), incident({ coreEventId: 'core-2a', closedAt }))
        assert.equal(writes().find(c => c.url === '/api/core/event/core-2a').body.ended,
            new Date(Date.parse(closedAt) + 15 * MINUTE).toISOString())

        cw.setClosedMarkerMinutes(1440)
        await fd.closeIncidentInField(mapStore(), incident({ coreEventId: 'core-2b', closedAt }))
        assert.equal(writes().find(c => c.url === '/api/core/event/core-2b').body.ended,
            new Date(Date.parse(closedAt) + 1440 * MINUTE).toISOString())

        const t0 = Date.now()
        cw.setClosedMarkerMinutes(0)
        await fd.closeIncidentInField(mapStore(), incident({ coreEventId: 'core-2c', closedAt }))
        const ended = Date.parse(writes().find(c => c.url === '/api/core/event/core-2c').body.ended)
        assert.ok(ended >= t0 + 59 * 1000 && ended <= Date.now() + 61 * 1000, 'about a minute out, not in the past')

        // a withdraw of that 0-minute close must not push `ended` back out
        await fd.withdrawIncident(mapStore(), incident({ coreEventId: 'core-2c', closedAt }))
        assert.equal(writes().filter(c => c.url === '/api/core/event/core-2c').length, 1)
    } finally {
        cw.setClosedMarkerMinutes(cw.CLOSED_MARKER_MINUTES_DEFAULT)
    }
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

test('withdraw goes by the end time the Core Event really has, not by today\'s window', async () => {
    // closed 10 minutes ago under a 5-minute window, so its marker ended 5 minutes ago; the admin has
    // since set the window to 60 minutes. A recomputed end time (closed + 60) would look "later
    // than a minute from now" and pull the dead marker back onto devices for a minute.
    const closedAt = new Date(Date.now() - 10 * MINUTE).toISOString()
    const stored = new Date(Date.parse(closedAt) + 5 * MINUTE).toISOString()
    globalThis.__respond = (url, opts) => url === '/api/core/event/core-7' && opts.method === 'GET' ? { ended: stored } : respond(url, opts)
    await fd.withdrawIncident(mapStore(), incident({ coreEventId: 'core-7', closedAt }))
    assert.equal(writes().length, 0, 'an already-ended marker is left alone')

    // stored end time is far out (closed a minute ago under a 60-minute window): still pulled in
    const closedNow = new Date(Date.now() - MINUTE).toISOString()
    const farOut = new Date(Date.parse(closedNow) + 60 * MINUTE).toISOString()
    globalThis.__respond = (url, opts) => url === '/api/core/event/core-8' && opts.method === 'GET' ? { ended: farOut } : respond(url, opts)
    await fd.withdrawIncident(mapStore(), incident({ coreEventId: 'core-8', closedAt: closedNow }))
    assert.equal(writes().filter(c => c.url === '/api/core/event/core-8').length, 1)

    // CloudTAK can't be read: fall back to the end time the current window gives
    globalThis.__respond = (url, opts) => { if (opts.method === 'GET') throw new Error('offline'); return respond(url, opts) }
    await fd.withdrawIncident(mapStore(), incident({ coreEventId: 'core-9', closedAt: new Date(Date.now() - 59 * MINUTE).toISOString() }))
    assert.equal(writes().filter(c => c.url === '/api/core/event/core-9').length, 0)
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
        callers: [{ name: 'Pat Doe', phone: '+1 555 010 2999', primary: true }] }))
    const withCaller = writes().find(c => c.method === 'PATCH' && c.url === '/api/core/event/core-5')
    assert.match(withCaller.body.remarks, /\| Caller: Pat Doe · \+1 555 010 2999 \|/)
    globalThis.__calls = []
    await fd.showIncident(mapStore(), incident({ uid: 'b-caller', coreEventId: 'core-5', callers: [] }))
    const cleared = writes().find(c => c.method === 'PATCH' && c.url === '/api/core/event/core-5')
    assert.ok(!/Caller/.test(cleared.body.remarks), 'a cleared caller (or Caller Details off) leaves no caller in the remarks')
})

test('broadcast + two callers: the Core Event remarks carry both, primary first, on create and on update', async () => {
    const callers = [
        { name: 'Sam Lee', phone: '555 010 3000', note: 'neighbour', primary: false },
        { name: 'Pat Doe', phone: '+1 555 010 2999', primary: true },
    ]
    const expected = /\| Callers: Pat Doe · \+1 555 010 2999 \(primary\); Sam Lee · 555 010 3000 — neighbour \|/
    await fd.showIncident(mapStore(), incident({ uid: 'b-two', callers }))
    const post = writes().find(c => c.method === 'POST' && c.url === '/api/core/event')
    assert.match(post.body.remarks, expected, 'create carries both callers, primary first')
    globalThis.__calls = []
    await fd.showIncident(mapStore(), incident({ uid: 'b-two', coreEventId: 'core-9', callers }))
    const patch = writes().find(c => c.method === 'PATCH' && c.url === '/api/core/event/core-9')
    assert.match(patch.body.remarks, expected, 'an update carries both callers too')
    globalThis.__calls = []
    await fd.showIncident(mapStore(), incident({ uid: 'b-two', coreEventId: 'core-9', callers: callers.slice(0, 1) }))
    const one = writes().find(c => c.method === 'PATCH' && c.url === '/api/core/event/core-9')
    assert.ok(!/Pat Doe/.test(one.body.remarks) && /Caller: Sam Lee/.test(one.body.remarks), 'removing the primary leaves the other caller only')
})

// --- TAK-CAD routes: who may use a connection (ops #1201) -------------------------------------
// Loads the real server/plugin-takcad.ts. CloudTAK's auth, node-tak and typebox are the stand-ins in
// ./stubs; the access rule in stubs/cloudtak-auth.mjs is a copy of CloudTAK's own Auth.is_connection.

const takcad = await import('../../../server/plugin-takcad.ts')

const ROUTES = ['GET /marti/plugins/takcad/submit', 'POST /marti/plugins/takcad/submit',
    'PUT /marti/plugins/takcad/submit/result', 'DELETE /marti/plugins/takcad/submit']

const loadRoutes = async () => {
    const routes = {}
    const schema = {}
    for (const m of ['get', 'post', 'put', 'delete']) {
        schema[m] = async (path, _opts, handler) => { routes[`${m.toUpperCase()} ${path}`] = handler }
    }
    await takcad.default(schema, { server: { api: 'https://tak.example:8443' },
        // The admin's "who can use the Dispatcher" list, read per request (ops #1257): globalThis.__limit, none by default.
        pg: { execute: async () => globalThis.__limit === undefined ? [] : [{ value: globalThis.__limit }] },
        models: {
        Profile: { from: async (email) => globalThis.__profiles[email] },
        // Plain row lookup, as CloudTAK's model gives it.
        Connection: { from: async (id) => globalThis.__connections[id] },
    } })
    return routes
}

const callRoute = async (handler, query) => {
    const out = { status: 200, body: undefined }
    const res = { status(s) { out.status = s; return res }, json(b) { out.body = b; return res } }
    await handler({ query, body: { x: 1 } }, res)
    return out
}

const signIn = (email) => { globalThis.__caller = { email, is_admin: () => globalThis.__profiles[email]?.system_admin === true } }

beforeEach(() => {
    globalThis.__tak = { clients: [], requests: [] }
    globalThis.__limit = undefined
    globalThis.__groupsByCert = {}
    globalThis.__connections = {
        5: { id: 5, agency: 100, auth: { cert: 'CERT-AGENCY-100', key: 'KEY-100' } },
        6: { id: 6, agency: 200, auth: { cert: 'CERT-AGENCY-200', key: 'KEY-200' } },
        7: { id: 7, agency: null, auth: { cert: 'CERT-NO-AGENCY', key: 'KEY-7' } },
    }
    globalThis.__profiles = {
        'sys@x': { email: 'sys@x', system_admin: true, auth: { cert: 'CERT-SYS', key: 'K' } },
        'agency100@x': { email: 'agency100@x', system_admin: false, agency_admin: [100], auth: { cert: 'CERT-OWN-100', key: 'K' } },
        'plain@x': { email: 'plain@x', system_admin: false, agency_admin: null, auth: { cert: 'CERT-OWN-PLAIN', key: 'K' } },
        'notyet@x': { email: 'notyet@x', system_admin: false, agency_admin: null, auth: null },
    }
})

const queryFor = (_route, extra = {}) => ({ fn: 'getIncidents', uid: 'u-1', ...extra })

test('TAK-CAD: all four proxy routes are registered', async () => {
    const routes = await loadRoutes()
    for (const r of ROUTES) assert.equal(typeof routes[r], 'function', `${r} is registered`)
})

test('TAK-CAD: a user who does not administer the connection\'s agency is refused on every route, and nothing reaches TAK Server', async () => {
    const routes = await loadRoutes()
    for (const who of ['plain@x', 'agency100@x']) {
        signIn(who)
        for (const r of ROUTES) {
            // agency100 may use connection 5 but not 6 (other agency) or 7 (no agency); plain may use none
            const refused = who === 'plain@x' ? [5, 6, 7] : [6, 7]
            for (const id of refused) {
                globalThis.__tak = { clients: [], requests: [] }
                const out = await callRoute(routes[r], queryFor(r, { connection: id }))
                assert.equal(out.status, 401, `${who} on ${r} connection ${id}: refused`)
                assert.deepEqual(globalThis.__tak.requests, [], `${who} on ${r} connection ${id}: no request sent to TAK Server`)
                assert.deepEqual(globalThis.__tak.clients, [], `${who} on ${r} connection ${id}: no certificate used`)
            }
        }
    }
})

test('TAK-CAD: an agency admin and a system admin can use the connections they administer, with that connection\'s certificate', async () => {
    const routes = await loadRoutes()
    for (const r of ROUTES) {
        signIn('agency100@x')
        globalThis.__tak = { clients: [], requests: [] }
        let out = await callRoute(routes[r], queryFor(r, { connection: 5 }))
        assert.equal(out.status, 200, `agency admin on ${r}`)
        assert.deepEqual(globalThis.__tak.requests.map(q => q.cert), ['CERT-AGENCY-100'], `agency admin on ${r} uses connection 5's certificate`)

        signIn('sys@x')
        for (const [id, cert] of [[5, 'CERT-AGENCY-100'], [6, 'CERT-AGENCY-200'], [7, 'CERT-NO-AGENCY']]) {
            globalThis.__tak = { clients: [], requests: [] }
            out = await callRoute(routes[r], queryFor(r, { connection: id }))
            assert.equal(out.status, 200, `system admin on ${r} connection ${id}`)
            assert.deepEqual(globalThis.__tak.requests.map(q => q.cert), [cert], `system admin on ${r} connection ${id} uses its certificate`)
        }
    }
})

test('TAK-CAD: with no connection given, every route still uses the caller\'s own certificate (the way the plugin calls them)', async () => {
    const routes = await loadRoutes()
    for (const who of ['plain@x', 'agency100@x', 'sys@x']) {
        signIn(who)
        for (const r of ROUTES) {
            globalThis.__tak = { clients: [], requests: [] }
            const out = await callRoute(routes[r], queryFor(r))
            assert.equal(out.status, 200, `${who} on ${r}`)
            assert.deepEqual(globalThis.__tak.requests.map(q => q.cert), [globalThis.__profiles[who].auth.cert], `${who} on ${r} uses their own certificate`)
        }
    }
})

test('TAK-CAD: a signed-in user who has not logged in to CloudTAK yet is still told so, and a request with no sign-in is refused', async () => {
    const routes = await loadRoutes()
    signIn('notyet@x')
    const out = await callRoute(routes[ROUTES[0]], queryFor(ROUTES[0]))
    assert.equal(out.status, 401)
    assert.match(out.body.message, /not yet logged in/)
    globalThis.__caller = undefined
    const anon = await callRoute(routes[ROUTES[0]], queryFor(ROUTES[0], { connection: 5 }))
    assert.equal(anon.status, 401)
    assert.deepEqual(globalThis.__tak.requests, [])
})

// --- assignment and update chat messages on CloudTAK 14.0.x and 14.1.0 (ops #1211) -------------
// 14.1.0 (Chatroom Revamp) changed the chat code: a room is made with Chatroom.direct({uid, callsign})
// and send() takes (message, sender, opts). The plugin's old call (new Chatroom(callsign), send with a
// worker and a contact) fails the type check on 14.1.0 and the stub below throws the way 14.1.0 would.

const CONTACT = { uid: 'ANDROID-abc', callsign: 'Engine 7' }
const INC = { name: '26-001 Fire', address: '1 Main St' }
const SENDER = { uid: 'ANDROID-CloudTAK-tester', callsign: 'tester' }

const withChatroom = (version) => { globalThis.__chatroomVersion = version; globalThis.__sent = []; globalThis.__rooms = []; globalThis.__serverRefuses = false }

test('chat on CloudTAK 14.1.0: an assignment message goes to the contact\'s direct room, with two arguments', async () => {
    withChatroom('14.1.0')
    const ms = mapStore()
    await cc.sendAssignmentMessage(ms, CONTACT, INC)
    assert.equal(globalThis.__sent.length, 1, 'exactly one chat is sent')
    const [s] = globalThis.__sent
    assert.equal(s.version, '14.1.0')
    assert.equal(s.room, 'room-ANDROID-abc', 'sent to the direct room made for the contact uid')
    assert.equal(s.message, 'You have been assigned to: 26-001 Fire at 1 Main St. Incident on your map.')
    assert.deepEqual(s.sender, SENDER)
})

test('chat on CloudTAK 14.1.0: an update message reaches the same room as the assignment', async () => {
    withChatroom('14.1.0')
    await cc.sendAssignmentMessage(mapStore(), CONTACT, INC)
    await cc.sendUpdateMessage(mapStore(), CONTACT, { name: '26-001 Fire' }, 'Location changed to 2 Oak St')
    assert.equal(globalThis.__sent.length, 2)
    assert.equal(globalThis.__sent[1].room, globalThis.__sent[0].room, 'one room per contact, not a new room per message')
    assert.equal(globalThis.__sent[1].message, 'UPDATE \u2014 26-001 Fire: Location changed to 2 Oak St')
    assert.equal(globalThis.__rooms.length, 1)
})

test('chat on CloudTAK 14.1.0: a message the server refuses is reported to the caller, not lost silently', async () => {
    withChatroom('14.1.0')
    globalThis.__serverRefuses = true
    await assert.rejects(() => cc.sendAssignmentMessage(mapStore(), CONTACT, INC), /was not sent/)
})

test('chat on CloudTAK 14.0.x: still sent the old way (room named by callsign, worker and contact passed)', async () => {
    withChatroom('14.0.x')
    const ms = mapStore()
    await cc.sendAssignmentMessage(ms, CONTACT, INC)
    assert.equal(globalThis.__sent.length, 1)
    const [s] = globalThis.__sent
    assert.equal(s.version, '14.0.x')
    assert.equal(s.room, 'Engine 7')
    assert.equal(s.worker, ms.worker, 'the map worker is passed through')
    assert.deepEqual(s.recipient, CONTACT)
    assert.deepEqual(s.sender, SENDER)
})

// --- Who can use the Dispatcher (ops #1257) -----------------------------------------------------
// With the admin's list on, every TAK-CAD route refuses a user outside the listed TAK groups before it does
// anything, and TAK Server is asked nothing for the request. System admins and members get through as before.

test('limit on: a user outside the listed groups is refused on every TAK-CAD route, and nothing reaches TAK Server', async () => {
    const routes = await loadRoutes()
    globalThis.__limit = ['Fire Dispatch']
    globalThis.__groupsByCert = { 'CERT-OWN-100': ['EMS'] }
    signIn('agency100@x')
    for (const r of ROUTES) {
        globalThis.__tak = { clients: [], requests: [] }
        const out = await callRoute(routes[r], queryFor(r, { connection: 5 }))
        assert.equal(out.status, 403, `${r} is refused`)
        assert.deepEqual(globalThis.__tak.requests, [], `${r} sent nothing to TAK Server`)
    }
})

test('limit on: a member of a listed group (any case) and a system admin use the routes as before', async () => {
    const routes = await loadRoutes()
    globalThis.__limit = ['Fire Dispatch']
    // plain@x, not the user above: the route file keeps a user's groups for a minute, as it does in production.
    globalThis.__groupsByCert = { 'CERT-OWN-PLAIN': ['fire dispatch'] }
    signIn('plain@x')
    for (const r of ROUTES) {
        globalThis.__tak = { clients: [], requests: [] }
        const out = await callRoute(routes[r], queryFor(r))
        assert.equal(out.status, 200, `${r} works for a member`)
        assert.ok(globalThis.__tak.requests.length >= 1, `${r} reached TAK Server`)
    }
    signIn('sys@x')
    for (const r of ROUTES) {
        globalThis.__tak = { clients: [], requests: [] }
        const out = await callRoute(routes[r], queryFor(r, { connection: 6 }))
        assert.equal(out.status, 200, `${r} works for a system admin who is in no listed group`)
    }
})

test('limit off (empty list): the routes work as before for a user in no group', async () => {
    const routes = await loadRoutes()
    globalThis.__limit = []
    signIn('agency100@x')
    for (const r of ROUTES) {
        const out = await callRoute(routes[r], queryFor(r, { connection: 5 }))
        assert.equal(out.status, 200, `${r} works with no limit`)
    }
})
