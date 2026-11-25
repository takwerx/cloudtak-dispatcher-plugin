import { std } from '../../../src/std.ts';
import Chatroom from '../../../src/base/chatroom.ts';
import ProfileConfig from '../../../src/base/profile.ts';
import type { useMapStore } from '../../../src/stores/map.ts';

type MapStore = ReturnType<typeof useMapStore>;

export interface TakContact {
    uid:      string;
    callsign: string;
    lastSeen?: string;
}

// CloudTAK proxies TAK Server's /Marti/api/contacts/all at /api/marti/api/contacts/all
// (route is /marti/api/contacts/all, mounted under /api). Returns a bare JSON array.
// TAK Server interleaves an empty placeholder entry (callsign:"", uid:"", notes:" admin")
// between every real contact, so filter to entries that actually have a uid + callsign.
export async function getContacts(): Promise<TakContact[]> {
    const resp = await std('/api/marti/api/contacts/all', { method: 'GET' }) as TakContact[] | null;
    return Array.isArray(resp) ? resp.filter(c => c && c.uid && c.callsign) : [];
}

// Build the dispatcher's GeoChat sender identity from the CloudTAK profile.
async function dispatcherSender(): Promise<{ uid: string; callsign: string }> {
    const username = (await ProfileConfig.get('username'))?.value;
    const myCallsign = (await ProfileConfig.get('tak_callsign'))?.value;
    return {
        uid:      username ? `ANDROID-CloudTAK-${username}` : 'ANDROID-CloudTAK-dispatcher',
        callsign: String(myCallsign || 'Dispatcher'),
    };
}

// CloudTAK changed its chat code in 14.1.0 (Chatroom Revamp, ops #1211), and users run either one:
//   14.0.x and older: new Chatroom(callsign), then room.chats.send(message, sender, worker, contact)
//   14.1.0 and newer: await Chatroom.direct(contact), then room.chats.send(message, sender)
// Chatroom.direct only exists in 14.1.0 and newer, so its presence picks the path. Both are typed
// loosely here on purpose: the plugin must pass `npm run check` against either CloudTAK version,
// and a typed call to one of them fails the build on the other.
type ChatContact = { uid: string; callsign: string };
type ChatSender = { uid: string; callsign: string };
type ChatRoom = {
    chats: {
        send: (...args: unknown[]) => Promise<void>;
        list: () => Promise<Array<{ sender_uid: string; message: string; status?: string }>>;
    };
};
export type ChatroomClass = {
    new (name: string): ChatRoom;
    direct?: (contact: ChatContact) => Promise<ChatRoom>;
};

// Send a direct GeoChat to a contact via CloudTAK's Chatroom, the same path MenuChat.vue uses.
// The old POST /api/marti/chats had no backing route and silently failed.
export async function sendDirectChatWith(
    Room: ChatroomClass,
    worker: unknown,
    sender: ChatSender,
    contact: ChatContact,
    message: string
): Promise<void> {
    if (typeof Room.direct === 'function') {
        const room = await Room.direct({ uid: contact.uid, callsign: contact.callsign });
        await room.chats.send(message, sender);

        // 14.1.0 send() does not throw when the server refuses the message: it stores the chat as
        // failed. Throw here so the caller's catch sees it, instead of losing the message silently.
        const sent = (await room.chats.list())
            .filter(c => c.sender_uid === sender.uid && c.message === message)
            .pop();
        if (sent?.status === 'failed') throw new Error(`Chat to ${contact.callsign} was not sent`);
        return;
    }

    const room = new Room(contact.callsign);
    await room.chats.send(message, sender, worker, { uid: contact.uid, callsign: contact.callsign });
}

async function sendDirectChat(
    mapStore: MapStore,
    contact: { uid: string; callsign: string },
    message: string
): Promise<void> {
    const sender = await dispatcherSender();
    await sendDirectChatWith(Chatroom as unknown as ChatroomClass, mapStore.worker, sender, contact, message);
}

// Assignment notification sent to a contact when they're added to an incident.
export async function sendAssignmentMessage(
    mapStore: MapStore,
    contact: { uid: string; callsign: string },
    incident: { name: string; address: string }
): Promise<void> {
    const msg = `You have been assigned to: ${incident.name}${incident.address ? ' at ' + incident.address : ''}. Incident on your map.`;
    await sendDirectChat(mapStore, contact, msg);
}

// Update notification sent to an assigned responder when the dispatcher adds an incident note.
export async function sendUpdateMessage(
    mapStore: MapStore,
    contact: { uid: string; callsign: string },
    incident: { name: string },
    note: string
): Promise<void> {
    await sendDirectChat(mapStore, contact, `UPDATE — ${incident.name}: ${note}`);
}
