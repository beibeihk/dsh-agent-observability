# Profile material

**dsh-agent-observability** — A community DeepSeek Harness plugin for event-grounded, privacy-first agent reliability analysis and evaluation exports.

- Reconstructs neutral session/turn/step/tool trajectories from committed events, with sequence-level finding evidence and explicit fork inheritance.
- Uses reversible Cordis services/effects and asynchronous session-query leases; validates semantic equivalence against the real published agent loop.
- Defaults to metadata-only capture, excludes reasoning streams, and exports JSONL, evaluation cases and standalone HTML reports without telemetry.

[Repository](https://github.com/beibeihk/dsh-agent-observability) · [Release and installable tarball](https://github.com/beibeihk/dsh-agent-observability/releases/tag/v0.1.0) · [Actual demo](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/demo/dashboard.jpg) · [Technical report](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/technical-report.md)

Keywords: Agent Reliability · Event Sourcing · Cordis · DSH Plugin · Evaluation · Privacy · Research Engineering.

## English CV bullets

- Built an event-grounded observability plugin for DeepSeek Harness that reconstructs agent trajectories, detects nine evidence-backed runtime/trajectory patterns, and exports privacy-preserving traces for evaluation and debugging.
- Validated semantic transparency, cancellation, retry, parallel tools, fork and persistence resume through 36 offline tests against published Harness 0.2.0-rc.2; achieved 96.45% line coverage in the recorded local run.
- Published a reproducible 130-trace synthetic rule benchmark and measured metadata observation at an additional 34.20 μs/event in the official Session-dispatch microbenchmark on Node 24.12.0/Windows; documented the benchmark's +79.67% message-only overhead and lack of real-world accuracy evidence.

Use the last bullet only when a benchmark-focused CV is appropriate. Do not rewrite synthetic precision/recall as real-task accuracy or this microbenchmark as end-to-end latency.
