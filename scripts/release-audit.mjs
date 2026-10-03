/** Local source/publication preflight; reports filenames only, never matching secret values. */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const skip = new Set(['node_modules', '.git', 'lib', 'coverage', '.demo-home', 'artifacts'])
const files = []
async function walk(directory = '.') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.endsWith('.tgz')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else files.push(path)
  }
}
await walk()
const failures = []
for (const path of files) {
  if (/\.(jpg|png|gif)$/u.test(path)) continue
  const content = await readFile(path, 'utf8')
  for (const match of content.matchAll(/(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{30,}/gu)) if (!match[0].includes('FAKE')) failures.push(`credential-like value: ${path}`)
  if (/^(?:src[\\/])/u.test(path) && /(?:@deepseek-ai\/[^'"\s]+\/(?:src|lib|internal)|snapshotEvents\(|\.eventAt\(|\.ownEvents\()/u.test(content)) failures.push(`private/deprecated API: ${path}`)
  if (/(?:^|[\\/])(?:auth\.json|\.env|\.npmrc)$/u.test(path)) failures.push(`credential file: ${path}`)
  if (path.endsWith('.md')) {
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
      const target = match[1].split('#')[0]
      if (!target || /^(?:https?:|mailto:)/u.test(target)) continue
      const { access } = await import('node:fs/promises')
      const { dirname } = await import('node:path')
      try { await access(join(dirname(path), target)) } catch { failures.push(`missing document link: ${path} -> ${target}`) }
    }
  }
}
console.log(`Audited ${files.length} candidate source/documentation files; ${failures.length} findings.`)
for (const failure of failures) console.log(failure)
if (failures.length) process.exitCode = 1
