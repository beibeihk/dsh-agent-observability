import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bin = resolve(dirname(manifestPath), typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.dsh)
/** Invoke the package's declared public dsh executable, never a second app runtime. */
export function dsh(args, env = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, DSH_TELEMETRY_DISABLED: '1', ...env }, timeout: 180_000, maxBuffer: 5 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) throw new Error(`Official dsh command failed (${result.status ?? result.error?.code ?? 'unknown'})`)
  return result.stdout
}
