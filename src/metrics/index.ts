import type { Observation, Turn, Step, ToolCall, Metrics } from '../types.js'

/** Correlate calls within turn/step, because provider call ids can be reused in later steps. */
export function project(observations: Observation[], incomplete: boolean): { turns: Turn[]; summary: Metrics } {
  observations = observations.filter(event => !event.inherited)
  const turns = new Map<number, Turn>()
  const steps = new Map<string, Step>()
  const calls = new Map<string, ToolCall>()
  const turnOf = (id: number) => {
    let turn = turns.get(id)
    if (!turn) { turn = { turn: id, steps: [] }; turns.set(id, turn) }
    return turn
  }
  const stepOf = (turn: Turn, id: number) => {
    const key = `${turn.turn}:${id}`
    let step = steps.get(key)
    if (!step) { step = { step: id, request: [], assistant: [], tool_calls: [] }; turn.steps.push(step); steps.set(key, step) }
    return step
  }
  for (const event of observations) {
    if (event.turn === undefined) continue
    const turn = turnOf(event.turn)
    if (event.type === 'turn/start') turn.start_seq = event.seq
    if (event.type === 'turn/end') { turn.end_seq = event.seq; turn.outcome = event.status }
    if (event.step === undefined) continue
    const step: Step = stepOf(turn, event.step)
    if (event.type === 'step/start') step.start_seq = event.seq
    if (event.type === 'step/end') step.end_seq = event.seq
    if (event.type.startsWith('request/')) step.request.push(event)
    if (event.type.startsWith('assistant/')) step.assistant.push(event)
    const key = `${event.turn}:${event.step}:${event.call_id}`
    if (event.type === 'tool/call' && event.call_id && !calls.has(key)) {
      const call: ToolCall = { call_id: event.call_id, name: event.tool_name ?? '', turn: event.turn, step: event.step, start: event.time, status: 'pending', args_hash: event.args_hash, call_seq: event.seq, result_seqs: [] }
      calls.set(key, call); step.tool_calls.push(call)
    }
    if (event.type === 'tool/result' && !event.is_replacement) {
      const call = calls.get(key)
      if (call) {
        call.result_seqs.push(event.seq)
        if (call.end === undefined) {
          call.end = event.time; call.duration_ms = Math.max(0, event.time - call.start)
          call.status = event.status === 'error' ? 'error' : event.status === 'cancelled' ? 'cancelled' : 'success'
          call.error_class = event.error_class; call.error_code = event.error_code
        }
      }
    }
  }
  const list = [...calls.values()]
  const count = (type: string) => observations.filter(e => e.type === type).length
  const ended = observations.filter(e => e.type === 'turn/end').at(-1)
  const lastStart = observations.findLast(e => e.type === 'turn/start')
  const closed = ended && (!lastStart || ended.seq > lastStart.seq)
  const status = !closed ? 'running' : ended.status === 'completed' ? 'completed' : ended.status === 'aborted' ? 'cancelled' : ended.status === 'error' || ended.status === 'interrupted' ? 'failed' : ended.status ?? 'unknown'
  const attempts = observations.filter(e => e.type === 'assistant/message' || e.type === 'assistant/attempt')
  const perStep = new Map<string, number>()
  for (const attempt of attempts) {
    const key = `${attempt.turn}:${attempt.step}`
    perStep.set(key, (perStep.get(key) ?? 0) + 1)
  }
  const usages = attempts.flatMap(e => e.usage ? [e.usage] : [])
  const success = list.filter(c => c.status === 'success').length, failure = list.filter(c => c.status === 'error').length
  const summary: Metrics = {
    turn_count: count('turn/start'), step_count: count('step/start'), tool_call_count: list.length,
    tool_success_count: success, tool_failure_count: failure, tool_cancelled_count: list.filter(c => c.status === 'cancelled').length,
    tool_error_rate: success + failure > 0 ? failure / (success + failure) : null,
    retry_count: [...perStep.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0), model_request_count: attempts.length,
    completion_status: incomplete ? 'unknown' : status,
    session_duration_ms: lastStart ? Math.max(0, observations.findLast(e => e.turn !== undefined)!.time - observations.find(e => e.type === 'turn/start')!.time) : null,
    tool_duration_ms: list.reduce((sum, c) => sum + (c.duration_ms ?? 0), 0),
    message_count: observations.filter(e => ['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'].includes(e.type) && !e.is_replacement).length,
    request_series_count: observations.filter(e => e.starts_series).length,
    request_header_changes: observations.filter(e => e.type === 'request/header' && e.status === 'change').length,
    context_changes: Math.max(0, count('request/context') - 1), usage_coverage: attempts.length ? usages.length / attempts.length : 0,
  }
  const header = observations.findLast(e => e.type === 'request/header'), context = observations.findLast(e => e.type === 'request/context')
  if (header) summary.tool_schema_count = header.tool_schema_count
  if (context?.context_window !== undefined) summary.context_window = context.context_window
  if (usages.length) {
    summary.input_tokens = usages.reduce((sum, u) => sum + u.input_tokens, 0)
    summary.output_tokens = usages.reduce((sum, u) => sum + u.output_tokens, 0)
    summary.total_tokens = summary.input_tokens + summary.output_tokens
  }
  return { turns: [...turns.values()], summary }
}
