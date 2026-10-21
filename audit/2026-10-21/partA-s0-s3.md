# Part A audit: S0-S3 (real web client, Chromium, video + trace on)

Specs: `tests/audit/s0.spec.ts`, `s1.spec.ts`, `s2.spec.ts`, `s3.spec.ts` (+ helper `tests/audit/_lib.ts`). No src/, web-client/, infra/ or existing tests touched.
Commands (one per slice; group `a-sN` so evidence is not overwritten):
`AUDIT_TARGET=<local|prod> AUDIT_GROUP=a-s<N> npx playwright test -c playwright.audit.config.ts tests/audit/s<N>.spec.ts`
Full run log: `audit/2026-10-21/partA-final-run.log`. JSON results: `audit/2026-10-21/results-<target>-a-s<N>.json`.
Evidence per test (video.webm, trace.zip, png): `audit/2026-10-21/pw-<target>/a-s<N>/<test-name>/`.
Extra named screenshots: `audit/2026-10-21/s0-tools-*.png`, `s1-unlock-denied-*.png`, `s2-number-on-maya-phone-*.png`, `s2-push-locked-*.png`, `s2-pin-locked-*.png`, `s3-concurrency-*.png` (suffix = target).

## Result table
| Slice | local | prod |
|---|---|---|
| S0 (4 tests) | 3 PASS, 1 FAIL (console errors) | 3 PASS, 1 FAIL (same) |
| S1 (4 tests) | PASS 4/4 | PASS 4/4 |
| S2 (7 tests) | PASS 7/7 | PASS 7/7 (see rate-limit note: first full run had 3 spurious fails) |
| S3 (4 tests) | PASS 4/4 on last run, but test 2 is FLAKY (about 1 in 8 .. 3 in 5 fails) | 3 PASS, 1 FAIL (test 2, Mom's phone empty) |

## What each spec proves
- S0: UI Connect/List tools/Ask status shows request_action etc. in the log; raw HTTP: initialize works for 2025-11-25 and 2025-03-26 (negotiated version echoed), bad Origin -> 403, no token -> 401, junk token -> 401, same-origin Origin -> 200, tools/list = exactly the 10 fixed tools, request_action has no person/speaker/who/user/name field. Both targets pass these.
- S1: Maya confirmed on her phone: lights -> "Done. The lights are off."; unlock -> denied "Only adults can do that."; delete account -> denied "I can't do that."; guest (nobody confirmed): lights ok, unlock "Tell me who you are first." denied; unknown phrase "Sorry, I didn't get that."; Mom can unlock (not denied). No tech words in reasons.
- S2: "I'm Mom, unlock the door" with nobody confirmed -> denied; same typed while Maya is confirmed -> denied, door never unlocked, Mom's phone gets nothing; teen ride shows the number buttons on Maya's phone only (zero on Mom's); wrong number on Maya's phone does not book; 4th push -> "Too many tries. Wait 10 minutes." and stays locked, Mom's phone is told; Leo 3 wrong PINs -> 3rd says locked and the RIGHT PIN (4821) is then refused; Leo with right PIN confirmed ("Hi Leo.") and a ride is not auto-allowed.
- S3: two $15 rides fired in one browser task vs $20 cap -> exactly one "Ride booked for Maya", one "Held: over Maya's $20 a week" (why=cap_race), Maya has $5 left (both targets). Same request_id sent 3x (one in parallel pair, one later) -> one job id, one ride, $5 left (both targets). $38 airport -> held, not booked.

## FINDINGS (genuine failures and issues)
1. **S3 / both targets, flaky: "An adult can tap NN to say yes" but Mom's phone shows "Nothing waiting".** Test `S3 the ride held for the cap reaches Mom's phone` (s3.spec.ts:42). When the held reply arrives first of the two concurrent asks, Alexa tells an adult to tap a number, yet Mom's phone has no approval card (checked 15 s, and after Maya's own tap). Observed local: 3 of 5 and 1 of 8 runs; prod: failed 3 of 3 runs. When the allowed reply arrives first, the card shows. Effect: a held ride that nobody can approve (dead-end), and a demo that is random. Evidence: `pw-prod/a-s3/s3-S3-the-ride-held-for-th-c3bce-re-Maya-taps-her-own-phone-/` (video, trace, png). Test 1 in the same file also failed once on prod at its last line (Mom's card) in an earlier run (`pw-prod/a1` was overwritten; the later clean prod run of test 1 passed).
2. **S0 / both targets: console errors on page load.** Test `S0 browser: no console errors...` FAILS: "Blocked script execution in 'about:blank' because the document's frame is sandboxed and the 'allow-scripts' permission is not set." (x2) from the `sandbox=""` timeline/rules iframes (their srcdoc contains script). Violates Part C "zero console errors". Evidence: `pw-local/a-s0/...no-console-errors.../` and `pw-prod/a-s0/...`.
3. **Prod rate limit (429) breaks the client silently.** After a burst, prod `/demo-token` and `/mcp` return 429 with an empty body. The web client then shows an empty Alexa line or "Something went wrong. Ask an adult." with no hint to wait. Each open page polls about 7 requests per second (3 phone inboxes, timeline, rules, status), so one page plus other auditors on the same IP trips the limit. My first full prod run produced 3 spurious fails in S2 and 2 in S3 for this reason (confirmed 429 in traces `pw-prod/a-s2/...`, `pw-prod/a-s3/...` from the first final run, since overwritten by the rerun; counts in `partA-final-run.log`); reruns after a 100 s cooldown passed. Not a logic bug, but a demo risk: a judge or video take can hit it. Suggest: slow polling (e.g. 3 s, or pause when the tab is idle), and show "Too many requests, wait a moment".
4. **Prod vs local wording/behaviour differs (prod is the older submitted build):** after Maya's tap, local says "Maya is confirmed."; prod says "Done." and styles it as held (class `held`). "Done." after a sign-in is confusing.
5. UX: timeline says "Maya confirmed on their phone" (inconsistent pronoun, local and prod).
6. UX: with two requests at once only the latest line shows in Alexa's box; the earlier "Confirm on your phone: NN" is overwritten, so Maya cannot know which number to tap (the number must be read from the log panel). Real Alexa would say each reply, so low risk.
7. UX: the same-time duplicate reply is "Still working on that one." with outcome `held` (not a failure; one ride was booked).
8. Notes: Leo's demo PIN 4821 is seeded in code (`src/core/household.ts`), fine for demo, must not exist in a real household. The Mom-unlock S1 check only asserts "not denied" (it may wait for her phone tap).

## Could not run / limits
- Local uses a mock risk check; prod uses live Bedrock: not exercised in S0-S3 (gift card is S5).
- "Duplicate request" cannot be sent twice from the UI buttons (each utterance gets a fresh request_id), so the spec issues the same raw `/mcp` call twice from inside the page (same endpoint and sign-in the page uses).
- Parallel auditors share the prod IP, so prod timings and rate limits are not isolated.
