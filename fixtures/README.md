# Golden evidence fixtures

Five small, fully synthetic durable event logs have reviewed plaintext reports: normal, recovered tool error, equivalent repeat loop, parallel result order and two-turn resume/replay. They are contract fixtures, not a claim that malformed fixtures arose in production.

`tests/golden.test.ts` compares full report text. Real persistence stop/resume is separately exercised by the published Harness integration test. Update deliberately with `npm run build` then `node scripts/update-goldens.mjs`; review both input and expected-output diffs. CI never regenerates expected output.
