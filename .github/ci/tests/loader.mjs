// Module resolver for the plugin tests (ops #410). The plugin's lib files import CloudTAK's own
// modules (../../../src/std.ts, src/base/*) and node-cot, which only exist inside a CloudTAK
// tree. Those imports are swapped for the small stand-ins in ./stubs; everything else resolves
// normally, so the plugin code under test is the real file.
const STUBS = [
    [/(^|\/)src\/std\.ts$/,                  './stubs/std.mjs'],
    [/(^|\/)src\/base\/profile\.ts$/,        './stubs/profile.mjs'],
    [/(^|\/)src\/base\/subscription-chat\.ts$/, './stubs/subscription-chat.mjs'],
    [/^@tak-ps\/node-cot\/normalize_geojson$/, './stubs/normalize-geojson.mjs'],
]

export function resolve(specifier, context, next) {
    for (const [re, stub] of STUBS) {
        if (re.test(specifier)) return { url: new URL(stub, import.meta.url).href, shortCircuit: true }
    }
    return next(specifier, context)
}
