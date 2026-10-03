# Upstream audit

Read on 2026-10-03. Official master snapshot: `5badb15009ae1756c3afe0ae0cef1faafc290ccc`; published runtime under test: `0.2.0-rc.2`. Production compatibility is determined from that published package's declarations and real behavior, not an unreleased master feature.

| Material | Consequence |
|---|---|
| [CONTRIBUTING.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md) and Chinese version | External core PRs currently not accepted; ecosystem plugins and `dsh-plugin` topic encouraged. No core PR was created. |
| [AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md) | ESM, public services/events, reversible effects, transparent waterfall handling, model-visible facts logged. |
| [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md), Cordis primer and tutorial chapters 1–7 | Official profiles/bundles/patches, injection-driven activation, effects and HMR. No independent application launcher. |
| [Plugin manager](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md), [publish tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), package-manifest docs | Correct command is `dsh plugin --profile <profile> add <spec>`; distributed bundle declares `dsh.bundle.patch`. Prebuilt tarball avoids Git prepare-script approval. |
| Session, core/Agent, agent-loop, tools, LLM docs and published type exports | Source event names, turn/step/call identity, attempt settlements, tool cancellation/error status and lifecycle APIs verified. |
| [Event producer/consumer map](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/event-producer-consumer.md) and tool execution pipeline | Durable feed used; live stream and interception waterfalls deliberately unnecessary for V1. |
| Official tool and mock-adapter examples, core loop/persistence tests | Deterministic offline adapter exercises the real published loop. No large source copy was used. |
| [Brand guidelines](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md) | DSH abbreviation recommended; explicitly community-owned, no official mark/name implication. |
| SECURITY.md lookup and [SAFETY.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md) | No SECURITY.md existed at the inspected root or repository file inventory. Read SAFETY.md instead; no security finding was discovered or publicly reported. |
| Official Discussion categories | “Show Your Plugins!” exists and is the appropriate single showcase destination. No maintainer mentions or solicitation. |

GitHub name search found a similar `dsh-agent-observe` project, but no exact `dsh-agent-observability` conflict. The scoped npm name returned 404 before project creation. Similar-name search does not assert uniqueness over all future publications.

Direct runtime dependencies and host peers carry MIT licenses. Development dependencies include their own transitive notices; they are not bundled into the release tarball. Source API usage and compatibility are audited again by typecheck, offline integration tests and the official CLI demo.
