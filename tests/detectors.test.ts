import { it, expect } from 'vitest'
import { TraceRecorder, detect } from '../src/analysis.js'
import { fixture, call, result } from './fixtures.js'
import type { EventInput } from '../src/types.js'

function trace(events: EventInput[]) { const r = new TraceRecorder('detectors'); events.forEach(e => r.record(e)); return r.snapshot(true) }
it('F04 requires failures across consecutive steps and stops after successful recovery', () => {
  const events = fixture([call('a', 1, '{}'), result('a', true, 1), call('b', 2, '{}'), result('b', true, 2), call('c', 3, '{}'), result('c', true, 3)])
  expect(detect(trace(events)).map(f => f.failure_type)).toContain('F04')
  const gap = fixture([call('a', 1), result('a', true, 1), call('b', 3), result('b', true, 3), call('c', 4), result('c', true, 4)])
  expect(detect(trace(gap)).map(f => f.failure_type)).not.toContain('F04')
})
it('F05 counts settlements, F08 uses durable latency, F09 requires a minimum denominator', () => {
  const events = fixture()
  for (let i = 0; i < 3; i++) events.splice(3, 0, { type: 'assistant/attempt', seq: 0, time: 105, data: { turn: 1, step: 1, stream: [] } })
  events.forEach((e, seq) => { e.seq = seq; e.time = seq * 60_000 })
  const findings = detect(trace(events))
  expect(findings.map(f => f.failure_type)).toEqual(expect.arrayContaining(['F05', 'F08']))
  expect(detect(trace(fixture([call('a'), result('a', true)]))).map(f => f.failure_type)).not.toContain('F09')
  const errors = fixture(['a', 'b', 'c', 'd'].flatMap((id, index) => [call(id, index + 1, JSON.stringify({ index })), result(id, true, index + 1)]))
  expect(detect(trace(errors)).map(f => f.failure_type)).toContain('F09')
})
it('F07 distinguishes error, limits, interruption, cancellation and fork closure', () => {
  for (const [kind, severity] of [['error', 'error'], ['interrupted', 'error'], ['max-tokens', 'warning'], ['blocked', 'warning'], ['aborted', undefined], ['forked', undefined]] as const) {
    const events = fixture(); events.at(-1)!.data = { turn: 1, reason: { kind } }
    expect(detect(trace(events)).find(f => f.failure_type === 'F07')?.severity).toBe(severity)
  }
})
it('F10 cites logged header changes; intentional churn is informational', () => {
  const events = fixture()
  for (let i = 0; i < 5; i++) events.splice(3, 0, { type: 'request/header', seq: 0, time: 103, data: { reason: 'change', header: { config: { provider: 'fake', model: `model-${i}` } } } })
  events.forEach((e, seq) => { e.seq = seq })
  expect(detect(trace(events)).find(f => f.failure_type === 'F10')).toMatchObject({ severity: 'info', evidence_event_seqs: [3, 4, 5, 6, 7] })
})
it('incomplete capture suppresses missing-result conclusions and limits content retention', () => {
  const events = fixture([call('a')]); events[2]!.seq = 20; events.splice(3)
  const value = trace(events)
  expect(value.integrity.sequence_gaps).toEqual([20])
  expect(value.findings.some(f => f.failure_type === 'F01')).toBe(false)
  const recorder = new TraceRecorder('bounded', { captureContent: true, maxContentBytes: 8 })
  fixture().forEach(e => recorder.record(e))
  expect(recorder.snapshot().observations[2]?.payload?.content_truncated).toBe(true)
})
