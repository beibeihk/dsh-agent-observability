import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, LlmError, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query-sqlite'

/** Deterministic offline adapter; exercises the published loop without paid requests. */
export class ScriptedAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  constructor(private readonly responses: Array<StreamChunk[] | 'error' | 'hang'>) { super() }
  resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return Promise.resolve({ provider, id: model, name: model, contextWindow: 8192 }) }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    const response = this.responses.shift()
    if (!response) throw new Error('Deterministic script exhausted')
    if (response === 'error') throw new LlmError('Synthetic transport failure', 'NETWORK')
    if (response === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) resolve()
        else request.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return
    }
    for (const chunk of response) yield chunk
  }
}
export function answer(text = 'done'): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }, { type: 'finish', reason: { kind: 'stop' } }]
}
export function toolCalls(ids = ['a']): StreamChunk[] {
  return [...ids.flatMap((id, index): StreamChunk[] => [
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id: ToolCallId(id), name: 'lookup', argumentsDelta: '{"key":"test"}' },
    { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(id), name: 'lookup', arguments: '{"key":"test"}' } },
  ]), { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }, { type: 'finish', reason: { kind: 'tool-calls' } }]
}
export async function harness(adapter: ScriptedAdapter, root?: string) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Query, { path: ':memory:', openAt: 'never' })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (root) await ctx.plugin(Persistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['fake'], adapter)
  ctx.tools.register(defineTool({ name: 'lookup', description: 'Deterministic lookup', parameters: { key: { type: 'string', required: true } }, isConcurrencySafe: () => true,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'found' },
  }))
  return ctx
}
export async function run(agent: Agent, text = 'Look up test and finish'): Promise<void> {
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
  await agent.whenIdle()
}

/** Ignore generated identities and timing only; all event data and model/tool outputs remain compared. */
export function semantics(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, 'GENERATED_ID')
  if (Array.isArray(value)) return value.map(semantics)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['time', 'time0', 'dt'].includes(key)).map(([key, item]) => [key, semantics(item)]))
  return value
}
