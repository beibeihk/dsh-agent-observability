/** Official Cordis plugin entry. Observes durable events; contributes no model-facing behavior. */
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Session, SessionId, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-app-boot'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { TraceRecorder } from './recorder/index.js'
import { renderText } from './report/index.js'
import { exportTrace, sessionDirectory } from './exporters/index.js'
import type { Options, Trace } from './types.js'

export * from './analysis.js'
export const name = 'agent-observability'
export const inject = ['sessions', 'sessionQuery']
export interface Config extends Options { outputDir: string; maxSessions: number }
export const Config = Schema.object({
  captureContent: Schema.boolean().default(false),
  outputDir: Schema.string().default(''),
  maxSessions: Schema.number().min(1).max(1024).step(1).default(64),
  maxEvents: Schema.number().min(1).max(1_000_000).step(1).default(100_000),
  maxContentBytes: Schema.number().min(1).max(1_048_576).step(1).default(16_384),
  redactionPatterns: Schema.array(String).default([]),
  repeatThreshold: Schema.number().min(2).step(1).default(3),
  repeatWindowMs: Schema.number().min(1).default(60_000),
  errorLoopThreshold: Schema.number().min(2).step(1).default(3),
  maxAttempts: Schema.number().min(1).step(1).default(3),
  longToolMs: Schema.number().min(1).default(30_000),
  failureRatio: Schema.number().min(0).max(1).default(0.5),
  minimumCalls: Schema.number().min(1).step(1).default(4),
  churnThreshold: Schema.number().min(1).step(1).default(5),
})

declare module '@deepseek-ai/cordis' { interface Context { dshObservability: Observability } }

/** Local API for human reports and normalized trace export. Raw events remain owned by Harness. */
export class Observability extends Service {
  private readonly recorders = new Map<SessionId, { recorder: TraceRecorder; ready: Promise<void>; initializing: boolean; buffered: SessionEvent[] }>()
  private readonly reads = new Set<Promise<void>>()
  private readonly cancellation = new AbortController()
  private readonly pending = new Map<SessionId, Session>()
  private writing?: Promise<void>
  private exportWrites: Promise<void> = Promise.resolve()
  private accepting = true
  private diagnostic?: string
  readonly outputDir: string

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'dshObservability')
    for (const pattern of config.redactionPatterns ?? []) new RegExp(pattern, 'gu')
    const profile = ctx.get('profileContext')
    this.outputDir = resolve(config.outputDir || join(profile?.dir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'observability'), ...(profile ? ['observability'] : [])))
    ctx.on('session/created', session => { this.safe(() => { this.ensure(session) }) })
    ctx.on('session/event', (session, event) => {
      if (!this.accepting) return
      this.safe(() => {
        const entry = this.ensure(session)
        if (entry.initializing) {
          if (entry.buffered.length < (this.config.maxEvents ?? 100_000)) entry.buffered.push(event)
          else entry.recorder.markTruncated()
        } else entry.recorder.record(event)
        if (event.type === 'turn/end') this.schedule(session)
      })
    })
    ctx.on('session/disposed', session => {
      if (!this.accepting) return
      this.schedule(session)
    })
    // A flush joins local exports but never throws into the agent's durability checkpoint.
    ctx.on('session/flush', async session => { this.schedule(session); await this.flush() })
    for (const session of ctx.sessions.list()) this.ensure(session)
    ctx.inject(['commands'], inner => {
      inner.commands.register({ name: 'observe', description: 'Export local reliability metrics and findings; no model turn.', recordInput: false,
        handler: async ({ agent }) => {
          try {
            const trace = await this.trace(agent.session)
            await this.export(agent.session)
            return { kind: 'success', text: renderText(trace) + `\nFiles: ${sessionDirectory(this.outputDir, trace.session.id)}` }
          } catch { return { kind: 'error', text: 'Observability export failed; inspect the plugin diagnostic and output directory permissions.' } }
        },
      })
    })
    ctx.effect(() => async () => { this.accepting = false; await this.flush(); this.cancellation.abort(); await Promise.all(this.reads); this.pending.clear(); this.recorders.clear() })
  }

  private safe(operation: () => void): void {
    try { operation() } catch { this.diagnostic = 'OBSERVATION_FAILED'; this.ctx.logger.warn('Observability capture failed; report may be incomplete.') }
  }
  private ensure(session: Session) {
    const previous = this.recorders.get(session.id)
    if (previous) return previous
    if (this.recorders.size >= this.config.maxSessions) this.recorders.delete(this.recorders.keys().next().value!)
    const recorder = new TraceRecorder(session.id, this.config, { agent_id: session.id, parent_session_id: session.header.parentSession, inherited_event_count: session.inheritedEventCount })
    const entry = { recorder, ready: Promise.resolve(), initializing: true, buffered: [] as SessionEvent[] }
    this.recorders.set(session.id, entry)
    if (this.reads.size >= this.config.maxSessions) {
      entry.initializing = false; recorder.markTruncated(); this.diagnostic = 'HISTORY_QUEUE_FULL'
      this.ctx.logger.warn('Observability history queue full; this capture is incomplete.')
      return entry
    }
    // Seeds do not emit session/event. Acquire one exact async cut and release its lease.
    entry.ready = this.ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none', signal: this.cancellation.signal }).then(lease => {
      try { for (const event of lease.events) recorder.record(event) }
      finally { lease[Symbol.dispose]() }
    }).catch(() => { recorder.markTruncated(); this.diagnostic = 'HISTORY_READ_FAILED'; this.ctx.logger.warn('Observability history read failed; report is incomplete.') }).finally(() => {
      for (const event of entry.buffered) recorder.record(event)
      entry.buffered = []; entry.initializing = false
    })
    this.reads.add(entry.ready)
    void entry.ready.finally(() => { this.reads.delete(entry.ready) })
    return entry
  }
  /** Read a detached normalized trace. Caller controls whether an open interval is final. */
  async trace(session: Session, finalized = false): Promise<Trace> { const entry = this.ensure(session); await entry.ready; return entry.recorder.snapshot(finalized) }
  /** Latest safe diagnostic; raw exception text never leaks prompts or credentials. */
  get error(): string | undefined { return this.diagnostic }
  /** Explicit export rejects on I/O failure so human callers can act on it. */
  async export(session: Session, finalized = false): Promise<void> {
    const trace = await this.trace(session, finalized)
    const write = this.exportWrites.then(() => exportTrace(trace, sessionDirectory(this.outputDir, trace.session.id)))
    this.exportWrites = write.catch(() => {})
    await write
  }
  private schedule(session: Session): void {
    if (this.pending.size >= this.config.maxSessions && !this.pending.has(session.id)) {
      this.diagnostic = 'EXPORT_QUEUE_FULL'; this.ctx.logger.warn('Observability export queue full; use /observe to export this session.'); return
    }
    this.pending.set(session.id, session)
    if (!this.writing) {
      this.writing = Promise.resolve().then(async () => {
        while (this.pending.size) {
          const entry = this.pending.entries().next().value!
          this.pending.delete(entry[0])
          try { await this.export(entry[1]) }
          catch { this.diagnostic = 'EXPORT_FAILED'; this.ctx.logger.warn('Observability export failed; check output directory permissions. Agent execution continues.') }
        }
      }).finally(() => { this.writing = undefined })
    }
  }
  /** Join the bounded export queue. */
  async flush(): Promise<void> { await this.writing; await this.exportWrites }
}

export function apply(ctx: Context, config: Config): void { ctx.plugin(Observability, config) }
