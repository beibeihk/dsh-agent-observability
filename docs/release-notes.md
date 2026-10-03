# v0.1.0

First community release of an event-grounded, privacy-first observability and reliability plugin for DeepSeek Harness.

- Installs through the official plugin manager using the prebuilt `.tgz` asset and `dsh.bundle.patch`; no core changes.
- Reconstructs session/turn/step/tool trajectories through durable events and async session-query leases; provides `/observe` when human commands are available.
- Computes reliability metrics and nine deterministic F-rules plus informational tool-error evidence; exports JSON/JSONL/CSV/evaluation cases, plaintext and offline HTML.
- Defaults to metadata only, redacts optional captured content, excludes reasoning/stream data, and sends no telemetry.
- Includes 36 offline tests, five golden fixtures, semantic with/without comparison, real persistence resume/fork/disposal tests, the official CLI installation demo, 130 synthetic traces and transparent performance results.
- English/Chinese README, technical report, blog draft, study guide with 35 answered interview questions, and factual CV/profile material.

Tested: published DeepSeek Harness **0.2.0-rc.2**, Cordis **4.0.4**. No compatibility claim for the alpha channel or future releases.

Install:

```sh
npm install --global @deepseek-ai/dsh@0.2.0-rc.2 pnpm
dsh plugin --profile web add ./beibeihk-dsh-agent-observability-0.1.0.tgz
dsh web
```

Run a task and submit `/observe`; open its local `report.html`. The npm package is prepared as `@beibeihk/dsh-agent-observability`, but registry publication is pending maintainer authentication. The attached tarball is usable now.

Known limits: pattern-based privacy protection; usage only where reported; no task-correctness or progress judge; individually atomic files rather than a multi-file transaction; no automatic disk pruning; no source-watcher HMR stress claim. Metadata observation added **34.20 μs/event (+79.67%)** in the recorded 10,000-message official Session-dispatch microbenchmark. This excludes model/disk latency. Synthetic precision/recall 1.0 is not real-world accuracy.

[Technical report](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/technical-report.md) · [Actual demo screenshot](https://github.com/beibeihk/dsh-agent-observability/blob/main/docs/demo/dashboard.jpg)
