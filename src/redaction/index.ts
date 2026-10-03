/** Exported content is redacted before hashing or serialization; reasoning is always excluded. */
const SECRET_FIELD = /(?:api[_-]?key|authorization|cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token|private[_-]?key)/iu
const REASONING_FIELD = /^(?:reasoning|reasoning_content|chain_of_thought|thinking|stream)$/iu
const TOKEN_PATTERNS = [
  /\b(?:sk|pk|ghp|gho|github_pat|xoxb|xoxp)[-_][A-Za-z0-9_-]{8,}\b/gu,
  /\bBearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]+/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
  /^(\s*(?:authorization|proxy-authorization|cookie|set-cookie)\s*:)\s*[^\r\n]*/gimu,
  /((?:["']?[A-Za-z0-9_-]*(?:api[_-]?key|password|passwd|secret|access[_-]?token|refresh[_-]?token)[A-Za-z0-9_-]*["']?)\s*[:=]\s*)(?:\[REDACTED\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\r\n}\]]+)/giu,
]

/** Custom patterns are trusted local configuration and must not use catastrophic backtracking. */
export function redactText(value: string, patterns: readonly string[] = []): string {
  let result = value
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, (_match, prefix: unknown) => typeof prefix === 'string' ? `${prefix}[REDACTED]` : '[REDACTED]')
  }
  for (const pattern of patterns) result = result.split('[REDACTED]').map(part => part.replace(new RegExp(pattern, 'gu'), '[REDACTED]')).join('[REDACTED]')
  return result
}

/** Recursively redact a JSON-compatible value without retaining arbitrary objects. */
export function redact(value: unknown, patterns: readonly string[] = []): unknown {
  if (typeof value === 'string') return redactText(value, patterns)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value
    .filter(item => !(item && typeof item === 'object' && 'type' in item && /reasoning|thinking/iu.test(String(item.type))))
    .map(item => redact(item, patterns))
  if (typeof value !== 'object' || value === undefined) return null
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !REASONING_FIELD.test(key))
    .map(([key, item]) => [redactText(key, patterns), SECRET_FIELD.test(key) ? '[REDACTED]' : redact(item, patterns)]))
}

/** Stable JSON used to compare argument objects independent of key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
