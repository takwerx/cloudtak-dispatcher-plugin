// Stand-in for @openaddresses/batch-error (ops #1201): an error with an HTTP status, and the
// respond() the route files call in their catch block.
export default class Err extends Error {
    constructor(status, _cause, message) { super(message); this.status = status }

    static respond(err, res) {
        res.status(err.status ?? 500).json({ status: err.status ?? 500, message: err.message })
    }
}
