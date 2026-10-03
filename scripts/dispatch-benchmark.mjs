import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as plugin from '../lib/index.js'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const count = 10_000, rounds = 7, modes = ['baseline', 'metadata-only', 'content']
const messages = Array.from({ length: count }, (_, i) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `Synthetic public observation ${i}` }] }))
const samples = Object.fromEntries(modes.map(mode => [mode, []]))
const directory = await mkdtemp(join(tmpdir(), 'dsh-dispatch-bench-'))
async function run(mode) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Query, { path: ':memory:', openAt: 'never' })
  if (mode !== 'baseline') await ctx.plugin(plugin, { outputDir: directory, captureContent: mode === 'content' })
  const session = ctx.sessions.create(SessionId(`bench-${mode}`))
  session.append('turn/start', { turn: 1 })
  if (mode !== 'baseline') await ctx.dshObservability.trace(session)
  global.gc?.()
  const before = process.memoryUsage(), start = performance.now()
  for (const message of messages) session.append('user/message', message, { surfaceOp: 'append' })
  const ms = performance.now() - start, after = process.memoryUsage()
  await ctx.fiber.dispose()
  return { ms, events_per_second: count / (ms / 1000), heap_delta_bytes: after.heapUsed - before.heapUsed, rss_delta_bytes: after.rss - before.rss }
}
try {
  for (const mode of modes) await run(mode)
  for (let round = 0; round < rounds; round++) for (const mode of [...modes.slice(round % 3), ...modes.slice(0, round % 3)]) samples[mode].push(await run(mode))
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const timings = Object.fromEntries(modes.map(mode => [mode, Object.fromEntries(['ms', 'events_per_second', 'heap_delta_bytes', 'rss_delta_bytes'].map(key => [key, median(samples[mode].map(s => s[key]))]))]))
  for (const mode of modes.slice(1)) {
    timings[mode].added_ms_per_10k = timings[mode].ms - timings.baseline.ms
    timings[mode].added_microseconds_per_event = timings[mode].added_ms_per_10k * 1000 / count
    timings[mode].overhead_percent = (timings[mode].ms / timings.baseline.ms - 1) * 100
  }
  const results = JSON.parse(await readFile('docs/benchmarks/results.json', 'utf8'))
  results.session_dispatch_benchmark = { events: count, rounds, scope: 'published Session.append + session/event observer; synthetic user messages; no model or disk I/O in timed region', timings }
  await writeFile('docs/benchmarks/results.json', JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results.session_dispatch_benchmark, null, 2))
} finally { await rm(directory, { recursive: true, force: true }) }
