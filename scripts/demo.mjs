import { readFile, readdir, mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dsh } from './dsh-command.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'artifacts', 'demo')
await mkdir(output, { recursive: true })
const packed = spawnSync(process.execPath, [resolve(process.env.npm_execpath), 'pack', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' })
if (packed.status !== 0) throw new Error('npm pack failed')
const filename = JSON.parse(packed.stdout)[0].filename
await mkdir(join(root, '.demo-home'), { recursive: true })
// Fresh profile per run ensures pnpm cannot reuse an older same-version local tarball.
const home = await mkdtemp(join(root, '.demo-home', 'run-'))
const env = { DSH_HOME: home, DSH_OBSERVE_DEMO_OUTPUT: output }
console.log('$ dsh plugin --profile headless add <prebuilt release tarball>')
dsh(['plugin', '--profile', 'headless', 'add', `file:${join(root, filename)}`], env)
console.log('$ dsh --profile headless --patch examples/basic-observability/demo.patch.yml "Run the offline lookup"')
dsh(['--profile', 'headless', '--patch', join(root, 'examples/basic-observability/demo.patch.yml'), 'Run the offline lookup'], env)
const entries = await readdir(output, { withFileTypes: true })
const reports = []
for (const entry of entries.filter(e => e.isDirectory())) {
  try { const summary = JSON.parse(await readFile(join(output, entry.name, 'summary.json'), 'utf8')); reports.push({ id: entry.name, mtime: summary.session.id, summary }) } catch { /* Ignore non-report directories. */ }
}
if (!reports.length) throw new Error('Official dsh run did not produce a report')
// The example may be re-run; select the latest file timestamp rather than assuming a session id.
const { stat } = await import('node:fs/promises')
for (const report of reports) report.time = (await stat(join(output, report.id, 'summary.json'))).mtimeMs
reports.sort((a, b) => b.time - a.time)
const report = reports[0]
if (report.summary.completion_status !== 'completed' || report.summary.tool_call_count !== 1) throw new Error('Unexpected deterministic demo result')
for (const name of ['trace.json', 'trace.jsonl', 'summary.json', 'report.html', 'report.txt', 'eval.jsonl', 'summary.csv']) await copyFile(join(output, report.id, name), join(output, name))
const text = await readFile(join(output, 'report.txt'), 'utf8')
console.log(text)
await writeFile(join(output, 'terminal.txt'), `$ npm run demo\n\nDeterministic task completed: event-grounded trace recorded.\n\n${text}`)
console.log(`Offline HTML report: ${join(output, 'report.html')}`)
