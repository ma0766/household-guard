# Audit report: Household Guard demo readiness

Date: 2026-10-21. Plan: `docs/AUDIT-PLAN.md`. Evidence: `audit/2026-10-21/` (videos and traces under `pw-local/` and `pw-prod/`, git-ignored because of size; logs, screenshots and JSON are committed).
Targets: **local** = `npm run demo:reset` + local server on :8016 (mock risk check). **prod** = the deployed Function URL (live Bedrock).

## 1. Verdict

**NOT READY** (first pass, before fixes). The safety core holds: every rule, cap, approval, fault-injection and security check passed, gitleaks is clean, and prod replies in under 500 ms at p95 (400 ms). What fails is polish and a few real defects:

- the page logs console errors on every load (sandboxed frames);
- 3 axe "serious" issues, and the Enter key in the question box does nothing;
- a held ride can be approved by nobody (S3 flake: "An adult can tap NN" but Mom's phone is empty);
- on prod, the "Check now" repair button fails (the web function has no Bedrock permission) and leaks a role name;
- stand-ins (Composio, Wix, email) are not labelled in the UI, only in the README;
- the CI proof job on GitLab failed;
- the 2:45 demo script needs more phone taps than the 3-per-10-minutes limit allows for one person.

Fixes are on branch `audit-fixes` (section 7 is updated as each is fixed).

## 2. Results table

Legend: PASS / FAIL / MANUAL. "Fix" = commit on `audit-fixes` (filled in as fixed).

### Part A: slices through the real UI (Chromium, video + trace on)

| Check | Target | Result | Evidence | Fix |
|---|---|---|---|---|
| S0 tools listed, bad Origin 403, no token 401, both protocol versions | local, prod | PASS | `partA-s0-s3.md`, `s0-tools-local.png`, `s0-tools-prod.png`, `results-*-a-s0.json` | |
| S0 zero console errors on page load | local, prod | FAIL (F-1) | `partA-s0-s3.md` finding 2, `pw-*/a-s0/` | |
| S1 teen lights done / unlock denied with plain reason / delete account denied | local, prod | PASS | `s1-unlock-denied-local.png`, `s1-unlock-denied-prod.png` | |
| S2 "I'm Mom" without Mom's tap denied; number lands on teen's phone only; 4th push locked; 3 wrong PINs locked | local, prod | PASS | `s2-*-local/prod.png`, `results-*-a-s2.json` | |
| S3 two $15 rides vs $20 cap: one booked, one held; duplicate request: one ride | local, prod | PASS | `s3-concurrency-*.png`, `results-*-a-s3.json` | |
| S3 held ride reaches Mom's phone (dead-end approval) | local (flaky), prod | FAIL (F-2) | `partA-s0-s3.md` finding 1, `pw-prod/a-s3/` | |
| S4a teen $38 held, $14 offered and accepted, $24 saving shown | local, prod | FAIL: console errors only (F-1); all steps pass | `s4a-local.png`, `s4a-prod.png` | |
| S4b Mom matches number, $38 ride booked | local, prod | PASS | `s4b-*.png` | |
| S4c price surge after approval: held again | local, prod | PASS | `s4c-*.png` | |
| S5a gift card held by the AI check | local (mock), prod (live Bedrock, not provable from the UI alone) | PASS | `s5a-*.png` | |
| S5b hostile service reply changes nothing | local, prod | PASS | `s5b-*.png` | |
| S6 plain sentences, person + day filters | local, prod | PASS | `s6-timeline-*.txt`, `s6-all-*.png`, `s6-maya-*.png` | |
| S6 voice summary is 2-3 sentences | local, prod | FAIL (F-9): 4 sentences | `s6-summary-local.txt`, `s6-summary-prod.txt` | |
| S6 edited log row caught by verify script | local, prod | PASS (exit 1 on edit, 0 clean) | `s6-verify-cli-local.log`, `s6-verify-cli-prod.log` | |
| S7 limit change follows; teen refused; undo works; preview shown | local, prod | PASS | `s7-*.png`, `s7-rules-*.txt` | |
| S7 locked safety rules warn before change | local, prod | MANUAL: the web client has no control for them; covered by vitest (`tests/s7`) | `partA-s4-s7.md` | |
| S8 token on every call; privacy + well-known; README/FEEDBACK/FRICTION_LOG/LICENSE | local, prod | PASS | `partA-s8-*.log`, `s8-privacy.png` | |
| S9 approval from the MCP Apps screen books the ride | local, prod | PASS | `s9-approval-card.png`, `s9-booked.png` | |
| S10 `npm run prove` passes on shipped rules, fails with counterexample when a rule lets a child unlock | local | PASS | `s10-prove-shipped.log`, `s10-prove-child-unlock-fail.log` | |
| S10 quiet hours in house time zone | local, prod | PASS (window around now) | `s10-quiet-*.png` | |
| S10 exact 9:30 PM purchase | local, prod | MANUAL: a browser cannot move the server clock; covered by vitest (`tests/s10/quiet-hours.test.ts`) | `partA-s8-s12.md` | |
| S11 break, check, repair, next ride needs one yes | local | PASS | `s11-1-broken.png` .. `s11-4-booked-normal.png` | |
| S11 same flow via "Check now" | prod | FAIL (F-3): button cannot repair; error leaks a role name | `partA-s11-prod.log` | |
| S11 teen clicking "Break it" is told it worked | local, prod | FAIL (F-4) | `partA-s11-local.log` | |
| S12 demo sign-in works; forged tokens refused; hosted sign-in uses code + PKCE S256 | local, prod | PASS (local has no sign-in server: MANUAL for that part) | `s12-*.png`, `partA-s12-*.log` | |
| S12 real Cognito login in a browser | roadmap stage | PASS | `s12-roadmap-signed-in.png` | |
| S12 email/push approval | all | MANUAL / STAND-IN: no verified SES sender | `partA-s8-s12.md` | |
| S13 connect an app per person (stand-in hub) | local, prod | PASS (flow) | `A-s13-0*.png` | |
| S13 stand-in clearly labelled in UI and README | local, prod | FAIL (F-5): README labels it; the UI does not | `A-s13-label-apps-panel.png` | |
| S13 connect link works | local | FAIL (F-6): points to a dead example host when the public URL is unset | `partA-s13-s16.md` | |
| S14 real Home Assistant (Docker) 5/5 | local | PASS | `A-s14-ha-test.log` | |
| S14 `npm run ha:up` from cold | local | FAIL (F-12): times out at first start | `A-s14-ha-up*.log` | |
| S15 site build via stand-in builder | local, prod | PASS (flow) | `A-s15-0*.png` | |
| S15 stand-in labelled in UI | local, prod | FAIL (F-5) | `A-s15-texts-*.json` | |
| S16 off by default; measured p95 vs 500 ms | n/a | PASS: off by default (0 AgentCore resources in synth); through the gateway p95 549 ms is OVER 500 ms (figure from `docs/REPLY-TIME.md`, not re-measured) | `A-s16-synth.log`, `A-s16-unit.log` | |
| 30 replay cases | local | PASS 30/30 | `A-replay-local.log` | |
| 30 replay cases | prod | PASS 26/26 replicable; 4 MANUAL (2 need a PIN for Mom, 2 need a rule type with no public tool) | `A-replay-prod.log` | |

### Part B: the 2:45 demo, one recorded Chromium session at 1920x1080

| Check | Target | Result | Evidence | Fix |
|---|---|---|---|---|
| Run the demo script on `demo:reset` data and record it | local | PASS (recorded). **Raw action time 1:11**; 6 beats plus a 3 s placeholder for the "problem" slide (no slide exists in the app). With narration the script budget is 2:45, and no beat's actions exceed its window. | `demo-run.webm`, `B-demo-timing-local.json`, `B-local-*.png` | |
| Zero console errors during the run | local | FAIL (F-1): 24 "Blocked script execution" errors | `B-demo-timing-local.json` | |
| Demo can be done within the push limit | local | FAIL (F-7): the script as written needs Maya to confirm on her phone 5+ times and Mom 4+ times, but the limit is 3 per person per 10 minutes. Run 1 locked Maya; Run 2 locked Mom. The recorded run reorders who does what (Dad buys the gift card and does the repaired ride). | `FINDINGS.md` F-B1 | |
| Slow moments (>1 s), confusing or ugly moments | local | None over 1 s. Confusing: bare "Done." after a tap (F-8), empty red line when a call fails (F-10), "their phone" for a named person (F-11). | `B-demo-timing-local.json` | |
| Demo recorded on prod | prod | MANUAL: the demo house is reset in the local table only; resetting the prod table's `demo` house would delete data in the submitted entry. Re-run on prod after merge with a fresh house. | | |

### Part C: quality bar

| Check | Target | Result | Evidence | Fix |
|---|---|---|---|---|
| Reply speed: p95 under 500 ms over 50 calls, warm prod; cold start separate | prod | **PASS.** p95: `request_action` 400 ms, `household_status` 255 ms, `audit_log` 124 ms. Cold start 2449 ms (first call). | `C-reply-speed-prod.log` | |
| Accessibility (axe, WCAG 2 A/AA) on every screen state | local, prod | FAIL (F-13): serious `scrollable-region-focusable` on the page; serious `document-title` and `html-has-lang` in the three screen frames | `C-axe-local.json`, `C-axe-prod.json` | |
| Lighthouse performance ≥ 90, accessibility ≥ 95, best practices ≥ 95 | prod | **PASS:** 91 / 100 / 96 | `C-lighthouse-prod.report.html` / `.json` | |
| Lighthouse | local | FAIL: performance 77 (accessibility 100, best practices 96). Measured while other audits ran on the same machine; re-measure after fixes. | `C-lighthouse-local.report.json` | |
| Console: zero errors | local, prod | FAIL (F-1) | `C-console-local.json` | |
| Mobile 390 px: no horizontal scroll, phones and approval usable | local, prod | PASS | `C-mobile-local.json`, `C-local-mobile-390.png` | |
| Plain language: banned words, sentences under 12 words, grade 5 | local, prod | FAIL (F-14): "Maya is confirmed." grades 5.2. No banned words and no long sentences. `/privacy` uses "scrypt" (F-15). The developer "Message log" panel (raw protocol traffic, required by the hackathon) is excluded from this scan. | `C-plain-language-local.json` | |
| 30-second test (1 click per 2 s) | local, prod | PASS (approve a held request, and find last week's buys, each under 30 s) | `C-30s-local.json` | |
| Voice: Talk button, speech synthesis, typed fallback | local, prod | FAIL (F-16): the Talk button and speech work; pressing Enter does nothing; an unknown phrase gets a dead-end "Sorry, I didn't get that." | `C-voice-local.json`, `C-typed-unknown-local.json` | |
| Voice: live microphone | n/a | MANUAL: headless Chromium has no microphone | | |

### Part D: standard MCP clients

| Check | Target | Result | Evidence | Fix |
|---|---|---|---|---|
| MCP Inspector CLI: tools/list, both protocol versions | prod | PASS (10 tools) | `D-inspector.log`, `D-tools-list-2025-11-25.json` | |
| Raw JSON-RPC: initialize, tools/list, tools/call for 2025-11-25 and 2025-03-26 | local, prod | PASS | `D-raw-prod.log`, `D-raw-local.log` | |
| `request_action` input has no person/speaker field | local, prod | PASS (fields: service, action, item, value, option_id, replaces, request_id) | `D-raw-prod.log` | |
| `ui://` resource can be read | local, prod | PASS (5545 chars, `text/html;profile=mcp-app`) | `D-raw-prod.log` | |
| A tool RESULT carries `_meta.ui.resourceUri` | local, prod | FAIL (F-17): only the tool definition carries it | `D-raw-prod.log` | |

### Part E: security probes

| Check | Target | Result | Evidence | Fix |
|---|---|---|---|---|
| Fault injection: DynamoDB, SQS, Bedrock one at a time: hold or deny, never allow | local (tests) | PASS 5/5 plus 44 existing | `E-faults-injection-tests.log`, `tests/audit/faults.test.ts` | |
| Rate limit: 100 calls in 10 s | prod | PASS: 78 answered, 22 limited (429), 0 unlock or gift card allowed | `E-rate-limit-prod.log` | |
| Rate limit: effect on the browser | prod | FAIL (F-10): the page polls about 7 requests per second and shows an empty red line when it is limited | `partA-s0-s3.md` finding 3 | |
| Prompt injection: three kinds of hostile reply change nothing | local | PASS (`tests/s5`, and S5b in the browser on both targets) | `E-faults-injection-tests.log`, `s5b-*.png` | |
| gitleaks over full history (Docker) | repo | **PASS: 32 commits scanned, no leaks found** | `E-gitleaks.log` | |
| `npm audit` | repo | **PASS: 0 vulnerabilities** | `E-npm-audit.log` | |
| IAM: any `*` action or resource | stack | PASS: no `*` action. Wildcards only in Bedrock model ARNs, name pinned to claude-haiku-4-5 (region/account position). Three Lambda-trusted roles. | `E-iam.txt` | |
| Error text leaks an AWS role name to the client | prod | FAIL (F-3) | `partA-s11-prod.log` | |

### Part F: hackathon compliance

| Check | Target | Result | Evidence | Fix |
|---|---|---|---|---|
| Clean clone: `npm ci`, tests | temp clone | PASS with one flake (F-18): `npm test` 425 of 427 once; the 2 failures were live-Bedrock tests ("ServiceUnavailable"), rerun 55/55 twice | `F-clean-clone-npm-test.log` | |
| Clean clone: app starts per README | temp clone | see section 4 | | |
| Repo calls the MCP SDK at runtime | repo | PASS: `src/mcp/server.ts` builds the server with `@modelcontextprotocol/sdk` (`McpServer`, `StreamableHTTPServerTransport`) | `src/mcp/server.ts` | |
| LICENSE MIT; FEEDBACK.md; FRICTION_LOG.md | repo | PASS | `partA-s8-*.log` | |
| No unlicensed music or third-party trademarks in screenshots | repo | PASS by inspection: buttons say "Spotify" and "Wix" (names of the services in the stand-ins, used descriptively). MANUAL: a human should decide whether the Spotify name is acceptable in the video. | `A-s13-*.png` | |
| Stand-ins labelled wherever a judge could see them | UI | FAIL (F-5) | | |
| GitLab pipeline `rule-proofs` | CI | FAIL (F-19): the job failed on the first run | `FINDINGS.md` F-CI1 | |

## 3. Demo run

`audit/2026-10-21/demo-run.webm` (1920x1080, local, `demo:reset` data). **Raw action time 1:11.** The script window is 2:45; the recorded beats are: hook 6 s, problem slide 3 s (placeholder), three speakers 30 s, gift card 9 s, self-healing 13 s, audit 5 s, architecture 4 s. Slow moments over 1 s: none. Problems on screen: 24 console errors (F-1), the push-limit trap (F-7).

## 4. Findings (numbered; fixed items are marked in section 7)

- F-1 Console errors on every page load: "Blocked script execution in about:srcdoc … sandboxed", from the `sandbox=""` timeline and rules frames.
- F-2 S3: a held ride can be approved by nobody. Alexa says "An adult can tap NN" but Mom's phone shows "Nothing waiting". Flaky locally, 3 of 3 on prod.
- F-3 S11 prod: "Check now" cannot repair (web function lacks Bedrock permission) and the reply shows an AWS role name.
- F-4 A teen's click on "Break it" says it worked though the server refused.
- F-5 Stand-ins (Composio hub, Wix builder, email) not labelled in the UI, only in the README.
- F-6 Stand-in connect link points to a dead example host when the public URL is unset.
- F-7 The demo needs more phone taps than the limit allows per person.
- F-8 After a tap the line reads a bare "Done." (styled as held) instead of "Maya is confirmed.".
- F-9 Voice summary is 4 sentences, spec says 2-3.
- F-10 The page polls about 7 requests per second; under the limit it shows an empty red line.
- F-11 "Maya confirmed on their phone": wrong pronoun for a named person.
- F-12 `npm run ha:up` times out from a cold start.
- F-13 axe: 3 serious issues.
- F-14 "Maya is confirmed." grades 5.2; spoken held line omits the price.
- F-15 `/privacy` uses the word "scrypt".
- F-16 Enter does nothing; unknown phrases get a dead-end.
- F-17 `show_on_screen` result has no `_meta.ui.resourceUri`.
- F-18 Live Bedrock tests have no retry on transient `ServiceUnavailable`.
- F-19 GitLab `rule-proofs` job fails (no Docker in CI for DynamoDB Local).
- Info: `audit:verify` without the key reports a clean log as BROKEN; "Recent buys" is a snapshot; quiet hours answer "denied" where the spec says "hold"; prod demo sign-in and `/demo/outbox` are open by design until switched off.

## 5. Manual checks left for the human

(Updated at the end.)
1. Live microphone: press Talk in Chrome and speak; headless Chromium has no microphone.
2. A real approval email: needs a verified Amazon SES sender (`HG_EMAIL_FROM`, `HG_APPROVER_EMAIL`).
3. The 9:30 PM quiet-hours purchase on the wall clock (covered by vitest with a fake clock).
4. Whether the "Spotify" and "Wix" button names are acceptable in the video.
5. The locked-rule warning screen (no button exists in the web client; covered by vitest).
6. Switch off the open demo sign-in after judging (`-c demo=0`), then `npx cdk destroy` after Nov 20.

## 6. Method notes

- Part A: four independent auditors with no prior context, one per slice group, each wrote their own specs under `tests/audit/` (not copied from `e2e/`) and ran them on local and prod. Their reports: `partA-s0-s3.md`, `partA-s4-s7.md`, `partA-s8-s12.md`, `partA-s13-s16.md`.
- Setup that has no button in the UI (price surge, hostile service reply, editing an audit row) went through the database directly; that is stated in each report.
- Prod rate limits are per caller; parallel runs from one IP produced spurious 429s, so failed prod runs were repeated after a cool-down.

## 7. Fixes on `audit-fixes`

(To be filled in as each is fixed and re-run.)
