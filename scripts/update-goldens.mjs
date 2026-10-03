/** Explicit maintainer action only: inspect fixture/report diffs before committing. */
import { mkdir, writeFile } from 'node:fs/promises'
import { TraceRecorder, renderText } from '../lib/analysis.js'
import { synthetic } from './synthetic.mjs'
const cases = [['normal-session', 'normal'], ['tool-error', 'recovery'], ['repeat-loop', 'repeat'], ['parallel-tools', 'parallel'], ['resume', 'normal']]
for (const [name, kind] of cases) {
  const { events } = synthetic(kind)
  if (name === 'resume') {
    const next = structuredClone(events)
    for (const event of next) { event.seq += events.length; event.time += 1000; if (event.data.turn) event.data.turn = 2 }
    events.push(...next)
  }
  const directory = new URL(`../fixtures/${name}/`, import.meta.url)
  await mkdir(directory, { recursive: true })
  const recorder = new TraceRecorder(name)
  for (const event of events) recorder.record(event)
  await writeFile(new URL('events.json', directory), JSON.stringify(events, null, 2) + '\n')
  await writeFile(new URL('expected-report.txt', directory), renderText(recorder.snapshot(true)))
}
