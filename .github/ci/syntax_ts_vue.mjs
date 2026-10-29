// Syntax check for every tracked .ts and .vue file (ops #329). Does not need a CloudTAK checkout,
// so it does not need the plugin's own `npm ci` either (package.json points at a local CloudTAK).
// Type checking (`npm run check`) only works inside CloudTAK's tree, because the plugin imports
// ../../../src/... from it; that is a deploy-time check, not a PR check.
//
//   CI_TOOLS=/path/with/node_modules node .github/ci/syntax_ts_vue.mjs
//
// CI_TOOLS is a folder where `npm install typescript vue` was run (the workflow does this).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const tools = process.env.CI_TOOLS
if (!tools) { console.error('CI_TOOLS is not set'); process.exit(2) }
const require = createRequire(join(tools, 'x.js'))
const ts = require('typescript')
const sfc = require('vue/compiler-sfc')

const files = execFileSync('git', ['ls-files', '-z', '--', '*.ts', '*.vue'], { encoding: 'utf8' })
    .split('\0').filter(Boolean)

let bad = 0
const report = (file, msg, line) => {
    bad++
    console.log(`::error file=${file}${line ? `,line=${line}` : ''}::${String(msg).replace(/\r?\n/g, ' ')}`)
}

// ts.transpileModule with reportDiagnostics returns syntax errors only (no type resolution).
const checkTs = (file, text, kind) => {
    const out = ts.transpileModule(text, {
        fileName: file + (kind ?? ''),
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve },
    })
    for (const d of out.diagnostics ?? []) {
        const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : undefined
        report(file, ts.flattenDiagnosticMessageText(d.messageText, ' '), pos)
    }
}

for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (file.endsWith('.ts')) { checkTs(file, text); continue }
    const { descriptor, errors } = sfc.parse(text, { filename: file })
    for (const e of errors) report(file, e.message, e.loc?.start.line)
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
        if (block) checkTs(file, block.content, block.lang === 'ts' || !block.lang ? '.ts' : `.${block.lang}`)
    }
    if (descriptor.template) {
        const t = sfc.compileTemplate({ source: descriptor.template.content, filename: file, id: file })
        for (const e of t.errors) report(file, typeof e === 'string' ? e : e.message, undefined)
    }
}
console.log(`checked ${files.length} .ts/.vue file(s), ${bad} problem(s)`)
process.exit(bad ? 1 : 0)
