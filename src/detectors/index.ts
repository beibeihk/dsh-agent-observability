import type { Trace, Options, Finding, ToolCall } from '../types.js'

/** Deterministic findings cite durable sequence numbers; thresholds describe patterns, not task correctness. */
export function detect(trace: Trace, options: Options = {}): Finding[] {
  const findings: Finding[] = []
  const add = (type: string, severity: Finding['severity'], seqs: number[], message: string, metrics: Finding['metrics'] = {}) => {
    findings.push({ failure_id: `${trace.session.id}:${type}:${seqs[0] ?? 0}:${findings.length}`, failure_type: type, severity, session_id: trace.session.id, evidence_event_seqs: [...new Set(seqs)].sort((a, b) => a - b), message, metrics })
  }
  const complete = !trace.integrity.truncated && trace.integrity.sequence_gaps.length === 0
  const list = trace.turns.flatMap(t => t.steps.flatMap(s => s.tool_calls))
  for (const turn of trace.turns) {
    for (const call of turn.steps.flatMap(s => s.tool_calls)) {
      if (complete && call.status === 'pending' && (turn.end_seq !== undefined || trace.integrity.finalized) && turn.outcome !== 'aborted' && turn.outcome !== 'forked') add('F01', 'error', [call.call_seq], 'Tool call has no terminal result in the closed observation interval.')
      if (call.result_seqs.length > 1) add('F02', 'error', [call.call_seq, ...call.result_seqs], 'Tool call has more than one terminal result.', { terminal_results: call.result_seqs.length })
      if (call.status === 'error') add('T01', 'info', [call.call_seq, ...call.result_seqs], 'Tool returned a structured error; this does not imply session failure.', { error_class: call.error_class ?? 'unknown', error_code: call.error_code ?? 'unknown' })
      if (call.duration_ms !== undefined && call.duration_ms > (options.longToolMs ?? 30_000)) add('F08', 'warning', [call.call_seq, ...call.result_seqs], 'Observed call-to-result latency exceeds the configured threshold.', { duration_ms: call.duration_ms, threshold_ms: options.longToolMs ?? 30_000 })
    }
    if (turn.outcome === 'error' || turn.outcome === 'interrupted') add('F07', 'error', [turn.end_seq!], 'Turn ended with a durable error or interruption.', { outcome: turn.outcome })
    if (turn.outcome === 'max-tokens' || turn.outcome === 'blocked') add('F07', 'warning', [turn.end_seq!], 'Turn ended with a durable resource or policy limit.', { outcome: turn.outcome })
    for (const step of turn.steps) {
      const attempts = step.assistant
      if (attempts.length > (options.maxAttempts ?? 3)) add('F05', 'warning', attempts.map(e => e.seq), 'Step has excessive settled model attempts.', { attempts: attempts.length, threshold: options.maxAttempts ?? 3 })
    }
  }
  let repeats: ToolCall[] = [], errors: ToolCall[] = []
  for (const call of list) {
    const previous = repeats.at(-1)
    if (previous && previous.turn === call.turn && previous.name === call.name && previous.args_hash === call.args_hash && call.start >= previous.start && call.start - repeats[0]!.start <= (options.repeatWindowMs ?? 60_000)) repeats.push(call)
    else repeats = [call]
    if (repeats.length === (options.repeatThreshold ?? 3)) add('F03', 'warning', repeats.map(c => c.call_seq), 'Consecutive equivalent tool calls within the configured window.', { calls: repeats.length, window_ms: options.repeatWindowMs ?? 60_000 })
    const priorError = errors.at(-1)
    if (call.status !== 'error') errors = []
    else if (priorError && priorError.turn === call.turn && priorError.name === call.name && call.step === priorError.step + 1) errors.push(call)
    else errors = [call]
    if (errors.length === (options.errorLoopThreshold ?? 3)) add('F04', 'warning', errors.flatMap(c => [c.call_seq, ...c.result_seqs]), 'Same tool failed in consecutive observed call steps.', { failures: errors.length })
  }
  const settled = trace.summary.tool_success_count + trace.summary.tool_failure_count
  if (settled >= (options.minimumCalls ?? 4) && (trace.summary.tool_error_rate ?? 0) > (options.failureRatio ?? 0.5)) add('F09', 'warning', list.filter(c => c.status === 'error').flatMap(c => c.result_seqs), 'Observed tool failure ratio exceeds the configured threshold.', { ratio: trace.summary.tool_error_rate!, settled_calls: settled, threshold: options.failureRatio ?? 0.5 })
  const churn = trace.observations.filter(e => !e.inherited && ((e.type === 'request/header' && e.status === 'change') || e.type === 'request/context'))
  if (trace.summary.request_header_changes + trace.summary.context_changes >= (options.churnThreshold ?? 5)) add('F10', 'info', churn.map(e => e.seq), 'Durable request header/context changed frequently; changes may be intentional.', { header_changes: trace.summary.request_header_changes, context_changes: trace.summary.context_changes })
  return findings
}
