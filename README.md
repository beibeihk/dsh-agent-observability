# dsh-agent-observability

Community plugin for **DeepSeek Harness**. Event-grounded, privacy-first, eval-ready reliability analysis. No official affiliation or endorsement.

[中文](https://github.com/beibeihk/dsh-agent-observability/blob/main/README.zh-CN.md) · [Demo report](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/demo/report.html) · [Technical report](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/technical-report.md) · [Study guide](https://github.com/beibeihk/dsh-agent-observability/blob/main/DEEPSEEK_HARNESS_STUDY_GUIDE.md)

## Quick Start

**Install** Node.js `^22.19.0 || >=24`, pnpm, and the tested Harness release. Download the prebuilt plugin tarball from [v0.1.0](https://github.com/beibeihk/dsh-agent-observability/releases/tag/v0.1.0).

```sh
npm install --global @deepseek-ai/dsh@0.2.0-rc.2 pnpm
dsh plugin --profile web add ./beibeihk-dsh-agent-observability-0.1.0.tgz
```

**Enable**: `dsh plugin add` selects the bundle automatically. Confirm the `agent-observability` row:

```sh
dsh --profile web --dump-config
```

**Run**:

```sh
dsh web
```

Run your usual task in Web (your own model credentials are required), then submit **`/observe`** in that session. The command returns metrics and findings without a model turn. Reports also export automatically at durable turn completion and session flush.

**View report**: `/observe` prints its directory. Open `report.html` locally. Default location: `$DSH_HOME/profiles/web/observability/<hashed-session-id>/` (`DSH_HOME` defaults to `~/.dsh`). Files: `trace.json`, `trace.jsonl`, `summary.json`, `summary.csv`, `eval.jsonl`, `report.txt`, `report.html`.

The npm package is prepared as `@beibeihk/dsh-agent-observability`; v0.1.0's release tarball is the supported installation while registry publication awaits maintainer authentication. Do not assume an unpublished registry package is available.

### Keyless, reproducible demo

```sh
git clone https://github.com/beibeihk/dsh-agent-observability.git
cd dsh-agent-observability
npm ci --ignore-scripts
npm run demo
```

The demo packs the built plugin, installs it with **the real `dsh plugin --profile headless add`**, and runs **the real `dsh --profile headless --patch ...`** with an offline deterministic adapter and tool. It uses an isolated project-local `.demo-home`, disables Harness telemetry for this experiment, and writes `artifacts/demo/report.html`, `trace.jsonl`, and `summary.json`. No paid API calls. [Example details](https://github.com/beibeihk/dsh-agent-observability/blob/main/examples/basic-observability/README.md).

## What it does

Reconstructs Session → Turn → Step → Model settlement → Tool call/result trajectories from committed session evidence. Computes reliability metrics, detects bounded observable patterns, cites exact event sequence numbers, and exports failure cases for later evaluation. [Normalized schema](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/schema.md).

## Why

A console log cannot reliably distinguish retries from steps, a cancelled turn from an errored one, or a surface rewrite from a second tool result. The Harness session log records the facts the model context derives from; this plugin uses those facts without rewriting them.

## Example Output

```text
Session Reliability Report
Status: completed
Turns: 1 | Steps: 2 | Model requests (settled): 2
Tool calls: 1 | Successes: 1 | Failures: 0 | Cancelled: 0
Detected Issues:
- None detected
```

This excerpt comes from the offline Harness demo. [Full output](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/demo/report.txt) · [Dashboard](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/demo/report.html). The dashboard is static HTML with no scripts, external assets, or arbitrary overall score.

![Actual offline Harness report](https://raw.githubusercontent.com/beibeihk/dsh-agent-observability/main/docs/demo/dashboard.jpg)

## Failure Detectors

| ID | Observable pattern | Default |
|---|---|---|
| F01 | Call without terminal result in a closed, complete interval | Error; suppressed for cancellation/fork closure |
| F02 | Multiple terminal results in the same turn/step/call | Error; surface replacements excluded |
| F03 | Consecutive equivalent calls | 3 calls within 60 s |
| F04 | Same tool fails across consecutive steps | 3 failures |
| F05 | Excessive settled model attempts per step | More than 3 |
| F07 | Durable abnormal turn termination | Error/interruption; warnings for policy/token limits |
| F08 | Call-to-result latency above threshold | More than 30 s |
| F09 | High tool error ratio | More than 50%, at least 4 success/error results |
| F10 | Frequent logged request/context changes | At least 5; informational |
| T01 | Observed tool error | Informational; recovery can still complete |

F06 is deferred: model text and tool success do not objectively establish task progress. Findings detect evidence-backed runtime and trajectory patterns, not all agent failure causes or answer correctness. [Definitions, examples and false-positive risks](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/failure-taxonomy.md).

## Architecture

The official `dsh.bundle.patch` inserts one Cordis plugin. It injects `sessions` and `sessionQuery`, subscribes to observe-only `session/event`, and replays seeds through asynchronous `sessionQuery.observeSession()` leases. A typed local `ctx.dshObservability` service exposes `trace()`, `export()`, `flush()` and a diagnostic. Optional `ctx.commands` contributes `/observe` as a human command. All listeners and services unwind with their Cordis fiber.

No loop modification, monkey patches, node_modules edits, waterfall interception, additional model tool schemas, or prompt injection. [Architecture](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/architecture.md) · [Integration](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/integration.md).

## Privacy

**Metadata-only by default. No telemetry is sent by this plugin.** Capture requires `captureContent: true`; redaction remains enabled. Reasoning blocks and embedded assistant streams are always excluded. Exported content hashes cover redacted content; argument equality uses an ephemeral session-keyed HMAC. Opaque tool metadata is never copied. [Privacy and threat limits](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/privacy.md).

The upstream Harness has its own telemetry and provider session-log behavior; installing this plugin does not change either. Our demo explicitly opts out of Harness telemetry. Capturing plaintext into Harness itself is outside this plugin's redaction layer.

## Performance

`npm run benchmark` runs 130 labeled synthetic traces, a 10,000-event recorder microbenchmark and the published Session event-dispatch benchmark. On Node 24.12.0 / Windows x64, the recorder adds **9.62 μs/event** in metadata mode; official `Session.append` plus observation adds **34.20 μs/event (+79.67% in that message-only microbenchmark)**. Content mode adds 27.64 μs/event in the latter. These figures exclude model latency and disk I/O and do not describe end-to-end task overhead. Heap/RSS deltas are noisy, GC-sensitive measurements. [Raw results](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/benchmarks/results.json) · [Method and limitations](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/technical-report.md).

The 130 synthetic traces produce 130 true-positive session/type label pairs, zero false positives and zero false negatives (precision/recall 1.0). They come from 13 designed templates with limited variation, not independent real-world tasks; this validates the specified rules, not general agent accuracy.

Memory is bounded by `maxSessions` (64), `maxEvents` (100,000 per retained session), and `maxContentBytes` (16 KiB per captured payload). Bounded history bootstrap and export queues report saturation. Writes are asynchronous batched snapshots at turn/flush boundaries, with atomic replacement of each file. There is no token-level write or fsync.

## Compatibility

Tested against published **DeepSeek Harness `0.2.0-rc.2`**, Cordis `4.0.4`, and its current logical session format. Peers declare the exact tested prerelease; `engines.dsh` repeats it as metadata. No claim for other releases or `0.2.1-alpha.1`. [Compatibility evidence](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/compatibility.md).

## Development

```sh
npm ci --ignore-scripts
npm run validate
npm run test:coverage
npm run benchmark
npm run demo
npm pack
```

CI runs lint, typecheck, offline tests, build, synthetic benchmark and the packed official-launcher demo on Node 22.19+ and 24. Only published package exports are imported in production; deprecated synchronous session readers occur only in test files.

## Limitations

Usage totals cover only assistant messages with reported counters; `usage_coverage` exposes coverage. Settled request counts omit attempts lost before durable settlement. No inferred context utilization, task-progress score, network trace, hidden reasoning, full PTC subcall model, or real-world accuracy claim. Fork metrics count child-owned work; inherited evidence remains explicitly marked. Config reload is tested as dispose/remount/replay; a filesystem-driven source-HMR stress matrix is not claimed.

Files are individually atomic, not a multi-file transaction. A hard crash can lose the not-yet-exported interval; previous completed JSONL snapshots remain parseable. No automatic disk retention deletion: remove old hashed session directories when needed. [Retention and recovery](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/integration.md).

## Roadmap

Versioned exporters and detector functions are the extension seam for Agent Reliability Observatory adapters, OpenTelemetry, benchmark adapters and opt-in judges. V1 keeps deterministic rules and local files; it does not implement remote telemetry or judge-based labels.

MIT · © 2026 Kun Huang. DeepSeek Harness is a trademark of DeepSeek; this community project uses the recommended DSH naming convention.
