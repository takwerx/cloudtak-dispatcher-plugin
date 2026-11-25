// Stand-in for @sinclair/typebox: the route files only build schemas with it, the tests never
// validate against them.
const t = () => ({})
export const Type = {
    Object: t, String: t, Optional: t, Integer: t, Number: t, Record: t, Any: t,
    // server/plugin-addressing.ts (address-load-db.test.mjs, #108).
    Array: t, Literal: t, Null: t, Union: t,
}
