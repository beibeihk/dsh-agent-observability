import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { TraceRecorder, renderText } from '../src/analysis.js'
import type { EventInput } from '../src/analysis.js'
for (const name of ['normal-session', 'tool-error', 'repeat-loop', 'parallel-tools', 'resume']) {
  it(`golden report: ${name}`, async () => {
    const directory = new URL(`../fixtures/${name}/`, import.meta.url)
    const events: EventInput[] = JSON.parse(await readFile(new URL('events.json', directory), 'utf8'))
    const recorder = new TraceRecorder(name)
    if (name === 'resume') for (const event of events.slice(0, events.length / 2)) recorder.record(event)
    for (const event of events) recorder.record(event)
    expect(renderText(recorder.snapshot(true))).toBe(await readFile(new URL('expected-report.txt', directory), 'utf8'))
  })
}
