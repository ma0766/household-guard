# Audit plan: Household Guard demo readiness

The auditor's job is to **find what is broken or below standard**, not to confirm that things work. A check passes only with evidence: a command and its output, a screenshot, or a video. "Looks fine" is not evidence.

Run every check twice: against the **local** stack (`npm run demo:reset && npm run dev`) and against the **deployed prod URL**. Record which target each result came from.

Save all evidence under `audit/<date>/`: screenshots (`.png`), Playwright videos (`.webm`), traces, and command logs. Write the results to `docs/AUDIT-REPORT.md`.

## Part A: every vertical slice, through the real UI in Chromium

Use Playwright with Chromium, `video: 'on'`, `trace: 'on'`. For each slice S0–S16, turn its "Done when" line in docs/SLICES.md into a browser script that clicks through the web client the way a person would. Don't call internal functions directly. One spec file per slice under `tests/audit/`.

| Slice | Must be shown in the browser |
| --- | --- |
| S0 | Tools listed from the deployed URL; a bad Origin gets 403; no sign-in gets 401 |
| S1 | Teen lights → done; teen unlock → denied with a reason in plain words; "delete account" → denied |
| S2 | "I'm Mom, unlock the door" without Mom's confirmation → denied; the teen's purchase shows a number on the teen's phone panel, not Mom's; 4th push in 10 min → locked; 3 wrong PINs → locked |
| S3 | Two $15 rides fired at the same moment against a $20 cap → one booked, one held; a duplicate request → one ride |
| S4 | Teen $38 ride → held → $14 shared ride offered → accepted, $24 saving shown; Mom matches the number and approves a $38 ride → booked; price surge after approval → held again |
| S5 | Gift card allowed by the rules → held by the AI check (live Bedrock, not the mock); hostile service reply changes nothing |
| S6 | Audit timeline in plain sentences; filter by person and by day; an edited log row is caught by the verify script |
| S7 | Mom changes Maya's limit on a rule card → next decision follows it; teen can't change a rule; undo works; locked safety rules warn before change |
| S8 | Token checked on every call; privacy and metadata pages load; README, FEEDBACK, FRICTION_LOG, LICENSE present |
| S9 | Approval made from an MCP Apps screen books the ride |
| S10 | CI proof passes on shipped rules and fails when a rule lets a child unlock; quiet hours hold a 9:30 PM purchase in the household time zone |
| S11 | Break the ride service → health check fails → repair passes tests → next ride needs one approval |
| S12 | Cognito sign-in works; the demo sign-in flag works; email/push approval path (label if stand-in) |
| S13–S15 | Work end to end against their stand-ins, and **the UI and README clearly label them as stand-ins** |
| S16 | Off by default; when on, reply time measured; result compared with 500 ms |

The 30 replay cases must also pass on both targets.

## Part B: the demo script, exactly as it will be recorded

Run the "Demo script (2:45)" from docs/SPEC.md start to finish in one recorded Chromium session at 1920×1080, using `npm run demo:reset` data (Mom, Dad, Maya 15, Leo 8, a guest).

- Time each segment and report the total. It must fit under 2:45 with natural pauses.
- Save the video as `audit/<date>/demo-run.webm`. This is also raw footage for the real video.
- Note every moment that is slow (over 1 s to respond), confusing, ugly, or shows an error, a spinner that never ends, a console error, or tech words.

## Part C: world-class quality bar

| Check | Pass rule | How |
| --- | --- | --- |
| Reply speed | Every tool call on the warm deployed server: p95 under 500 ms over 50 calls; report cold start separately | Script against prod URL |
| Accessibility | No serious or critical issues on every screen | `@axe-core/playwright` |
| Lighthouse | Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95 on the web client | Lighthouse CLI with Chromium |
| Console | Zero errors and zero unhandled promise rejections during Part B | Playwright console listener |
| Mobile width | Phone panels and approval card usable at 390 px wide, no horizontal scroll | Playwright viewport |
| Plain language | No word from the banned list ("policy", "Cedar", "token", "MCP", "schema", "JSON", "error code") in any user-facing text or speech; sentences under 12 words; reading grade 5 or below | Scan rendered text of every screen and every spoken reply |
| 30-second test | Scripted "approve a held request" and "find last week's purchases" each complete in under 30 s of simulated human pace (1 click per 2 s) | Playwright timing |
| Voice | Talk button present; spoken replies use speech synthesis; typed fallback works | Headless Chromium can't use a microphone: test synthesis and fallback, and list the live-mic check as **manual for the human** |

## Part D: works with standard MCP clients (replaces "OpenClaw")

OpenClaw was never part of this project. Instead, prove the server works with standard MCP tooling outside our own web page:

- MCP Inspector CLI (`npx @modelcontextprotocol/inspector --cli <prod URL>`): initialize, tools/list, tools/call, using both protocol versions 2025-11-25 and 2025-03-26.
- Confirm `request_action`'s input schema has **no person or speaker field**.
- Confirm one tool result includes `_meta.ui.resourceUri` and the `ui://` resource can be read.

## Part E: security probes

- Fault injection: force DynamoDB, SQS and Bedrock failures one at a time → every case returns hold or deny, never allow.
- Rate limit: burst 100 calls in 10 s → limited, nothing allowed that shouldn't be.
- Prompt injection: three different hostile service replies → no decision changes.
- Secrets: gitleaks over the full git history (Docker) → clean. `npm audit` → no high or critical.
- IAM: list every role and permission in the CDK output; flag any `*` action or resource.

## Part F: hackathon compliance

- A clean clone into a temp folder: `npm ci`, README quickstart, and the app starts without extra steps.
- The repo imports and calls the MCP SDK at runtime (point to file and line).
- LICENSE is MIT; FEEDBACK.md covers every tool used; FRICTION_LOG.md entries have steps, severity, workaround and suggestion.
- No unlicensed music or third-party trademarks in screenshots or assets.
- Stand-ins are labelled everywhere a judge could see them.

## Fixing

- First write the full report with every failure. Then fix failures on a branch `audit-fixes`, re-run only the failed checks, and repeat until they pass.
- Never weaken, skip or delete a test or a pass rule to make a check pass. If a pass rule is impossible (for example, the live mic), mark it **manual** with the reason.
- Merge `audit-fixes` into main only when every non-manual check passes. Deploy prod only after that, run Part A S0 and Part D again on prod, and tag `submission-v3`.

## Report format (docs/AUDIT-REPORT.md)

1. One-line verdict: READY or NOT READY, and why.
2. Table: check · target (local/prod) · PASS/FAIL/MANUAL · evidence file · fix commit.
3. Demo run: total time, slow or confusing moments, link to demo-run.webm.
4. Manual checks left for the human, in plain words.
