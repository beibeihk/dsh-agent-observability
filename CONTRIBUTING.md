# Contributing to this community plugin

Small fixes, reproducible bug reports, privacy counterexamples and independent detector fixtures are welcome. Use public synthetic inputs, never real keys or private prompts. Run `npm ci --ignore-scripts`, `npm run validate` and `npm run test:coverage`; change the official CLI demo or benchmark when the behavior under test requires it.

Keep production imports on published public exports. New session history readers must use the asynchronous query service. Observation must not register model tools, modify prompts, intercept execution waterfalls, or change the deterministic loop's semantic events/requests. Include evidence seqs and counterexamples for detector changes. Explain schema changes and compatibility consequences.

This repository accepts its own community contributions. It does not authorize submitting core PRs to DeepSeek Harness; consult that project's current contribution rules separately. See [security reporting](SECURITY.md) before sharing sensitive findings.
