import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { EventInput, Observation, Options, Trace } from '../types.js'
import { redact, redactText, canonical } from '../redaction/index.js'
import { project } from '../metrics/index.js'
import { detect } from '../detectors/index.js'

export function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function numberOf(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }

/** One bounded neutral trace projection, with raw arguments used only for keyed equality hashing. */
export class TraceRecorder {
  private readonly observations: Observation[] = []
  private readonly hashKey = randomBytes(32)
  private lastSeq = -1
  private turn?: number
  private step?: number
  private truncated = false
  private readonly gaps: number[] = []
  readonly sessionId: string

  constructor(id: string, readonly options: Options = {}, readonly metadata: { agent_id?: string; parent_session_id?: string; inherited_event_count?: number } = {}) {
    this.sessionId = redactText(id, options.redactionPatterns)
    for (const pattern of options.redactionPatterns ?? []) new RegExp(pattern, 'gu')
  }

  /** Records a committed event without modifying or retaining its data object. Duplicate replay is ignored. */
  record(event: EventInput): void {
    if (!Number.isSafeInteger(event.seq) || event.seq < 0 || !Number.isFinite(event.time) || typeof event.type !== 'string') throw new TypeError('Invalid event envelope')
    if (event.seq <= this.lastSeq) return
    if (event.seq !== this.lastSeq + 1 && this.gaps.length < (this.options.maxEvents ?? 100_000)) this.gaps.push(event.seq)
    this.lastSeq = event.seq
    if (this.observations.length >= (this.options.maxEvents ?? 100_000)) { this.truncated = true; return }
    const data = recordOf(event.data)
    if (event.type === 'turn/start') { this.turn = numberOf(data.turn); this.step = undefined }
    if (event.type === 'step/start') this.step = numberOf(data.step)
    const observation: Observation = {
      session_id: this.sessionId, seq: event.seq, type: redactText(event.type, this.options.redactionPatterns), time: event.time,
      ...(this.metadata.agent_id ? { agent_id: redactText(this.metadata.agent_id, this.options.redactionPatterns) } : {}),
      turn: numberOf(data.turn) ?? this.turn, step: numberOf(data.step) ?? this.step,
      ...(event.surfaceOp && typeof event.surfaceOp === 'object' ? { is_replacement: true } : {}),
      ...(event.sourceEventSeqs ? { source_event_seqs: [...event.sourceEventSeqs] } : {}),
      ...(event.seq < (this.metadata.inherited_event_count ?? 0) ? { inherited: true } : {}),
    }
    const setText = (key: 'call_id' | 'tool_name' | 'provider' | 'model' | 'status' | 'error_class' | 'error_code', value: unknown) => {
      if (typeof value === 'string') observation[key] = redactText(value, this.options.redactionPatterns)
    }
    const message = recordOf(data.message)
    const error = recordOf(data.error)
    switch (event.type) {
      case 'tool/call': {
        setText('call_id', data.callId); setText('tool_name', data.name)
        if (typeof data.arguments === 'string') {
          let args: unknown = data.arguments
          try { args = JSON.parse(data.arguments) } catch { /* Malformed model JSON remains comparable as literal text. */ }
          observation.args_hash = createHmac('sha256', this.hashKey).update(canonical(args)).digest('hex')
          this.payload(observation, args)
        }
        break
      }
      case 'tool/result':
        setText('call_id', message.toolCallId)
        observation.status = message.isError === true ? (/^(ABORTED|ABORTED_BEFORE_DISPATCH)$/u.test(String(error.code)) ? 'cancelled' : 'error') : 'success'
        setText('error_class', error.name); setText('error_code', error.code)
        this.payload(observation, message.content)
        break
      case 'assistant/message': {
        this.payload(observation, message.content)
        const usage = recordOf(data.usage)
        const input = numberOf(usage.inputTokens), output = numberOf(usage.outputTokens)
        if (input !== undefined && output !== undefined && input >= 0 && output >= 0) observation.usage = { input_tokens: input, output_tokens: output }
        const source = recordOf(message.source)
        setText('provider', source.provider); setText('model', source.model)
        observation.status = data.interrupted === true ? 'interrupted' : 'settled'
        break
      }
      case 'assistant/attempt':
        observation.status = 'uncommitted'
        // Streams can contain reasoning. They are never copied or expanded by this plugin.
        break
      case 'request/header': {
        const header = recordOf(data.header), config = recordOf(header.config)
        setText('provider', config.provider); setText('model', config.model)
        observation.tool_schema_count = Array.isArray(header.tools) ? header.tools.length : 0
        observation.starts_series = data.reason === 'initial' || data.reason === 'series' || data.startsSeries === true
        setText('status', data.reason)
        break
      }
      case 'request/context':
        setText('provider', data.provider); setText('model', data.model)
        observation.context_window = numberOf(data.contextWindow)
        break
      case 'turn/end': setText('status', recordOf(data.reason).kind); break
      case 'user/message': this.payload(observation, data.content); break
      case 'system/message':
      case 'developer/message': this.payload(observation, message.content); break
      default: break // Merge-extensible events retain their envelope only; no opaque payload leakage.
    }
    this.observations.push(observation)
    if (event.type === 'step/end') this.step = undefined
    if (event.type === 'turn/end') { this.turn = undefined; this.step = undefined }
  }

  private payload(observation: Observation, value: unknown): void {
    if (value === undefined) return
    const content = redact(value, this.options.redactionPatterns)
    const json = JSON.stringify(content)
    const bytes = Buffer.byteLength(json), limit = this.options.maxContentBytes ?? 16_384
    observation.payload = { bytes, sha256: createHash('sha256').update(json).digest('hex'), ...(this.options.captureContent ? bytes <= limit ? { content } : { content: Buffer.from(json).subarray(0, limit).toString('utf8'), content_truncated: true } : {}) }
  }

  /** Mark a bounded or failed capture as incomplete; detectors must not infer absent evidence. */
  markTruncated(): void { this.truncated = true }

  /** Detached snapshot; finalized means the caller declares a closed observation interval. */
  snapshot(finalized = false): Trace {
    const observations = structuredClone(this.observations)
    const { turns, summary } = project(observations, this.truncated || this.gaps.length > 0)
    const trace: Trace = {
      schema_version: '1.0', source: 'deepseek-harness',
      session: { id: this.sessionId, inherited_event_count: this.metadata.inherited_event_count ?? 0,
        ...(this.metadata.agent_id ? { agent_id: redactText(this.metadata.agent_id, this.options.redactionPatterns) } : {}),
        ...(this.metadata.parent_session_id ? { parent_session_id: redactText(this.metadata.parent_session_id, this.options.redactionPatterns) } : {}),
      },
      privacy: { capture_content: this.options.captureContent ?? false, reasoning: 'excluded', hashes: 'redacted-sha256-and-session-keyed-args' },
      integrity: { finalized, truncated: this.truncated, sequence_gaps: [...this.gaps] },
      observations, turns, summary, findings: [],
    }
    trace.findings = detect(trace, this.options)
    return trace
  }
}
