// Proves a change to the paint engine only touched comments.
// Usage: node comments-only.check.cjs <before-dir> <after-dir>
//  .js        parsed with acorn (comments are not part of the tree); node positions dropped; trees must be equal
//  .html/.css <!-- --> and /* */ comments removed, cache-busting ?v=<hash> removed; text must be equal
//  others     bytes must be equal (SOURCE.json is the sync record and is skipped)
const fs = require('node:fs')
const path = require('node:path')
const acorn = require('acorn')

const [before, after] = process.argv.slice(2)
if (!before || !after) { console.error('usage: node comments-only.check.cjs <before-dir> <after-dir>'); process.exit(2) }
const list = (root) => {
  const out = []
  ;(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(path.relative(root, p)) } })(root)
  return out.sort()
}
const tree = (text) => JSON.stringify(acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }), (k, v) => (k === 'start' || k === 'end' ? undefined : typeof v === 'bigint' ? `${v}n` : v))
const markup = (text) => text.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, '').replace(/\?v=[0-9a-f]+/g, '')

const a = list(before), b = list(after)
const added = b.filter((f) => !a.includes(f)), removed = a.filter((f) => !b.includes(f))
let same = 0, diffText = 0, bad = []
for (const f of a.filter((x) => b.includes(x))) {
  if (f === 'SOURCE.json') continue
  const x = fs.readFileSync(path.join(before, f)), y = fs.readFileSync(path.join(after, f))
  if (!x.equals(y)) diffText++
  let ok
  if (f.endsWith('.js')) ok = tree(x.toString('utf8')) === tree(y.toString('utf8'))
  else if (/\.(html|css)$/.test(f)) ok = markup(x.toString('utf8')) === markup(y.toString('utf8'))
  else ok = x.equals(y)
  ok ? same++ : bad.push(f)
}
console.log(`files: ${a.length} before, ${b.length} after; text changed in ${diffText}; code identical in ${same}`)
if (added.length || removed.length) console.log('added:', added, 'removed:', removed)
if (bad.length) console.log('CODE DIFFERS:', bad)
console.log(bad.length || added.length || removed.length ? 'FAIL' : 'OK: only comments changed')
process.exitCode = bad.length || added.length || removed.length ? 1 : 0
