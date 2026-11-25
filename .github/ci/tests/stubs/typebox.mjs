// Stand-in for @sinclair/typebox: the route files only build schemas with it, the tests never
// validate against them.
const t = () => ({})
export const Type = { Object: t, String: t, Optional: t, Integer: t, Number: t, Record: t, Any: t }
