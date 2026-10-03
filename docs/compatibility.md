# Compatibility evidence

Validated on 2026-10-03 with npm-published DeepSeek Harness **0.2.0-rc.2**, Cordis **4.0.4**, Node **24.12.0**, Windows x64. CI also validates Node 22.19.0 and 24 on Linux. A CI configuration is not itself evidence that its remote runs passed; the repository Actions page holds those results.

Production imports are public package exports: Cordis root, Session/query/command/app-boot types, Schemastery root and Node builtins. No private loop imports, core patch, copied runtime implementation, or synchronous deprecated Session reader is present in `src/`. Integration tests use the published Agent registry, Agent loop, Session/query, tools, LLM adapter and JSONL persistence packages. Test-only synchronous readers inspect expected output, as allowed by the official deprecation policy.

The package declares exact Session and Session-query peers; commands is optional. `engines.dsh` is descriptive metadata, while the current upstream compatibility admission uses DSH peer declarations. This developer preview changes rapidly. The latest `alpha` tag (`0.2.1-alpha.1` when inspected) and master are not declared supported merely because their docs were read.

Behavior tested: semantic equality of durable events and model requests with and without observer (generated UUIDs/timing excluded), successful real tool round, parallel calls, retried attempts without duplicate steps, mid-stream user cancellation, stop/persist/resume through official handles, fork inheritance separation, mount/unmount/remount/replay, I/O failure containment and static export. The packed demo validates actual `dsh plugin add` selection and actual profile boot with an offline adapter.

Dispose/remount tests cover the mechanism used by HMR. A source-watcher stress matrix and cross-version compatibility are not claimed. New Harness versions require repeated integration and packed-launcher validation before widening peer ranges.
