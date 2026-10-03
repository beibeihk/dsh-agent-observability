/** Predeclared synthetic cases; labels are observable patterns, never real-world accuracy. */
export function synthetic(kind, index = 0) {
  const events = [], labels = []
  const add = (type, data) => events.push({ type, seq: events.length, time: 1000 + events.length * 10, data })
  const start = (step) => add('step/start', { turn: 1, step })
  const end = (step) => add('step/end', { turn: 1, step })
  const assistant = (step) => add('assistant/message', { turn: 1, step, message: { content: [{ type: 'text', text: `synthetic answer ${index}` }] }, stream: [] })
  const tool = (id, step, error = false, args = '{"x":1}') => {
    add('tool/call', { turn: 1, step, callId: id, name: 'lookup', arguments: args })
    add('tool/result', { turn: 1, step, message: { toolCallId: id, isError: error, content: [{ type: 'text', text: 'synthetic result' }] }, ...(error ? { error: { name: 'TestError', code: 'TEST' } } : {}) })
  }
  add('turn/start', { turn: 1 })
  let outcome = 'completed'
  if (kind === 'repeat' || kind === 'error-loop' || kind === 'high-errors') {
    const count = kind === 'high-errors' ? 4 : 3
    for (let step = 1; step <= count; step++) { start(step); assistant(step); tool(`c${step}`, step, kind !== 'repeat', kind === 'repeat' ? (step % 2 ? '{"x":1,"y":2}' : '{"y":2,"x":1}') : JSON.stringify({ step })); end(step) }
    labels.push(kind === 'repeat' ? 'F03' : 'F04')
    if (kind !== 'repeat') labels.push('T01')
    if (kind === 'high-errors') labels.push('F09')
  } else {
    start(1)
    if (kind === 'retry') { for (let i = 0; i < 3; i++) add('assistant/attempt', { turn: 1, step: 1, stream: [] }); labels.push('F05') }
    if (kind === 'churn') { for (let i = 0; i < 5; i++) add('request/header', { reason: 'change', header: { config: { provider: 'fake', model: `m${i}` } } }); labels.push('F10') }
    assistant(1)
    if (kind === 'missing') { add('tool/call', { turn: 1, step: 1, callId: 'missing', name: 'lookup', arguments: '{}' }); labels.push('F01') }
    else if (kind === 'parallel') {
      for (const id of ['a', 'b']) add('tool/call', { turn: 1, step: 1, callId: id, name: 'lookup', arguments: JSON.stringify({ id }) })
      for (const id of ['b', 'a']) add('tool/result', { turn: 1, step: 1, message: { toolCallId: id, isError: false, content: [] } })
    } else if (kind !== 'cancel') tool('c1', 1, kind === 'recovery')
    if (kind === 'recovery') { labels.push('T01'); end(1); start(2); assistant(2); tool('c2', 2, false, '{"x":2}'); end(2) }
    else end(1)
    if (kind === 'duplicate') { add('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1', content: [] } }); labels.push('F02') }
    if (kind === 'long') { const result = events.find(e => e.type === 'tool/result'); const position = result.seq; for (let i = position; i < events.length; i++) events[i].time += 31_000; labels.push('F08') }
    if (kind === 'abnormal') { outcome = 'error'; labels.push('F07') }
    if (kind === 'cancel') outcome = 'aborted'
  }
  add('turn/end', { turn: 1, reason: { kind: outcome } })
  if (kind === 'long') events.at(-1).time += 31_000
  return { id: `${kind}-${index}`, kind, events, labels }
}
export const kinds = ['normal', 'recovery', 'repeat', 'error-loop', 'missing', 'duplicate', 'retry', 'long', 'high-errors', 'churn', 'abnormal', 'cancel', 'parallel']
