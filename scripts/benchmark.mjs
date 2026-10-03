import { TraceRecorder, toJsonl } from '../lib/analysis.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { synthetic, kinds } from './synthetic.mjs'

const rows = []
let tp = 0, fp = 0, fn = 0
for (const kind of kinds) for (let i = 0; i < 10; i++) {
  const input = synthetic(kind, i), recorder = new TraceRecorder(input.id)
  input.events.forEach(e => recorder.record(e))
  const trace = recorder.snapshot(true), actual = new Set(trace.findings.map(f => f.failure_type)), expected = new Set(input.labels)
  const row = { id: input.id, expected: [...expected], actual: [...actual] }
  row.tp = [...actual].filter(t => expected.has(t)).length
  row.fp = [...actual].filter(t => !expected.has(t)).length
  row.fn = [...expected].filter(t => !actual.has(t)).length
  tp += row.tp; fp += row.fp; fn += row.fn; rows.push(row)
}
const base = synthetic('normal').events
const events = Array.from({ length: 10_000 }, (_, seq) => ({ ...base[seq % base.length], seq, time: seq, data: { ...base[seq % base.length].data, turn: Math.floor(seq / base.length) + 1 } }))
const modes = ['baseline', 'metadata-only', 'content'], measurements = Object.fromEntries(modes.map(m => [m, []]))
function run(mode) {
  global.gc?.()
  const before = process.memoryUsage(), start = performance.now()
  let recorder
  if (mode !== 'baseline') recorder = new TraceRecorder('micro', { captureContent: mode === 'content' })
  let checksum = 0
  for (const event of events) { checksum += event.seq; recorder?.record(event) }
  const ms = performance.now() - start, after = process.memoryUsage()
  return { ms, events_per_second: events.length / (ms / 1000), heap_delta_bytes: after.heapUsed - before.heapUsed, rss_delta_bytes: after.rss - before.rss, checksum, recorder }
}
// Warm all paths. Rotate order to reduce systematic order effects; report median of seven rounds.
for (const mode of modes) for (let i = 0; i < 3; i++) run(mode)
for (let round = 0; round < 7; round++) for (const mode of [...modes.slice(round % 3), ...modes.slice(0, round % 3)]) { const result = run(mode); delete result.recorder; measurements[mode].push(result) }
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const timings = Object.fromEntries(modes.map(mode => [mode, Object.fromEntries(['ms', 'events_per_second', 'heap_delta_bytes', 'rss_delta_bytes'].map(key => [key, median(measurements[mode].map(m => m[key]))]))]))
for (const mode of ['metadata-only', 'content']) {
  timings[mode].added_ms_per_10k = timings[mode].ms - timings.baseline.ms
  timings[mode].added_microseconds_per_event = timings[mode].added_ms_per_10k * 1000 / events.length
  timings[mode].relative_to_minimal_baseline = timings[mode].ms / timings.baseline.ms
}
const measured = run('metadata-only'), projectedStart = globalThis.performance.now(), trace = measured.recorder.snapshot(true)
const projection_ms = globalThis.performance.now() - projectedStart
const serializationStart = globalThis.performance.now(); const jsonlBytes = Buffer.byteLength(toJsonl(trace)); const serialization_ms = globalThis.performance.now() - serializationStart
const result = { date: new Date().toISOString().slice(0, 10), environment: { node: process.version, platform: process.platform, arch: process.arch }, dataset: { traces: rows.length, labels: 'predeclared synthetic session-label pairs', tp, fp, fn, precision: tp / (tp + fp), recall: tp / (tp + fn) }, microbenchmark: { events: events.length, rounds: 7, scope: 'synchronous recorder only; baseline is a minimal event loop, not Harness end-to-end latency; filesystem excluded', performance: timings, projection_ms, serialization_ms, jsonl_bytes: jsonlBytes }, rows }
await mkdir('docs/benchmarks', { recursive: true })
await writeFile('docs/benchmarks/results.json', JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ dataset: result.dataset, microbenchmark: result.microbenchmark }, null, 2))
if (fp || fn) process.exitCode = 1
