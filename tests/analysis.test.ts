import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { TraceRecorder, redact, renderText, renderHtml, toJsonl, toEval } from '../src/analysis.js'
import { fixture, call, result } from './fixtures.js'

function analyze(events = fixture(), options = {}) {
  const recorder = new TraceRecorder('test', options)
  for (const event of events) recorder.record(event)
  return recorder.snapshot(true)
}

describe('durable evidence and reliability', () => {
  it('normal task has no findings and two steps, without storing bodies', () => {
    const trace = analyze()
    expect(trace.findings).toEqual([])
    expect(trace.summary).toMatchObject({ step_count: 2, turn_count: 1, tool_call_count: 1, tool_success_count: 1, completion_status: 'completed' })
    expect(JSON.stringify(trace)).not.toContain('private task')
    expect(trace.turns[0]?.steps[0]?.tool_calls[0]?.result_seqs).toEqual([5])
  })
  it('recovers from one tool error without treating the session as failed', () => {
    const trace = analyze(fixture([call('a', 1), result('a', true, 1), call('b', 2), result('b', false, 2)]))
    expect(trace.summary).toMatchObject({ tool_failure_count: 1, completion_status: 'completed' })
    expect(trace.findings.map(f => f.failure_type)).toContain('T01')
    expect(trace.findings.map(f => f.failure_type)).not.toContain('F07')
  })
  it('detects equivalent arguments with different key order', () => {
    const trace = analyze(fixture([call('a', 1, '{"x":1,"y":2}'), result('a'), call('b', 2, '{"y":2,"x":1}'), result('b'), call('c', 3, '{"x":1,"y":2}'), result('c')]))
    expect(trace.findings.some(f => f.failure_type === 'F03')).toBe(true)
  })
  it('missing result is a terminal finding, never a pending-call finding', () => {
    const recorder = new TraceRecorder('missing')
    fixture([call('a')]).slice(0, -1).forEach(e => recorder.record(e))
    expect(recorder.snapshot().findings.some(f => f.failure_type === 'F01')).toBe(false)
    expect(recorder.snapshot(true).findings.some(f => f.failure_type === 'F01')).toBe(true)
  })
  it('surface replacement of a tool result is not duplicate terminal evidence', () => {
    const events = fixture([call('a'), result('a'), { ...result('a'), surfaceOp: { op: 'replace', startSeq: 5, endSeq: 5 }, sourceEventSeqs: [5] }])
    expect(analyze(events).findings.some(f => f.failure_type === 'F02')).toBe(false)
    expect(analyze(fixture([call('a'), result('a'), result('a')])).findings.some(f => f.failure_type === 'F02')).toBe(true)
  })
  it('parallel results correlate by call id regardless of completion order', () => {
    const trace = analyze(fixture([call('a'), call('b'), result('b', true), result('a')]))
    const calls = trace.turns.flatMap(t => t.steps.flatMap(s => s.tool_calls))
    expect(calls.map(c => [c.call_id, c.status])).toEqual([['a', 'success'], ['b', 'error']])
  })
  it('cancellation is separate from failure and pending calls are not missing', () => {
    const events = fixture([call('a')])
    events[events.length - 1] = { ...events.at(-1)!, data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } }
    const trace = analyze(events)
    expect(trace.summary.completion_status).toBe('cancelled')
    expect(trace.findings.some(f => ['F01', 'F07'].includes(f.failure_type))).toBe(false)
  })
  it('retry settlements do not add steps and usage is never invented', () => {
    const events = fixture()
    events.splice(3, 0, { type: 'assistant/attempt', seq: 3, time: 103, data: { turn: 1, step: 1, stream: [] } })
    events.forEach((e, seq) => { e.seq = seq })
    const trace = analyze(events)
    expect(trace.summary).toMatchObject({ step_count: 2, retry_count: 1, model_request_count: 3 })
    expect(trace.summary.input_tokens).toBeUndefined()
  })
  it('replay/dedup returns consistent summaries without double counting', () => {
    const recorder = new TraceRecorder('test')
    fixture().forEach(e => recorder.record(e))
    const before = recorder.snapshot(true).summary
    fixture().forEach(e => recorder.record(e))
    expect(recorder.snapshot(true).summary).toEqual(before)
  })
  it('bounds events explicitly and does not claim complete analysis', () => {
    const trace = analyze(fixture(), { maxEvents: 2 })
    expect(trace.integrity.truncated).toBe(true)
    expect(trace.summary.completion_status).toBe('unknown')
    expect(trace.findings.some(f => f.failure_type === 'F01')).toBe(false)
    const gapped = analyze(fixture().map(e => ({ ...e, seq: e.seq * 2 + 1 })), { maxEvents: 2 })
    expect(gapped.integrity.sequence_gaps).toHaveLength(2)
  })
  it('serializes one JSONL observation per line and eval cases retain evidence', () => {
    const trace = analyze(fixture([call('a')]))
    expect(toJsonl(trace).trim().split('\n').map(s => JSON.parse(s))).toEqual(trace.observations)
    expect(toEval(trace)[0]?.evidence).toEqual([4])
    expect(renderText(trace)).toContain('F01')
    expect(renderHtml(trace)).toContain('Content-Security-Policy')
  })
})

describe('privacy', () => {
  it('redacts secrets in structured fields, inline JSON, headers, env assignments and custom patterns', () => {
    const secrets = ['sk-FAKESECRET1234567890', 'FAKEBEARERTOKEN', 'FAKEPASSWORD', 'FAKECOOKIE', 'FAKEENVSECRET', 'CUSTOMPRIVATE']
    const text = `api_key=${secrets[0]}\nAuthorization: Bearer ${secrets[1]}\n{"password":"${secrets[2]}"}\nCookie: sid=${secrets[3]}\nAWS_SECRET_ACCESS_KEY=${secrets[4]}\n${secrets[5]}`
    const value = redact({ password: secrets[2], nested: text }, ['CUSTOMPRIVATE'])
    for (const secret of secrets) expect(JSON.stringify(value)).not.toContain(secret)
    const events = fixture()
    events[2]!.data = { content: [{ type: 'text', text }] }
    for (const captureContent of [false, true]) {
      const trace = analyze(events, { captureContent, redactionPatterns: ['CUSTOMPRIVATE'] })
      for (const secret of secrets) expect(JSON.stringify(trace)).not.toContain(secret)
      for (const secret of secrets) expect(toJsonl(trace) + JSON.stringify(toEval(trace))).not.toContain(secret)
    }
  })
  it('never retains reasoning blocks or embedded stream deltas in content mode', () => {
    const events = fixture()
    events[3]!.data = { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'PRIVATE_REASONING' }, { type: 'text', text: 'public answer' }] }, stream: [{ type: 'chunk', chunk: { type: 'reasoning-delta', text: 'PRIVATE_REASONING' } }] }
    const trace = analyze(events, { captureContent: true })
    expect(JSON.stringify(trace)).not.toContain('PRIVATE_REASONING')
    expect(JSON.stringify(trace)).toContain('public answer')
  })
  it('escapes captured HTML content', () => {
    const events = fixture()
    events[2]!.data = { content: [{ type: 'text', text: '<script>alert(1)</script>' }] }
    expect(renderHtml(analyze(events, { captureContent: true }))).not.toContain('<script>')
  })
  it('redaction is idempotent across arbitrary strings', () => {
    fc.assert(fc.property(fc.string(), value => { expect(redact(redact(value))).toEqual(redact(value)); return true }), { numRuns: 150 })
  })
  it('a redaction marker in an authorization value does not preserve adjacent secrets', () => {
    const value = redact('Authorization: Bearer [REDACTED] ADJACENT_SECRET\npassword="[REDACTED] MORE_SECRET"')
    expect(String(value)).not.toContain('ADJACENT_SECRET')
    expect(String(value)).not.toContain('MORE_SECRET')
    expect(redact(value)).toEqual(value)
  })
})

it('constrained arbitrary parallel completion order preserves identities and JSONL round-trip', () => {
  fc.assert(fc.property(fc.shuffledSubarray(['a', 'b', 'c', 'd', 'e'], { minLength: 5, maxLength: 5 }), order => {
    const trace = analyze(fixture(['a', 'b', 'c', 'd', 'e'].map(id => call(id, 1, JSON.stringify({ id }))).concat(order.map(id => result(id, id === 'b' || id === 'd')))))
    const calls = trace.turns.flatMap(t => t.steps.flatMap(s => s.tool_calls))
    expect(calls.map(c => [c.call_id, c.status])).toEqual([['a', 'success'], ['b', 'error'], ['c', 'success'], ['d', 'error'], ['e', 'success']])
    expect(toJsonl(trace).trim().split('\n').map(line => JSON.parse(line))).toEqual(trace.observations)
    return true
  }), { numRuns: 100 })
})
