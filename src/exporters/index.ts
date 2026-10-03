import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { Trace } from '../types.js'
import { renderHtml, renderText } from '../report/index.js'

export function toJsonl(trace: Trace): string { return trace.observations.map(o => JSON.stringify(o)).join('\n') + (trace.observations.length ? '\n' : '') }
export function toEval(trace: Trace) {
  return trace.findings.map(f => ({ schema_version: '1.0', task: { session_id: trace.session.id }, agent_configuration: trace.observations.filter(e => e.type.startsWith('request/')), observable_trace: trace.observations, failure_label: f.failure_type, severity: f.severity, evidence: f.evidence_event_seqs, outcome: trace.summary.completion_status, privacy: trace.privacy, integrity: trace.integrity }))
}
/** Write-then-rename keeps previously exported files intact if a new export is interrupted. */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}
/** Safe file identity prevents session ids from becoming filesystem paths. */
export function sessionDirectory(root: string, id: string): string { return join(root, createHash('sha256').update(id).digest('hex').slice(0, 24)) }
export async function exportTrace(trace: Trace, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const files = {
    'trace.json': JSON.stringify(trace, null, 2) + '\n', 'trace.jsonl': toJsonl(trace),
    'summary.json': JSON.stringify({ session: trace.session, ...trace.summary, integrity: trace.integrity }, null, 2) + '\n',
    'eval.jsonl': toEval(trace).map(e => JSON.stringify(e)).join('\n') + (trace.findings.length ? '\n' : ''),
    'report.txt': renderText(trace), 'report.html': renderHtml(trace),
    'summary.csv': Object.keys(trace.summary).join(',') + '\n' + Object.values(trace.summary).map(v => JSON.stringify(v ?? '')).join(',') + '\n',
  }
  // Files are individually atomic; the set is not a cross-file transaction.
  for (const [file, content] of Object.entries(files)) await atomicWrite(join(directory, file), content)
}
