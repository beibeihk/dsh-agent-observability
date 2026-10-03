# Offline Harness demo

From the repository root, run `npm ci --ignore-scripts` and `npm run demo`.

The driver uses the public `dsh` package bin declared in its package manifest. It creates a prebuilt tarball and installs it into a project-local headless profile with the official plugin-manager command. `demo.patch.yml` selects `fake-observability/deterministic`, disables auxiliary model-generated titles, mounts `fake-adapter.mjs`, and directs this plugin's files to `artifacts/demo/`.

The actual Harness agent loop emits one tool call, one successful tool result, and one final assistant response over two steps. Expected: one completed turn, two settled model requests, one successful tool, zero findings. The adapter deliberately provides no token usage; the plugin does not invent token totals.

Generated files include `trace.jsonl`, `summary.json`, and `report.html`; `trace.json`, text/CSV summaries and empty `eval.jsonl` are also provided. The task is deterministic synthetic input, not a live DeepSeek experiment. No real model credentials are consulted by the adapter.

To run the same composition manually after installing the release tarball:

```sh
# Set these environment variables using your shell's syntax.
# DSH_HOME=<repository>/.demo-home
# DSH_OBSERVE_DEMO_OUTPUT=<repository>/artifacts/demo
dsh plugin --profile headless add ./beibeihk-dsh-agent-observability-0.1.0.tgz
dsh --profile headless --patch examples/basic-observability/demo.patch.yml "Run the offline lookup"
```

The overlay's module path resolves beside the overlay, as specified by Harness bundle/patch composition. This file is a development example and is not inserted by the distributed plugin bundle.
