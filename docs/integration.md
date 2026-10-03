# Installation, configuration and lifecycle

The package is an official-format **bundle**, not a second Harness launcher. `dsh.bundle.patch` inserts the `agent-observability` row. Install a prebuilt tarball using `dsh plugin --profile web add ./beibeihk-dsh-agent-observability-0.1.0.tgz`, then inspect `dsh --profile web --dump-config` and run `dsh web`. npm registry publishing is prepared but awaits maintainer login. The release tarball requires no dependency build-script permission.

For a profile configuration change, add this row to that profile's existing `cordis.patch.yml`; preserve unrelated rows. A patch replaces the whole config value, so restate all nondefault options together:

```yaml
- id: agent-observability
  config:
    captureContent: false
    outputDir: /absolute/path/to/local-reports
    longToolMs: 60000
    repeatThreshold: 4
    redactionPatterns:
      - 'CUSTOM_SECRET_[A-Za-z0-9]+'
```

`outputDir` defaults to the current profile directory's `observability/`, using public launcher `profileContext` when available. Direct in-process testing without a profile uses `$DSH_HOME/observability` (default `~/.dsh/observability`). Relative explicit paths resolve against the launching working directory. Session IDs become fixed-length directory hashes so they cannot escape the root.

Optional fields and defaults: `captureContent=false`, `maxSessions=64`, `maxEvents=100000`, `maxContentBytes=16384`, `repeatThreshold=3`, `repeatWindowMs=60000`, `errorLoopThreshold=3`, `maxAttempts=3`, `longToolMs=30000`, `failureRatio=0.5`, `minimumCalls=4`, `churnThreshold=5`, `redactionPatterns=[]`. Schema rejects invalid numbers; invalid regex fails plugin load. V1 keeps safe defaults and groups advanced threshold changes in one patch rather than a separate configuration system.

`/observe` works when the profile provides `commands`; it exports the receiving Agent's current Session and returns the text report and directory. It records a human-command lifecycle through Harness, does not send its command text to the model, and does not introduce a model-facing tool. Basic automatic capture works without `commands`, provided `sessions` and `sessionQuery` exist.

```ts
// In an existing Harness plugin injecting ['dshObservability']:
const trace = await ctx.dshObservability.trace(agent.session)
await ctx.dshObservability.export(agent.session)
await ctx.dshObservability.flush()
```

`trace(session, true)` explicitly closes the observation interval for fixture/analysis purposes. Default snapshots respect durable turn closers and leave live unmatched tools pending. Never finalize an actively running interval solely to classify its pending tools as failure.

To disable, use Web's Plugin Manager to toggle the row, or a profile patch with `disabled: true`. To remove: `dsh plugin --profile web remove @beibeihk/dsh-agent-observability`. Cordis unmount removes listeners, optional command and local service; remount reads a canonical async history cut. Peer ranges require exactly `0.2.0-rc.2`; do not bypass compatibility checks without new integration evidence.

Export buffering is bounded and asynchronous. Every finished snapshot replaces files atomically, preserving the preceding valid JSONL on interruption. Files are independently replaced; compare timestamps or regenerate if inspecting during a concurrent export. Latest unexported events may be lost in a hard process crash. Recovery reconstructs through the official Session query service when the underlying Harness log is available; no private physical-format parser is included.

There is no automatic disk retention deletion. Delete an old hashed directory under the configured output root to remove **plugin exports**; this does not delete upstream Session logs. Retained recorder eviction changes no agent state; a later request may re-read its durable history. Retention bounds concern plugin memory, not Harness's own event store.
