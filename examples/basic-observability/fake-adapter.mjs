import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
export const name = 'observability-demo-adapter'
export const inject = ['llm', 'tools']

/** Offline adapter loaded by the official dsh profile launcher. */
class DemoAdapter extends LlmAdapter {
  calls = 0
  resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: 'Offline deterministic demo' }) }
  async *stream() {
    if (this.calls++ === 0) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('demo-call'), name: 'observe_lookup', argumentsDelta: '{"key":"observability"}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('demo-call'), name: 'observe_lookup', arguments: '{"key":"observability"}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Deterministic task completed: event-grounded trace recorded.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Deterministic task completed: event-grounded trace recorded.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
export function apply(ctx) {
  ctx.llm.registerAdapter(['fake-observability'], new DemoAdapter())
  ctx.tools.register(defineTool({ name: 'observe_lookup', description: 'Offline demo lookup', parameters: { key: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'event-grounded, privacy-first, eval-ready' },
  }))
}
