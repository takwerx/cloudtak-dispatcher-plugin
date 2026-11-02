// Stand-in for CloudTAK's std(): records every call in globalThis.__calls and answers with
// whatever the test put in globalThis.__respond(url, opts) (default: {}).
export async function std(url, opts = {}) {
    const call = { url, method: opts.method ?? 'GET', body: opts.body }
    ;(globalThis.__calls ??= []).push(call)
    return globalThis.__respond ? globalThis.__respond(url, opts) : {}
}
