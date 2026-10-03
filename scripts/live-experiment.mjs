/** Opt-in credentialed smoke experiment. Public toy tasks only; never part of CI. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import Projection from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as Observer from '../lib/index.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

if (!process.argv.includes('--run-paid') || !process.env.DEEPSEEK_API_KEY) throw new Error('Explicit --run-paid and DEEPSEEK_API_KEY are required. Never put a key in this file.')
const ctx = new Context(), rows = [], began = new Date().toISOString()
try {
  await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore)
  await ctx.plugin(Query, { path: ':memory:', openAt: 'never' }); await ctx.plugin(Projection)
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools); await ctx.plugin(Agents)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(DeepSeek, { baseURL: 'https://api.deepseek.com/anthropic', apiKeyEnv: 'DEEPSEEK_API_KEY', thinking: 'disabled', reasoningEffort: 'off', maxTokens: 128 })
  await ctx.plugin(Observer, { outputDir: resolve('artifacts/live'), captureContent: false })
  ctx.tools.register(defineTool({ name: 'public_lookup', description: 'Return a public experimental marker for one case key.', parameters: { key: { type: 'string', required: true } }, isConcurrencySafe: () => true,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute({ key }) { return `PUBLIC_RESULT_${key}` },
  }))
  for (let i = 1; i <= 10; i++) {
    const key = `case_${i}`, task = `Call public_lookup exactly once with key "${key}". Return exactly its output text, without other text.`, expected = `PUBLIC_RESULT_${key}`
    const { agent, dispose } = await ctx.agents.create({ sessionId: SessionId(`live-public-${i}`), agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 128 } })
    const started = performance.now(), timeout = setTimeout(() => agent.cancel({ kind: 'user' }), 60_000)
    try {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: task }] }))
      await agent.whenIdle()
      const trace = await ctx.dshObservability.trace(agent.session)
      const lease = await ctx.sessionQuery.observeSession(agent.session.id, { projectionMode: 'none' })
      let final = ''
      try { for (const event of lease.events) if (event.type === 'assistant/message') final = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('') }
      finally { lease[Symbol.dispose]() }
      await ctx.dshObservability.export(agent.session)
      const row = { id: key, task, expected, final_text: final, exact_match: final.trim() === expected, exactly_one_successful_tool: trace.summary.tool_call_count === 1 && trace.summary.tool_success_count === 1, elapsed_ms: performance.now() - started, summary: trace.summary, findings: trace.findings.map(f => ({ type: f.failure_type, evidence: f.evidence_event_seqs })) }
      rows.push(row)
      console.log(JSON.stringify({ case: key, status: row.summary.completion_status, exact_match: row.exact_match, tool_calls: row.summary.tool_call_count }))
    } finally { clearTimeout(timeout); await dispose() }
  }
  const result = { schema_version: '1.0', started_at: began, completed_at: new Date().toISOString(), harness: '0.2.0-rc.2', provider: 'deepseek-official', model_alias: 'deepseek-flash', thinking: 'disabled', output_cap_per_request: 128, tasks: rows.length, exact_matches: rows.filter(r => r.exact_match).length, single_successful_tool_tasks: rows.filter(r => r.exactly_one_successful_tool).length, limitation: 'Ten scripted public lookup markers, no blinded labels or model/observer causal comparison. Not a real-world accuracy benchmark.', rows }
  await mkdir('docs/experiments', { recursive: true })
  await writeFile('docs/experiments/live-results.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ tasks: result.tasks, exact_matches: result.exact_matches, single_successful_tool_tasks: result.single_successful_tool_tasks }))
} catch {
  console.error('Credentialed experiment could not complete; inspect only sanitized provider diagnostics. No credential or raw exception is printed.')
  process.exitCode = 1
} finally { await ctx.fiber.dispose() }
