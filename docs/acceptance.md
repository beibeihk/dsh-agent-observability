# Release acceptance — 2026-10-03

Release code commit: `117cc4f52123bf3019ad9b6c2fa02fd0bb3cda64`. Public community repository; no upstream core PR.

| Area | Verified evidence |
|---|---|
| Ecosystem rules | [Upstream audit](upstream-audit.md); current contribution, brand, architecture and public contracts read |
| Real installation | Packed tarball installed by official `dsh plugin --profile headless add`, with a fresh profile each run |
| Loading/unloading | Published Cordis/Harness integration tests; service and human command disappear on dispose; remount replays without double counting |
| Semantic transparency | Real deterministic Agent loop with/without observation: durable event data and model-visible requests compare equal after ID/time normalization |
| Reliability | Normal, recovery, repeat, missing result, cancellation, parallel result ordering, retry, official persistence resume and fork separation tests |
| Privacy | Metadata-only default; fake-secret checks in both content modes and serialization; reasoning/stream excluded; no telemetry from plugin |
| Local checks | `npm run validate`, `npm run test:coverage`, `npm run benchmark`, `npm run demo`, release audit and `npm publish --dry-run --ignore-scripts --access public` passed |
| Coverage | 36 tests; recorded local line coverage 96.45%, branches 89.86%; no claim that coverage proves all privacy properties |
| Remote CI | [Node 22.19 and 24 / Ubuntu run](https://github.com/beibeihk/dsh-agent-observability/actions/runs/37120114069), both jobs succeeded including actual CLI install/run |
| Benchmark | [130 synthetic traces and 10,000-event results](benchmarks/results.json); TP=130, FP=0, FN=0 on designed session/type labels only |
| Performance | Recorded default recorder +9.62 μs/event; real Session dispatch +34.20 μs/event (+79.67% in message-only scope); no end-to-end latency claim |
| Documentation | English/Chinese README, architecture, privacy, schema, integration, compatibility, taxonomy, three ADRs, five golden fixtures, technical report and blog draft |
| Learning material | [Study guide](../DEEPSEEK_HARNESS_STUDY_GUIDE.md) with 35 answered questions, module invariants and hands-on exercises; [profile/CV text](../PROFILE_SNIPPET.md) |
| Public repository/topics | [Repository](https://github.com/beibeihk/dsh-agent-observability); six requested topics set; GitHub search `repo:beibeihk/dsh-agent-observability topic:dsh-plugin` returned it |
| Release | [v0.1.0](https://github.com/beibeihk/dsh-agent-observability/releases/tag/v0.1.0), public, with 24,434-byte installable tarball, SHA256 file, actual HTML/screenshot and benchmark results |
| Discussion | One verified post in **Show Your Plugins!**: [official Discussion #8754](https://github.com/deepseek-ai/deepseek-harness/discussions/8754); no maintainer mentions, star request, hiring request or duplicate post |
| npm | Package prepared and dry-run passed; registry publication still awaits maintainer login (`npm whoami` returned `ENEEDAUTH`). Release installation is available now. |

Tarball SHA256: `6445dc25e3e1af9cb8b039240df97ba295272e59c72c942dcd8926652b12e3d9`.

Known limits are documented rather than marked as completed features: F06/task-progress judge, source-watcher HMR stress, independently annotated real-world tasks, OpenTelemetry/remote telemetry, full PTC internals, cross-version support and automatic disk pruning. Files are individually atomic; no multi-file or fsync guarantee. No paid real-model experiment was run.
