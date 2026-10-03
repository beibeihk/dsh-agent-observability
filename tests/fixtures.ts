/** Incomplete traces use the neutral input API; live integration uses real Harness events. */
import type { EventInput } from '../src/types.js'
export function call(id: string, step = 1, args = '{"x":1}'): Omit<EventInput, 'seq' | 'time'> {
  return { type: 'tool/call', data: { turn: 1, step, callId: id, name: 'lookup', arguments: args } }
}
export function result(id: string, error = false, step = 1): Omit<EventInput, 'seq' | 'time'> {
  return { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step, message: { toolCallId: id, isError: error, content: [{ type: 'text', text: 'private result' }] }, ...(error ? { error: { name: 'LookupError', code: 'NOT_FOUND' } } : {}) } }
}
export function fixture(tools = [call('a'), result('a')]): EventInput[] {
  const raw = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text: 'private task' }] } },
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { content: [] }, stream: [] } },
    ...tools,
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'step/start', data: { turn: 1, step: 2 } },
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'done' }] }, stream: [] } },
    { type: 'step/end', data: { turn: 1, step: 2 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return raw.map((e, seq) => ({ ...e, seq, time: 100 + seq }))
}
