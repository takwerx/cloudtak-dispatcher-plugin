// Stand-in for drizzle-orm's sql template, for the address load tests against a real Postgres
// (#108). sql`...` keeps the text pieces and values; render() turns one into the "$1, $2" text and
// parameter list that drizzle's postgres-js driver hands to client.unsafe(), the same call
// CloudTAK makes. Nested sql`` pieces are inlined, sql.join() joins pieces, arrays become a list.
class SQL {
    constructor(strings, values) { this.strings = strings; this.values = values }
}

export function sql(strings, ...values) { return new SQL([...strings], values) }

sql.join = (parts, sep) => {
    const strings = ['']
    const values = []
    parts.forEach((p, i) => {
        if (i > 0) { values.push(sep); strings.push('') }
        values.push(p); strings.push('')
    })
    return new SQL(strings, values)
}

export function render(q, params = []) {
    let text = ''
    q.strings.forEach((s, i) => {
        text += s
        if (i >= q.values.length) return
        const v = q.values[i]
        if (v instanceof SQL) text += render(v, params).text
        else if (Array.isArray(v)) text += '(' + v.map(x => { params.push(x); return '$' + params.length }).join(', ') + ')'
        else { params.push(v === undefined ? null : v); text += '$' + params.length }
    })
    return { text, params }
}
