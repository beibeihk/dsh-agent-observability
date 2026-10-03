/** Agent-neutral records; only the integration entry imports Harness event types. */
export interface EventInput {
  type: string
  seq: number
  time: number
  data: unknown
  surfaceOp?: unknown
  sourceEventSeqs?: readonly number[]
}
export interface Options {
  captureContent?: boolean
  redactionPatterns?: string[]
  maxEvents?: number
  maxContentBytes?: number
  repeatThreshold?: number
  repeatWindowMs?: number
  errorLoopThreshold?: number
  maxAttempts?: number
  longToolMs?: number
  failureRatio?: number
  minimumCalls?: number
  churnThreshold?: number
}
export interface Observation {
  session_id: string
  agent_id?: string
  seq: number
  type: string
  time: number
  turn?: number
  step?: number
  call_id?: string
  tool_name?: string
  provider?: string
  model?: string
  status?: string
  error_class?: string
  error_code?: string
  is_replacement?: boolean
  source_event_seqs?: readonly number[]
  inherited?: boolean
  args_hash?: string
  payload?: { bytes: number; sha256: string; content?: unknown; content_truncated?: boolean }
  usage?: { input_tokens: number; output_tokens: number }
  context_window?: number
  tool_schema_count?: number
  starts_series?: boolean
}
export interface ToolCall {
  call_id: string
  name: string
  turn: number
  step: number
  start: number
  end?: number
  duration_ms?: number
  status: 'pending' | 'success' | 'error' | 'cancelled'
  args_hash?: string
  call_seq: number
  result_seqs: number[]
  error_class?: string
  error_code?: string
}
export interface Step {
  step: number
  start_seq?: number
  end_seq?: number
  request: Observation[]
  assistant: Observation[]
  tool_calls: ToolCall[]
}
export interface Turn {
  turn: number
  start_seq?: number
  end_seq?: number
  outcome?: string
  steps: Step[]
}
export interface Finding {
  failure_id: string
  failure_type: string
  severity: 'info' | 'warning' | 'error'
  session_id: string
  evidence_event_seqs: number[]
  message: string
  metrics: Record<string, number | string>
}
export interface Metrics {
  turn_count: number
  step_count: number
  tool_call_count: number
  tool_success_count: number
  tool_failure_count: number
  tool_cancelled_count: number
  tool_error_rate: number | null
  retry_count: number
  model_request_count: number
  completion_status: string
  session_duration_ms: number | null
  tool_duration_ms: number
  message_count: number
  request_series_count: number
  request_header_changes: number
  context_changes: number
  tool_schema_count?: number
  context_window?: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  usage_coverage: number
}
export interface Trace {
  schema_version: '1.0'
  source: 'deepseek-harness'
  session: { id: string; agent_id?: string; parent_session_id?: string; inherited_event_count: number }
  privacy: { capture_content: boolean; reasoning: 'excluded'; hashes: 'redacted-sha256-and-session-keyed-args' }
  integrity: { finalized: boolean; truncated: boolean; sequence_gaps: number[] }
  observations: Observation[]
  turns: Turn[]
  summary: Metrics
  findings: Finding[]
}
