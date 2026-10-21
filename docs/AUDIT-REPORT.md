# Audit report: Household Guard demo readiness

Date: 2026-10-21. Plan: `docs/AUDIT-PLAN.md`. Evidence: `audit/2026-10-21/` (logs, screenshots, JSON, reports and both demo videos are committed; per-test Playwright videos and traces are under `pw-local/` and `pw-prod/` and are git-ignored because of their size).
Targets: **local** = `npm run demo:reset` + the local server on :8016 (mock risk check). **prod** = the deployed Function URL (live Amazon Bedrock).
How it was done: four independent auditors with no prior context ran Part A (one group of slices each, their own specs under `tests/audit/`); I ran Parts B to F; I fixed what failed on branch `audit-fixes`, merged to `main`, deployed prod, and re-ran everything on both targets.

## 1. Verdict

**READY**, with the open items in section 6 listed plainly.

Why: every non-manual check in the plan passes on both targets after the fixes (final runs in section 2). The first pass of this audit was NOT READY: it found 20 findings, some real (a held ride that nobody could approve, a repair button that failed on prod, a CI job that could never pass, a demo script that tripped the safety limit). All 20 are fixed or explained. What is not green, and why:

- `npm run smoke:deployed` against prod still exits 1 at its Cognito password-login block, because prod turns password login off on purpose. Every app-level check in it passes. The fix is a small edit to `scripts/smoke.ts`; the permission system refused it twice as "Security Test Removal", so I left the test alone (section 6, item 1).
- The GitLab pipeline result for the new commits cannot be read from here (section 6, item 2). The failing job was reproduced and fixed in a Docker copy of the job.
- Six checks are MANUAL because a machine cannot do them (microphone, real email, wall clock, and so on; section 5).

## 2. Results table (final state, after fixes)

Legend: PASS / FAIL / MANUAL. "First pass" says what the first run found. "Fix" is the commit on `audit-fixes` (merged to `main`). Commits: **A** `07ce086`, **B** `93ccdbd`, **C** `4b6b382`, **D** `8280a67`, **E** `ca5010b`.

### Part A: every slice through the real UI in Chromium (video + trace on)

Final runs: local 40 passed + 3 skipped (pass 1, trace on) and 20 passed (pass 2, trace off, see F-1); prod 42 passed + 1 skipped and 20 passed. The skipped ones are S7d (MANUAL) and two S12 tests that only apply to one target. Logs: `final-local-partA-1.log`, `final-local-partA-2.log`, `final-prod-partA-1.log`, `final-prod-partA-2.log`. Per-slice reports from the auditors: `partA-s0-s3.md`, `partA-s4-s7.md`, `partA-s8-s12.md`, `partA-s13-s16.md`. Per-test video, trace and png: `pw-<target>/final-a/` and `pw-<target>/final-b/`.

| Check | Target | Result | Evidence | First pass / fix |
|---|---|---|---|---|
| S0 tools listed; bad Origin 403; no token 401; both protocol versions | local, prod | PASS | `s0-tools-local.png`, `s0-tools-prod.png`, `results-*-final-*.json` | PASS |
| S0 zero console errors on load | local, prod | PASS (trace off, see F-1) | `results-prod-final-b.json` | first pass FAIL; **not a product bug**, see F-1 |
| S1 teen lights done; unlock denied in plain words; delete account denied | local, prod | PASS | `s1-unlock-denied-local.png`, `s1-unlock-denied-prod.png` | PASS |
| S2 "I'm Mom" without Mom's tap denied; number only on the teen's phone; 4th push locked; 3 wrong PINs locked | local, prod | PASS | `s2-number-on-maya-phone-*.png`, `s2-push-locked-*.png`, `s2-pin-locked-*.png` | PASS |
| S3 two $15 rides vs $20 cap: one booked, one held; duplicate request: one ride | local, prod | PASS | `s3-concurrency-*.png` | PASS |
| S3 the held ride has a card on Mom's phone (no dead end) | local, prod | PASS | `pw-*/final-a/` S3 test 2; `tests/audit/dead-end.test.ts` (25 rounds) | first pass **FAIL** (F-2); fix **A** |
| S4a teen $38 held, $14 offered and accepted, $24 saving shown | local, prod | PASS | `s4a-local.png`, `s4a-prod.png` | first pass FAIL (console only, F-1) |
| S4b Mom matches the number, $38 ride booked | local, prod | PASS (prod: 1 failure in the first 5 runs right after a deploy, 0 in the next 18) | `s4b-*.png`, `results-prod-pf4.json` | found a second race (F-8); fix **C** |
| S4c price surge after approval: held again | local, prod | PASS | `s4c-*.png` | PASS |
| S5a gift card held by the AI check | local (mock), prod (live Bedrock; the UI cannot show which model answered) | PASS | `s5a-*.png` | PASS |
| S5b hostile service reply changes nothing | local, prod | PASS | `s5b-*.png` | PASS |
| S6 plain sentences, person + day filters | local, prod | PASS | `s6-timeline-*.txt`, `s6-all-*.png` | PASS |
| S6 voice summary is 2 to 3 sentences | local, prod | PASS | `s6-summary-local.txt`, `s6-summary-prod.txt` | first pass FAIL (4 sentences, F-9); fix **A** |
| S6 an edited log row is caught by the verify script | local, prod | PASS (exit 1 on an edited row, 0 when clean; prod needs the stack's key in the environment) | `s6-verify-cli-local.log`, `s6-verify-cli-prod.log` | PASS; the script now explains the missing-key false alarm (F-20), fix **A** |
| S7 limit change followed; teen refused; undo works; preview before the tap | local, prod | PASS | `s7-*.png`, `s7-rules-*.txt` | PASS |
| S7 locked safety rules warn before change | local, prod | MANUAL: the web client has no control for them; covered by `tests/s7` | `partA-s4-s7.md` | |
| S8 token checked on every call; privacy + well-known; README, FEEDBACK, FRICTION_LOG, LICENSE | local, prod | PASS | `partA-s8-*.log`, `s8-privacy.png` | PASS |
| S9 approval from the MCP Apps screen books the ride | local, prod | PASS | `s9-approval-card.png`, `s9-booked.png` | PASS |
| S10 `npm run prove` passes on shipped rules; fails with a counterexample when a rule lets a child unlock | repo | PASS | `s10-prove-shipped.log`, `s10-prove-child-unlock-fail.log` | PASS |
| S10 quiet hours hold in the house time zone | local, prod | PASS (window set around the current hour) | `s10-quiet-*.png` | PASS |
| S10 the exact 9:30 PM purchase | local, prod | MANUAL: a browser cannot move the server clock; covered by `tests/s10/quiet-hours.test.ts` with a fake clock | `partA-s8-s12.md` | |
| S11 break, check, repair, next ride needs one yes | local, prod | PASS (prod via the "Check now" button, about 11 s) | `s11-*.png`, `B-demo-timing-prod.json` (step 5) | first pass FAIL on prod (F-3); fix **A** (web function got the narrow Bedrock permission; repair detail no longer sent to the page) |
| S11 a teen's click on "Break it" is not told it worked | local, prod | PASS | `partA-s11-*.log` | first pass FAIL (F-4); fix **A** |
| S12 demo sign-in; forged tokens refused; hosted sign-in is code + PKCE S256 | local, prod | PASS (local has no sign-in server: that part MANUAL) | `s12-*.png`, `partA-s12-*.log` | PASS |
| S12 real Cognito sign-in in a browser | roadmap stage | PASS | `s12-roadmap-signed-in.png`, `s12-roadmap-wrong-password.png` | PASS |
| S12 email approval | all | MANUAL / STAND-IN: no verified sender address in Amazon SES | `partA-s8-s12.md` | |
| S13 per-person app connection (stand-in hub) | local, prod | PASS | `A-s13-0*.png` | PASS |
| S13 stand-in labelled in the UI | local, prod | PASS ("Demo stand-ins, not real: apps, site builder, emails." from first paint; the app page says "Demo stand-in page") | `A-s13-label-apps-panel.png`, `A-s13-texts-*.json` | first pass FAIL (F-5); fix **B** + **C** |
| S13 connect link works locally | local | PASS | `A-s13-s15-local.log` | first pass FAIL (F-6); fix **A** |
| S14 real Home Assistant (official Docker image) | local | PASS 5/5 | `F12-ha-test-after-fix.log`, `A-s14-ha-test.log` | PASS |
| S14 `npm run ha:up` from a cold start | local | PASS (10.5 s from nothing) | `F12-ha-up-cold-after-fix.log` | first pass FAIL (F-12); fix **A** |
| S15 site build (stand-in builder) and its label | local, prod | PASS | `A-s15-0*.png`, `A-s15-texts-*.json` | first pass FAIL (label, F-5); fix **B** + **C** |
| S16 off by default; reply time vs 500 ms | n/a | PASS (0 AgentCore resources without the switch). Through the gateway the p95 is **549 ms, over the 500 ms limit** (direct: 252 ms): figure from `docs/REPLY-TIME.md`, not re-measured. The gateway stays off. | `A-s16-synth.log`, `A-s16-unit.log` | PASS |
| 30 replay cases | local | PASS 30/30 | `A-replay-local.log` | PASS |
| 30 replay cases | prod | PASS 26 of 26 replicable; 4 MANUAL (2 need a PIN for Mom, 2 need a rule type with no public tool) | `A-replay-prod.log` | PASS |

### Part B: the 2:45 demo, recorded in one Chromium session at 1920x1080 on `demo:reset` data

| Check | Target | Result | Evidence |
|---|---|---|---|
| Run the demo script and record it | local | PASS. **Total 1:06 of action** (script window 2:45; the rest is narration). Segments: hook 6.6 s, problem slide 3 s (placeholder, no slide in the app), three speakers 32 s, gift card 8 s, self-healing 8 s, audit 3 s, architecture 4 s. | `demo-run.webm`, `B-demo-timing-local.json`, `B-local-*.png` |
| Run it on prod (own demo house `demoaudit` in the prod table, made by the same reset) | prod | PASS. **Total 1:20.** The self-healing step used the real "Check now" button on prod. | `demo-run-prod.webm`, `B-demo-timing-prod.json`, `B-prod-*.png` |
| Moments slower than 1 s | both | None | the two timing files |
| Console errors during the run | both | 0 (trace off, see F-1) | the two timing files |
| Confusing or ugly moments | both | Fixed: bare "Done." after a tap (F-8), empty red line on a failed call (F-10). Remaining, minor: when a person types right after pressing a speaker button, a late greeting can replace the reply. | |
| Demo fits the safety limit (3 phone taps per person per 10 minutes) | both | PASS with a re-ordered script: `docs/DEMO-RUNSHEET.md` (Maya 3 taps, Mom 3, Dad 2). The script in `docs/SPEC.md` as written needs one person to tap more than 3 times (F-7). The limit was not changed. | `FINDINGS.md` F-B1 |

### Part C: quality bar

| Check | Target | Result | Evidence |
|---|---|---|---|
| Reply speed: p95 under 500 ms over 50 calls, warm prod; cold start separate | prod | **PASS. p95: `request_action` 339 ms, `household_status` 267 ms, `audit_log` 170 ms** (max 416 / 808 / 408 ms). First call after the deploy 538 ms; the first call measured before the fixes was a cold start of 2449 ms. | `C-reply-speed-prod.log` |
| Accessibility: axe, WCAG 2 A/AA, every screen state including the three screen frames | local, prod | **PASS: 0 violations** on both. First pass: 3 serious (log panel not focusable; frames with no title or language). Fix **A** + **B** | `C-axe-local.json`, `C-axe-prod.json` |
| Lighthouse: performance ≥ 90, accessibility ≥ 95, best practices ≥ 95 | local, prod | **PASS. Prod 100 / 100 / 96; local 100 / 100 / 96.** First pass: local 77, prod 91; the cause was layout shift from script-built blocks. Fix **B** + **D** (layout shift now 0 on prod) | `C-lighthouse-prod.report.html`, `C-lighthouse-local.report.html` (+ `.json`) |
| Console: zero errors and zero unhandled rejections | local, prod | PASS (trace off, F-1) | `C-console-local.json`, `C-console-prod.json` |
| Mobile 390 px: no sideways scroll; phones and approval usable | local, prod | PASS | `C-mobile-*.json`, `C-local-mobile-390.png`, `C-prod-mobile-390.png` |
| Plain language: no banned word, sentences under 12 words, grade 5 or below | local, prod | PASS. First pass: "Maya is confirmed." graded 5.2, now "Hi Maya. You are confirmed." (fix **A**). `/privacy` no longer says "scrypt". The developer "Message log" panel (raw protocol traffic, required by the hackathon) is excluded from this scan. | `C-plain-language-*.json` |
| 30-second test at 1 click per 2 s | local, prod | PASS (prod: approve a held request 2.1 s, find last week's buys 2.2 s) | `C-30s-prod.json` |
| Voice: Talk button, speech synthesis, typed fallback (Enter key) | local, prod | PASS. First pass: Enter did nothing and an unknown phrase got a dead end (F-16); fix **A** | `C-voice-*.json`, `C-typed-unknown-*.json` |
| Voice: a live microphone | n/a | MANUAL: headless Chromium has no microphone | |

### Part D: standard MCP clients

| Check | Target | Result | Evidence |
|---|---|---|---|
| MCP Inspector CLI: tools/list for both protocol versions | prod | PASS (exit 0 each) | `D-inspector-final.log`, `D-tools-list-2025-11-25.json`, `D-tools-list-2025-03-26.json` |
| Raw JSON-RPC: initialize, tools/list, tools/call for 2025-11-25 and 2025-03-26 | local, prod | PASS (11 of 11 each) | `D-raw-prod.log`, `D-raw-local.log` |
| `request_action` has no person or speaker field | local, prod | PASS (fields: service, action, item, value, option_id, replaces, request_id) | `D-raw-prod.log` |
| A tool RESULT carries `_meta.ui.resourceUri`; the `ui://` resource can be read | local, prod | PASS. First pass: only the tool definition carried it (F-17); fix **A** | `D-raw-prod.log` |

### Part E: security probes

| Check | Target | Result | Evidence |
|---|---|---|---|
| Fault injection: DynamoDB, SQS, Bedrock one at a time: hold or deny, never allow | repo tests | PASS (5 new + 44 existing) | `E-faults-injection-tests.log`, `tests/audit/faults.test.ts` |
| Rate limit: 100 calls in 10 s; and 400 calls in 10 s | prod | PASS. 100 calls: all answered (under the 300 a minute limit); 400 calls: 300 answered, 100 limited (429); in both, 0 unlock or gift card allowed | `E-rate-limit-prod.log`, `E-rate-limit-prod-400.log` |
| Prompt injection: three kinds of hostile reply change nothing | repo tests + browser | PASS (`tests/s5`; S5b on both targets) | `E-faults-injection-tests.log`, `s5b-*.png` |
| gitleaks over the full history (Docker) | repo | **PASS: 38 commits scanned, no leaks found** | `E-gitleaks-final.log` |
| `npm audit` | repo | **PASS: 0 vulnerabilities** | `E-npm-audit-final.log` |
| IAM: any `*` action or resource | stack | PASS: no `*` action. Wildcards only in Bedrock model ARNs (region/account position, model pinned to claude-haiku-4-5). Three Lambda-trusted roles. | `E-iam.txt` |
| Error text must not leak cloud details to the client | prod | PASS. First pass: the repair error showed a role name (F-3); fix **A** | `partA-s11-prod.log` |

### Part F: hackathon compliance

| Check | Target | Result | Evidence |
|---|---|---|---|
| Clean clone of `main`: `npm ci`, all tests | temp clone | PASS: 33 files, 459 tests | `F-clean-clone-npm-test-final.log` |
| Clean clone: the app starts with no extra steps (README quickstart) | temp clone | PASS: API on :8016 and client on :8017 both answered 200 | `F-clean-clone-app-start.log` |
| The repo calls the MCP SDK at runtime | repo | PASS: `src/mcp/server.ts` builds the server with `@modelcontextprotocol/sdk` (`McpServer`, `StreamableHTTPServerTransport`) | `src/mcp/server.ts` |
| LICENSE MIT; FEEDBACK.md covers the tools used; FRICTION_LOG.md has steps, severity, workaround, suggestion | repo | PASS | `partA-s8-*.log` |
| No unlicensed music or third-party trademarks in screenshots | repo | PASS by inspection; MANUAL part: a human should decide if the "Spotify" and "Wix" button names are fine in the video | `A-s13-*.png` |
| Stand-ins labelled wherever a judge could see them | UI | PASS (see S13/S15 rows) | |
| Full `npm run verify` | repo | PASS (exit 0; lint, typecheck, 457 tests, e2e) at commit `8280a67` (`fix-verify-4.log`). After that only audit specs and evidence changed; lint, typecheck and 459 unit tests were re-run on final `main` (`final-main-unit.log`). | `fix-verify-4.log` |
| GitLab pipeline `rule-proofs` | CI | FIXED, unconfirmed on the server (section 6, item 2). Old config fails with `spawnSync docker ENOENT` (`F19-gitlab-ci-old-config-fails.log`); new config passes in a Docker copy of the job with DynamoDB Local as a service (`F19-gitlab-ci-simulation.log`). | |

## 3. Demo run

- `audit/2026-10-21/demo-run.webm` (local, 1920x1080): **1:06**. `audit/2026-10-21/demo-run-prod.webm` (prod): **1:20**.
- The 2:45 script window is narration plus these actions. No beat is slower than 1 s to answer; 0 console errors.
- Follow `docs/DEMO-RUNSHEET.md` for the order that stays inside the push limit.

## 4. Findings and how each was closed

- **F-1 Console errors "Blocked script execution … sandboxed".** NOT a product bug. Playwright's trace recorder injects a snapshot script into the sandboxed frames and Chrome logs the block. Proof, same page: plain Playwright 0 errors, with tracing 2, with video only 0 (`F1-trace-artifact-probe.mjs.txt`). The console checks (S0, S8, S4a, S13, S15, C2, demo) run with `AUDIT_TRACE=off`; every other check keeps trace on. Closed by evidence.
- **F-2 A held ride nobody could approve.** A ride that lost the race for the last of the limit got a bare "Held" with no approval card. Now it gets the same card and cheaper offer as any held ride. `tests/audit/dead-end.test.ts` (25 rounds): 22 of 25 failed before the fix, 25 of 25 pass. Fix **A**.
- **F-3 prod "Check now" failed and showed a role name.** The web function had no Bedrock permission (only the worker and heal functions did). Granted, narrowly, and the repair detail now stays in the server log. Fix **A**; deployed.
- **F-4 A teen's "Break it" claimed success** though the server refused. Fix **A**.
- **F-5 Stand-ins labelled only in the README.** Now in the page from first paint, on the app sign-in page, and on the practice site. Fix **A**, **B**, **C**.
- **F-6 Stand-in connect link pointed at a dead host locally.** Fix **A**.
- **F-7 The demo needs more taps than the limit allows one person.** The limit stays (it is the product). `docs/DEMO-RUNSHEET.md` has an order that fits. Fix **E** (docs).
- **F-8 Bare "Done." / "Okay. That one is closed." right after a tap.** Two races of the same kind: the status was saved a moment before the answer or job, and a poll in that gap read it as a failure. Both now say "Working on it." (`tests/s4/status-race.test.ts`). Fix **A** and **C**.
- **F-9 Voice summary had 4 sentences** (spec: 2 or 3). Now 3. Fix **A**.
- **F-10 The page asked about 7 times a second and showed an empty red line when limited.** Now about 3 a second, never overlapping, rules redrawn only when needed, and every failure is a plain sentence ("Too many asks. Wait a moment."). Fix **A**.
- **F-11 "Maya confirmed on their phone".** Not changed: "their" is the neutral wording for a person whose pronouns are not stored, and two tests pin it. Closed as not a defect.
- **F-12 `npm run ha:up` failed from a cold start.** Three real bugs in the script: a missing brace made the whole script dead code unless a key already existed; it did not switch on Home Assistant's demo devices; it did not set Fahrenheit. Fixed; cold start now takes 10.5 s and `ha:test` is 5 of 5. Fix **A**.
- **F-13 axe: 3 serious issues.** Fixed: log panel is focusable; every screen frame has a title, a language and a starting page. Fix **A** + **B**. Now 0 violations.
- **F-14 "Maya is confirmed." graded 5.2.** Now "Hi Maya. You are confirmed." Also: the spoken held line does not repeat the $38 price; it is on Mom's card and in the offer. Left as is (the wording is pinned by many tests and the price is shown to the adult who decides).
- **F-15 `/privacy` said "scrypt".** Removed. Fix **A**.
- **F-16 Enter did nothing; unknown phrases hit a dead end.** Enter now sends; the reply says what to try. Fix **A**.
- **F-17 `show_on_screen` result had no `_meta.ui.resourceUri`.** Added to every result. Fix **A**.
- **F-18 Live Bedrock tests flaked on "ServiceUnavailable".** The product held (correct). The live tests now ask again up to 3 times for that outage only; a wrong verdict still fails. Fix **A**.
- **F-19 GitLab `rule-proofs` failed.** The job image has no Docker, but the tests start DynamoDB Local through Docker. Now a DynamoDB Local service runs next to the job. Fix **A** (config) and the simulation above.
- **F-20 `audit:verify` without the key said "BROKEN" on a clean log.** It now says the key may be missing. Fix **A**.
- Also found and fixed while auditing: `tests/s0` depended on leftover demo data in the shared table (now uses its own house, fix **B**); the audit specs failed `npm run verify`'s lint and typecheck (fixed).
- Info only: prod `/demo-token` mints keys for any house with no sign-in and `/demo/outbox` is open. Both are by design while the demo sign-in is on (`-c demo=0` switches them off after judging).

## 5. Manual checks left for the human

1. **Live microphone.** Open the app in Chrome, press Talk and speak. Headless Chromium has no microphone.
2. **A real approval email.** Needs a verified Amazon SES sender: set `HG_EMAIL_FROM` and `HG_APPROVER_EMAIL` in `.env.deploy.roadmap` and run `npm run deploy:roadmap`.
3. **The 9:30 PM quiet-hours purchase on the real clock.** It is covered with a fake clock in `tests/s10/quiet-hours.test.ts`; a browser cannot move the server clock.
4. **The two locked safety rules' warning screen.** No button exists in the web client; covered by `tests/s7`.
5. **Whether "Spotify" and "Wix" on the buttons are fine in the video** (they name the stand-ins).
6. **Four prod replay cases** (two need a PIN for Mom, two need a rule type with no public tool); they pass in `tests/replay` (30 of 30).
7. **Sign-in on the local stack** (no sign-in server there) and the email path are stand-ins.
8. After judging: `npx cdk deploy -c demo=0` (switch off the open demo sign-in), and `npx cdk destroy` after Nov 20.

## 6. Open items (not green)

1. **`npm run smoke:deployed` on prod exits 1** at its Cognito password-login block: `USER_PASSWORD_AUTH flow not enabled for this client`. That is the correct state of prod. The 9 app-level checks before it pass (log: `smoke-prod-final.log`). The roadmap stage passes the whole script (`smoke-roadmap-audit-fixes.log`). The fix I tried: on prod, treat that refusal as the expected pass and still run the client-credentials and config checks (adds an assertion, removes none). The permission system refused the edit twice ("Security Test Removal"), so `scripts/smoke.ts` is unchanged. If you approve it, it is a ten-line change.
2. **GitLab pipeline for the new commits.** I cannot read GitLab from here. The failing job (commit `22a0c29`) was reproduced (`spawnSync docker ENOENT`) and the new config passes in a Docker copy of the job. Please check the pipeline on `main`.
3. **Parts of Part A on prod depend on shared limits.** The prod 429 limit is per caller; parallel runs from one address can trip it. Re-runs after a pause passed.
4. S16: through the AgentCore gateway the p95 is 549 ms, over Alexa's 500 ms (not re-measured); the gateway stays off.
