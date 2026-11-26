// Stand-in for @tak-ps/node-tak (ops #1201). Records which certificate each TAK Server client
// was made with, and every request it sent, in globalThis.__tak.
export class APIAuthCertificate {
    constructor(cert, key) { this.cert = cert; this.key = key }
}

export class TAKAPI {
    static async init(url, auth) {
        const api = new TAKAPI()
        api.auth = auth
        // The user's TAK groups (ops #1257), by certificate: globalThis.__groupsByCert[cert] = ['Fire', ...].
        api.Group = { list: async () => ({ data: (globalThis.__groupsByCert?.[auth.cert] ?? []).map(name => ({ name })) }) }
        ;(globalThis.__tak ??= { clients: [], requests: [] }).clients.push(auth.cert)
        return api
    }

    async fetch(url, opts) {
        globalThis.__tak.requests.push({ cert: this.auth.cert, url: String(url), method: opts.method })
        return { ok: true }
    }
}
