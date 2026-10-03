# dsh-agent-observability: event-grounded reliability analysis for DeepSeek Harness

I've built a small community plugin to make observable agent/tool failure patterns easier to inspect and export for evaluation.

**Repository:** https://github.com/beibeihk/dsh-agent-observability  
**Installable v0.1.0:** https://github.com/beibeihk/dsh-agent-observability/releases/tag/v0.1.0

The plugin observes committed `session/event` and reconstructs session → turn → step → tool call/result trajectories. It acquires async `sessionQuery.observeSession()` leases for seeds/resume and uses sequence identities to deduplicate overlap. It adds no model tools or prompts and does not intercept execution waterfalls. Cordis disposal removes its service, listeners and optional human `/observe` command.

Findings cite exact event seqs: missing/duplicate terminal results, equivalent repeated calls, consecutive-step tool errors, excessive settled attempts, abnormal termination, long tool intervals, high error ratio and logged request/context churn. Cancellation is kept separate from failure; replacements are not counted as another tool completion. F06 “no progress” is deliberately deferred without an objective task-progress contract.

Capture is metadata-only by default. Optional content capture remains redacted; reasoning blocks and embedded streams are excluded. The plugin sends no telemetry. JSONL/eval exports and a standalone HTML report are all local.

The keyless demo **packs and installs with the actual `dsh plugin --profile headless add`**, then runs the official headless profile using a deterministic adapter/tool. [Actual report screenshot](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/demo/dashboard.jpg), [reproduction](https://github.com/beibeihk/dsh-agent-observability/tree/main/examples/basic-observability).

Compatibility is restricted to published **0.2.0-rc.2 / Cordis 4.0.4**. Tests compare durable semantics and model-visible requests with/without observation and cover disposal/remount, retry, parallel tools, cancellation, persistence resume, fork and fake-secret redaction. The 130 synthetic traces validate the defined rules only; they do not estimate real-task accuracy. Recorded metadata overhead is +34.20 μs/event (+79.67% in a message-only Session-dispatch microbenchmark), excluding model and disk latency. [Methods and limits](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/technical-report.md).

Feedback on event-contract mistakes, counterexamples to the detectors, and lower-overhead observation patterns would be useful. This is a community project, with no official affiliation or endorsement.
