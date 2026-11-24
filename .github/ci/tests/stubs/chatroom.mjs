// Stand-in for CloudTAK's src/base/chatroom.ts (ops #1211). It behaves like CloudTAK 14.1.0 or like
// 14.0.x, whichever globalThis.__chatroomVersion says, and is as strict as the real one about what it
// is given, so a call written for the other version fails the way it does in CloudTAK.
// Every send is recorded in globalThis.__sent.
//   14.1.0: new Chatroom({id, name, type}); static direct({uid, callsign}); chats.send(message, sender, opts?)
//   14.0.x: new Chatroom(name);             chats.send(message, sender, worker, recipient?)
const rooms = () => (globalThis.__rooms ??= [])
const sent = () => (globalThis.__sent ??= [])

class Chats {
    constructor(room) { this.room = room }
    async send(message, sender, third, fourth) {
        if (globalThis.__chatroomVersion === '14.1.0') {
            // 14.1.0 takes (message, sender, opts): a worker as the third argument is not options,
            // and a fourth argument does not exist (vue-tsc TS2554 on the old call).
            if (arguments.length > 3) throw new TypeError('14.1.0 send() takes 2 or 3 arguments')
            if (typeof this.room.id !== 'string') throw new TypeError('14.1.0 chat needs a room id (got a room name)')
            const failed = globalThis.__serverRefuses === true
            sent().push({ version: '14.1.0', room: this.room.id, message, sender, status: failed ? 'failed' : 'sent' })
            this.room.store.push({ sender_uid: sender.uid, message, status: failed ? 'failed' : 'sent' })
            return // like the real send(): never throws when the server refuses
        }
        sent().push({ version: '14.0.x', room: this.room.name, message, sender, worker: third, recipient: fourth })
    }
    async list() { return this.room.store }
}

export default class Chatroom {
    constructor(room) {
        if (globalThis.__chatroomVersion === '14.1.0') {
            // 14.1.0 reads room.id, room.name and room.type: a callsign string gives undefined for all three (TS2345).
            if (typeof room !== 'object' || room === null) throw new TypeError('14.1.0 Chatroom needs {id, name, type}, got ' + typeof room)
            Object.assign(this, { id: room.id, name: room.name, type: room.type })
        } else {
            this.name = room
        }
        this.store = []
        this.chats = new Chats(this)
    }
}

// Chatroom.direct exists only in 14.1.0 and newer: under 14.0.x the property reads undefined.
async function direct(contact) {
    if (!contact || typeof contact.uid !== 'string' || typeof contact.callsign !== 'string') throw new TypeError('direct needs {uid, callsign}')
    let room = rooms().find(r => r.contactUid === contact.uid)
    if (!room) {
        room = new Chatroom({ id: `room-${contact.uid}`, name: contact.callsign, type: 'direct' })
        room.contactUid = contact.uid
        rooms().push(room)
    }
    return room
}
Object.defineProperty(Chatroom, 'direct', { get: () => (globalThis.__chatroomVersion === '14.1.0' ? direct : undefined) })
