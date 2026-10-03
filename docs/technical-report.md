# Event-grounded reliability observations in DeepSeek Harness

Kun Huang · v0.1.0 · 2026-10-03. Community research engineering artifact; no official affiliation.

## Problem

An agent can recover from a tool error, retry a transport request inside one step, stop because the human cancelled it, or rewrite a model-visible tool-result surface. These trajectories require different diagnoses. A stream of console messages can lose call identities, omit unsuccessful settlements, and confuse temporary UI state with committed evidence. We need a reproducible observation layer whose findings point to the events that justify them.

This project targets observable runtime and trajectory patterns. It does not measure whether an answer is correct, infer hidden reasoning, assign an overall agent score, or claim to explain every failure cause. The primary invariant is that adding the observer preserves the deterministic agent's semantic durable output and model-visible requests.

## Harness event architecture

Harness composes services through Cordis plugins rather than a monolithic agent entry point. An official profile selects bundles; a package's `dsh.bundle.patch` inserts plugin rows into the tree. Our plugin requires `sessions` and `sessionQuery`, exposes `ctx.dshObservability`, and optionally registers the human `/observe` command. It contributes no tools or model prompts.

Committed `session/event` is the live observation seam. Seeds, resumed history and inherited fork prefixes need an initial read because they do not produce new live events. We acquire an asynchronous `sessionQuery.observeSession()` lease, normalize its immutable cut, dispose the lease, and drain bounded live events buffered during bootstrap. Sequence deduplication prevents overlap from inflating counts. New production code does not use deprecated synchronous session readers.

The recorder preserves source type, sequence, time, turn, step, call identity and available route/status/usage metadata. A pure projection builds neutral session/turn/step/tool structures. Detectors and exporters consume this schema independently of the Harness host, providing the seam for a later Agent Reliability Observatory adapter. A fork carries explicitly marked inherited evidence; metrics concern child-owned work.

See [upstream audit](upstream-audit.md), [architecture](architecture.md), [schema](schema.md) and the official [architecture document](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md). The source audit used master `5badb15009ae1756c3afe0ae0cef1faafc290ccc`; execution tests use published packages `0.2.0-rc.2`, not a checkout patched to work.

## Failure taxonomy

Nine deterministic F-rules are implemented: missing result (F01), duplicate terminal result (F02), equivalent consecutive calls (F03), consecutive-step tool errors (F04), excessive settled attempts (F05), abnormal durable termination (F07), long call-to-result interval (F08), high error ratio (F09), and logged route/context churn (F10). T01 is an informational tool-error observation; recovery can still complete. Each finding includes severity, session identity, exact evidence sequences, a message and rule metrics.

F01 is suppressed for open, incomplete, cancelled and fork-closed intervals. F02 excludes surface replacements. Equivalent argument comparison canonicalizes JSON object keys but preserves array order and values; it uses a fresh session-keyed HMAC, whose key is not exported. F03 and F04 can flag deliberate polling and repeated transient failures; users must interpret evidence in context. F06 is deferred because no objective task-progress contract exists for arbitrary tools. [Full definitions and counterexamples](failure-taxonomy.md).

## Experimental setup

All core experiments are keyless. A deterministic adapter and concurrency-safe tool run the **published Harness agent loop**. Integration tests compare runs with and without the plugin, retaining message/tool/request data while normalizing generated UUIDs and wall-clock timing fields. They exercise retries, real cancellation, parallel tool calls, Cordis disposal/remount, official JSONL persistence stop/resume, fork inheritance, human command disposal and export failure isolation. The keyless CLI demo packs the plugin, runs real `dsh plugin --profile headless add`, and launches the official headless profile.

Synthetic detector cases are predeclared in `scripts/synthetic.mjs`: 13 templates × 10 variations = 130 traces. Labels identify the presence of a session/type pattern, not the number of tool errors or the success of a task. Labels were specified independently of the detector invocation; templates were nevertheless designed for these rules and are not an external benchmark. Ten repetitions per template vary little, so 130 should not be interpreted as 130 independent environments. Five separately stored golden inputs have reviewed expected plaintext reports. Property tests cover redaction idempotence, constrained parallel result ordering and JSONL round-trip.

The benchmark warms up, rotates mode order, and reports medians over seven rounds of 10,000 events. Recorder timing excludes projection and export. The second benchmark uses real published `Session.append` and `session/event`, with synthesized user-message data allocated outside the timed region. Baseline and both observed modes use the same Session/query runtime. Model calls and filesystem operations are excluded from the timed region. GC is requested before each round, but allocation, JIT and OS variability remain.

## Results

Local validation on Node **24.12.0**, Windows x64: **36 tests passed**. V8 coverage: lines **96.45%**, statements **93.33%**, branches **89.86%**; detector, metrics and redaction lines are covered completely. Coverage is an exercised-code measure, not proof of privacy or semantic equivalence for every plugin composition. CI additionally runs Node 22.19 and 24 on Ubuntu; its actual status is visible in GitHub Actions.

Synthetic session/type labels: **TP=130, FP=0, FN=0**, precision **1.0**, recall **1.0**. Thirty normal/cancel/parallel traces have no labels and no findings. A recovered tool error receives T01 without F07. These numbers establish agreement on the designed fixtures only; no real-world accuracy estimate or statistical confidence interval is justified.

The real offline CLI demo completed one turn, two steps, two settled model requests and one successful tool call, with zero findings. Its adapter does not report token usage, so the plugin leaves token totals absent and reports zero usage coverage. [Observed output](demo/report.txt), [trace](demo/trace.jsonl), [actual dashboard screenshot](demo/dashboard.jpg).

## Performance overhead

The measured dataset is saved in [results.json](benchmarks/results.json). Timing figures below belong to the recorded local run; another machine or CI run can differ.

| 10,000-event scope / mode | Median ms | Events/s | Added μs/event | Heap delta bytes | RSS delta bytes |
|---|---:|---:|---:|---:|---:|
| Recorder baseline | 0.2057 | 48,614,487 | — | 400,384 | 0 |
| Recorder metadata-only | 96.3915 | 103,744 | 9.6186 | 10,038,024 | 335,872 |
| Recorder content | 83.9680 | 119,093 | 8.3762 | 10,086,728 | 262,144 |
| Session dispatch baseline | 429.1917 | 23,300 | — | 23,325,128 | -1,101,824 |
| Session dispatch metadata-only | 771.1497 | 12,968 | 34.1958 | 19,229,464 | 712,704 |
| Session dispatch content | 705.5573 | 14,173 | 27.6366 | 20,061,424 | -2,420,736 |

Metadata observation raises message-only Session dispatch time by **79.67%**; content mode raises it by **64.39%**. This is a meaningful cost in a CPU-heavy event workload, and should guide profiling before high-volume deployment. It is not an 79.67% increase in model-bound task time. The nearly empty recorder baseline is useful for absolute added time, not an informative end-to-end relative overhead denominator. Projection took 35.4524 ms and JSONL serialization 7.8322 ms for a 1,531,519-byte export in this run.

These medians vary with machine load; content mode being faster in this run is not evidence that content capture is inherently cheaper. Heap/RSS are pre/post deltas, not retained-size estimates or peak allocations. GC can make RSS negative or observed-mode heap smaller than baseline; neither implies negative allocation or a memory improvement. No peak-memory, worst-case-regex or multi-session load guarantee follows from this benchmark.

## Privacy, backpressure and crash behavior

Metadata-only is the default. Optional captured content passes through secret-field, header, common token/environment-pattern and user-regex redaction; reasoning blocks and embedded assistant streams are always excluded. Unknown event payloads and opaque tool metadata are not copied. These rules are tested with explicitly fake secrets in both capture modes and exported serialization. Redaction is not a general DLP proof; arbitrary personal text requires an appropriate custom pattern or leaving capture disabled. Upstream Harness logs are not rewritten by this plugin.

Recording and bootstrap queues are bounded by configured session/event/content limits; saturation marks capture incomplete and emits a generic diagnostic. Turn completion/flush coalesces background export work, and explicit/background file writes are serialized. Each file is written to a same-directory temporary path then renamed, preserving previous completed JSONL snapshots. The seven-file set is not transactional and no fsync durability guarantee is made. A hard crash can lose the current unexported interval. Automatic disk deletion is deferred; remove old hashed directories according to local retention needs.

The plugin sends no telemetry. The demo opts out of Harness telemetry separately. The local `npm audit --omit=dev` run reported zero advisories on 2026-10-03; the full development/host dependency installation reported advisories and is not advertised as vulnerability-free. Upstream dependency updates require compatibility validation, not an indiscriminate force upgrade.

## Limitations and next experiments

Compatibility is intentionally restricted to published `0.2.0-rc.2` (the npm `latest` tag at audit), Cordis 4.0.4, and the tested event vocabulary; `0.2.1-alpha.1` is not claimed. Reported usage covers successful assistant-message counters, not all interrupted/retried attempts. Message count measures appended message records, not current model-visible history after replacements. Request/header and context changes are observable churn, not evidence of harmful churn. Source-file watcher HMR stress, multi-agent interleavings, PTC subcall internals, peak memory and diverse real tasks remain unmeasured.

No paid or credentialed real-model task experiment was run. The next useful study would preregister varied public tasks, annotate failures independently and blindly, include purposeful repeated calls as negatives, and measure event load alongside end-to-end latency. Labels exported today are rule labels, not reward-model supervision or validated causal attributions. Adding task-outcome assessors should preserve that distinction.
