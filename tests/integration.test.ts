import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import Commands from '@deepseek-ai/dsh-commands'
import * as plugin from '../src/index.js'
import { sessionDirectory, exportTrace } from '../src/analysis.js'
import { harness, ScriptedAdapter, toolCalls, answer, run, semantics } from './harness.js'

async function temporary() { return mkdtemp(join(tmpdir(), 'dsh-observe-')) }
describe('published Harness 0.2.0-rc.2 integration', () => {
  it('the human /observe command makes no model turn and is unregistered on disposal', async () => {
    const root = await temporary(), adapter = new ScriptedAdapter([answer()]), ctx = await harness(adapter)
    try {
      await ctx.plugin(Commands)
      const fiber = await ctx.plugin(plugin, { outputDir: root })
      const { agent } = await ctx.agents.create({ sessionId: SessionId('command'), agentOptions: { provider: 'fake', model: 'deterministic' } })
      await run(agent)
      const before = (await ctx.dshObservability.trace(agent.session)).summary
      const outcome = await ctx.commands.execute(agent, '/observe', [], new AbortController().signal)
      expect(outcome?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('Session Reliability Report') })
      expect(adapter.requests).toHaveLength(1)
      expect((await ctx.dshObservability.trace(agent.session)).summary).toEqual(before)
      await Promise.all([ctx.dshObservability.export(agent.session), ctx.dshObservability.export(agent.session)])
      expect(JSON.parse(await readFile(join(sessionDirectory(root, 'command'), 'summary.json'), 'utf8')).turn_count).toBe(1)
      await fiber.dispose()
      expect(ctx.commands.find(agent, 'observe')).toBeUndefined()
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
  it('observer preserves semantic durable events and exact model-visible requests', async () => {
    const root = await temporary()
    const execute = async (observed: boolean) => {
      const adapter = new ScriptedAdapter([toolCalls(), answer()])
      const ctx = await harness(adapter)
      try {
        if (observed) await ctx.plugin(plugin, { outputDir: root })
        const { agent, dispose } = await ctx.agents.create({ sessionId: SessionId('equivalence'), agentOptions: { provider: 'fake', model: 'deterministic' } })
        await run(agent)
        const events = semantics(agent.session.snapshotEvents()), requests = semantics(adapter.requests.map(r => ({ messages: r.messages, tools: r.tools, model: r.model, provider: r.provider })))
        if (observed) {
          const trace = (await ctx.dshObservability.trace(agent.session))
          expect(trace.findings).toEqual([])
          expect(trace.summary).toMatchObject({ tool_call_count: 1, step_count: 2, input_tokens: 20, output_tokens: 4 })
          await ctx.dshObservability.flush()
          expect(JSON.parse(await readFile(join(sessionDirectory(root, 'equivalence'), 'summary.json'), 'utf8')).completion_status).toBe('completed')
        }
        await dispose()
        return { events, requests }
      } finally { await ctx.fiber.dispose() }
    }
    try { expect(await execute(true)).toEqual(await execute(false)) }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  it('unmount removes listeners and service; remount replays without duplicate statistics', async () => {
    const root = await temporary(), ctx = await harness(new ScriptedAdapter([answer(), answer()]))
    try {
      const fiber = await ctx.plugin(plugin, { outputDir: root })
      const { agent } = await ctx.agents.create({ sessionId: SessionId('reload'), agentOptions: { provider: 'fake', model: 'deterministic' } })
      await run(agent)
      const before = (await ctx.dshObservability.trace(agent.session)).summary
      const retired = ctx.dshObservability
      await fiber.dispose()
      expect(ctx.get('dshObservability')).toBeUndefined()
      await run(agent)
      await ctx.plugin(plugin, { outputDir: root })
      expect(ctx.dshObservability).not.toBe(retired)
      expect((await ctx.dshObservability.trace(agent.session)).summary.turn_count).toBe(before.turn_count + 1)
      const remounted = (await ctx.dshObservability.trace(agent.session)).summary
      await ctx.dshObservability.flush()
      expect((await ctx.dshObservability.trace(agent.session)).summary).toEqual(remounted)
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
  it('parallel tools and retried model requests retain call/step identities', async () => {
    const root = await temporary(), ctx = await harness(new ScriptedAdapter(['error', toolCalls(['a', 'b']), answer()]))
    try {
      let retried = false
      ctx.on('agent/request-error', async (_payload, next) => { if (!retried) { retried = true; return { kind: 'retry' } }; return next() })
      await ctx.plugin(plugin, { outputDir: root })
      const { agent } = await ctx.agents.create({ sessionId: SessionId('retry'), agentOptions: { provider: 'fake', model: 'deterministic' } })
      await run(agent)
      const trace = (await ctx.dshObservability.trace(agent.session))
      expect(trace.summary).toMatchObject({ step_count: 2, retry_count: 1, model_request_count: 3, tool_call_count: 2, tool_success_count: 2 })
      expect(trace.findings).toEqual([])
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
  it('real loop cancellation has cancelled status without F07', async () => {
    const root = await temporary(), ctx = await harness(new ScriptedAdapter(['hang']))
    try {
      await ctx.plugin(plugin, { outputDir: root })
      const { agent } = await ctx.agents.create({ sessionId: SessionId('cancel'), agentOptions: { provider: 'fake', model: 'deterministic' } })
      const seen = Promise.withResolvers<void>()
      ctx.on('agent/assistant-stream', ({ frame }) => { if (frame.type === 'chunk') seen.resolve() })
      const running = run(agent)
      await seen.promise
      agent.cancel({ kind: 'user' })
      await running
      const trace = (await ctx.dshObservability.trace(agent.session))
      expect(trace.summary.completion_status).toBe('cancelled')
      expect(trace.findings.some(f => f.failure_type === 'F07')).toBe(false)
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
  it('persists, stops and resumes using the official persistence API', async () => {
    const root = await temporary()
    let prefix: unknown
    const first = await harness(new ScriptedAdapter([answer()]), join(root, 'sessions'))
    try {
      await first.plugin(plugin, { outputDir: join(root, 'traces') })
      const handle = await first.agents.create({ sessionId: SessionId('resume'), agentOptions: { provider: 'fake', model: 'deterministic' } })
      await run(handle.agent)
      prefix = (await first.dshObservability.trace(handle.agent.session)).summary
      await first.sessions.flush(handle.agent.session)
      await handle.dispose()
    } finally { await first.fiber.dispose() }
    const second = await harness(new ScriptedAdapter([answer()]), join(root, 'sessions'))
    try {
      await second.plugin(plugin, { outputDir: join(root, 'traces') })
      const { agent } = await second.agents.resume({ resumeSessionId: SessionId('resume'), agentOptions: { provider: 'fake', model: 'deterministic' } })
      expect((await second.dshObservability.trace(agent.session)).summary).toEqual(prefix)
      await run(agent)
      expect((await second.dshObservability.trace(agent.session)).summary.turn_count).toBe(2)
    } finally { await second.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
  it('fork marks inherited evidence and metrics count child-owned work only', async () => {
    const root = await temporary(), ctx = await harness(new ScriptedAdapter([answer(), answer()]))
    try {
      await ctx.plugin(plugin, { outputDir: root })
      const { agent: parent } = await ctx.agents.create({ sessionId: SessionId('parent'), agentOptions: { provider: 'fake', model: 'deterministic' } })
      await run(parent)
      const seed = parent.session.snapshotEvents()
      const { agent: child } = await ctx.agents.create({ sessionId: SessionId('child'), seed, inheritedEventCount: SessionLogOffset(seed.length), meta: { isSeeded: true, parentSession: parent.id }, agentOptions: { provider: 'fake', model: 'deterministic' } })
      await run(child)
      const trace = (await ctx.dshObservability.trace(child.session))
      expect(trace.session.parent_session_id).toBe('parent')
      expect(trace.observations.filter(o => o.inherited).length).toBe(seed.length)
      expect(trace.summary.turn_count).toBe(1)
      expect((await ctx.dshObservability.trace(parent.session)).summary.turn_count).toBe(1)
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
  it('export I/O failure does not abort the agent or corrupt previous files', async () => {
    const root = await temporary(), ctx = await harness(new ScriptedAdapter([answer()]))
    try {
      const blocker = join(root, 'not-a-directory'); await writeFile(blocker, 'existing')
      await ctx.plugin(plugin, { outputDir: blocker })
      const { agent } = await ctx.agents.create({ sessionId: SessionId('io-error'), agentOptions: { provider: 'fake', model: 'deterministic' } })
      await run(agent); await ctx.dshObservability.flush()
      expect(ctx.dshObservability.error).toBe('EXPORT_FAILED')
      expect((await ctx.dshObservability.trace(agent.session)).summary.completion_status).toBe('completed')
      expect(await readFile(blocker, 'utf8')).toBe('existing')
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
  it('exported JSONL is valid and session ids cannot escape the output directory', async () => {
    const root = await temporary(), ctx = new Context()
    try {
      await ctx.plugin(SessionStore); await ctx.plugin(Query, { path: ':memory:', openAt: 'never' }); await ctx.plugin(plugin, { outputDir: root })
      const session = ctx.sessions.create(SessionId('../../escape'))
      const trace = (await ctx.dshObservability.trace(session))
      const directory = sessionDirectory(root, trace.session.id)
      await mkdir(directory, { recursive: true }); await exportTrace(trace, directory)
      expect(directory.startsWith(root)).toBe(true)
      expect(JSON.parse(await readFile(join(directory, 'trace.json'), 'utf8')).session.id).toBe('../../escape')
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
})
