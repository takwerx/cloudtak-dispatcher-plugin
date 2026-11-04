// Records feed-chat sends in globalThis.__chats.
export default class SubscriptionChat {
    constructor(guid, name) { this.guid = guid; this.name = name }
    async send(message) { (globalThis.__chats ??= []).push({ guid: this.guid, name: this.name, message }) }
}
