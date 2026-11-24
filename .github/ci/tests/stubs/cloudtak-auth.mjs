// Stand-in for CloudTAK's api/common/auth.ts, for the TAK-CAD route tests (ops #1201).
// is_connection copies the rule CloudTAK itself enforces (api/common/auth.ts, same on v13.45.0
// and v14.0.0): a system admin may use any connection; anyone else must be an agency admin for
// the connection's agency. The test sets who is calling in globalThis.__caller and the
// connection rows in globalThis.__connections.
export class Err extends Error {
    constructor(status, _cause, message) { super(message); this.status = status }
}

function caller() {
    const c = globalThis.__caller
    if (!c) throw new Err(401, null, 'Authentication Required')
    return c
}

export default class Auth {
    static async is_auth(_config, _req, _opts = {}) { return caller() }

    static async as_user(_config, _req, _opts = {}) { return caller() }

    static async is_connection(_config, _req, _opts, connectionid) {
        const auth = caller()
        const connection = globalThis.__connections[connectionid]
        if (!connection) throw new Err(404, null, 'Item Not Found')
        const profile = globalThis.__profiles[auth.email]
        if (profile.system_admin === true) return { connection, profile, auth }
        if (!connection.agency) throw new Err(401, null, 'Only a System Admin can access this connection')
        if (!profile.agency_admin) throw new Err(401, null, 'Only an Agency Admin admin or higher can access connections')
        if (!profile.agency_admin.includes(connection.agency)) throw new Err(401, null, `You are not an Agency Admin for Agency ${connection.agency}`)
        return { connection, profile, auth }
    }
}
