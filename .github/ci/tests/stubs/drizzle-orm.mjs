// Stand-in for drizzle-orm (ops #1257): the access gate in the route files reads one setting with a
// sql`...` query. The route tests give config.pg.execute the rows to answer with.
export const sql = (strings, ...values) => ({ strings: [...strings], values })
