// Module resolver for the plugin tests (ops #410). The plugin's lib files import CloudTAK's own
// modules (../../../src/std.ts, src/base/*) and node-cot, which only exist inside a CloudTAK
// tree. Those imports are swapped for the small stand-ins in ./stubs; everything else resolves
// normally, so the plugin code under test is the real file.
const STUBS = [
    [/(^|\/)src\/std\.ts$/,                  './stubs/std.mjs'],
    [/(^|\/)src\/base\/profile\.ts$/,        './stubs/profile.mjs'],
    [/(^|\/)src\/base\/chatroom\.ts$/,       './stubs/chatroom.mjs'],
    [/(^|\/)src\/base\/subscription-chat\.ts$/, './stubs/subscription-chat.mjs'],
    [/^@tak-ps\/node-cot\/normalize_geojson$/, './stubs/normalize-geojson.mjs'],
    // The server route files (server/plugin-takcad.ts, ops #1201).
    [/(^|\/)common\/auth\.js$/,              './stubs/cloudtak-auth.mjs'],
    [/^@tak-ps\/node-tak$/,                   './stubs/node-tak.mjs'],
    [/^@sinclair\/typebox$/,                  './stubs/typebox.mjs'],
    [/^@openaddresses\/batch-schema$/,        './stubs/batch-schema.mjs'],
    [/^@openaddresses\/batch-error$/,         './stubs/batch-error.mjs'],
    // server/plugin-addressing.ts against a real Postgres (address-load-db.test.mjs, #108).
    [/^drizzle-orm$/,                         './stubs/drizzle-orm.mjs'],
]

export function resolve(specifier, context, next) {
    for (const [re, stub] of STUBS) {
        if (re.test(specifier)) return { url: new URL(stub, import.meta.url).href, shortCircuit: true }
    }
    return next(specifier, context)
}
