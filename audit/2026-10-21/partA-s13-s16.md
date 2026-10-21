# Part A audit: S13, S14, S15, S16 and the 30 replay cases

Auditor run 2026-10-21. Targets: local (http://127.0.0.1:8016, MOCK risk check) and prod (Lambda URL from .env.deploy). Evidence is under `audit/2026-10-21/` (prefix `A-`, plus `pw-local/a4/`, `pw-prod/a4/` with video + trace + screenshots per test, and `results-*-a4.json`).

Specs: `tests/audit/s13.spec.ts`, `tests/audit/s15.spec.ts`, helpers in `tests/audit/helpers.ts`. Commands:

    AUDIT_TARGET=local AUDIT_GROUP=a4 npx playwright test -c playwright.audit.config.ts tests/audit/s13.spec.ts tests/audit/s15.spec.ts
    AUDIT_TARGET=prod  AUDIT_GROUP=a4 npx playwright test -c playwright.audit.config.ts tests/audit/s13.spec.ts tests/audit/s15.spec.ts

Logs: `A-s13-s15-local.log`, `A-s13-s15-prod.log`, reruns `A-s13-{local,prod}-flow-rerun.log`.

## Summary table

| Check | Local | Prod |
| --- | --- | --- |
| S13 done-when (teen connects, token separate from Mom) | PASS functionally, FAIL on link host + console errors | PASS functionally, FAIL on console errors |
| S13 stand-in labelled in UI | FAIL | FAIL |
| S13 stand-in labelled in README | PASS | PASS (same file) |
| S15 done-when (preview within the job) | PASS functionally, FAIL on console errors | same |
| S15 stand-in labelled in UI | FAIL | FAIL |
| S15 stand-in labelled in README | PASS | PASS |
| S14 live Home Assistant | PASS (5/5, local Docker only) | MANUAL / not applicable: a Lambda cannot reach a container on this machine (known, in PROGRESS.md) |
| S16 off by default | PASS | not deployed on prod (synth is stage-level) |
| S16 reply time vs 500 ms | OVER 500 ms through the gateway at p95 | (measured against roadmap stack, see below) |
| 30 replay cases | PASS 30/30 | PASS 26/26 replicable; 4 not replicable over HTTP |

## S13 Connect any app, per person

Flow driven in Chromium: Maya asks "Play jazz" -> held ("That's new here. An adult must say yes."); Mom taps Allow Spotify with her own phone tap; Maya connects (link + QR on screen, opens the app page, presses Allow, "Connected"); Maya plays ("Done with Spotify: play jazz."); Mom still gets "Connect Spotify first." (her key is separate from Maya's); guest gets "Tell me who you are first." Evidence: `A-s13-01..06-*.png`, `A-s13-texts-local.json`, `A-s13-texts-prod.json`.

FAIL findings:

1. **Stand-in not labelled in the UI (local and prod).** The Apps panel a judge sees reads only: "Apps / Connect Spotify / Allow Spotify (adult) / Build a site for my bakery / Play jazz on Spotify" (`A-s13-label-apps-panel.png`; `web-client/index.html` lines 33-41 have no label). The app's own sign-in page reads only "Connect an app. Say yes to let the house use this app for you. Allow" (`src/server.ts` STANDIN_PAGE, line ~67). It looks like a real app sign-in. The word "stand-in" appears nowhere a judge looks, except inside the link host (below).
2. **Link and QR go to a dead host when HG_PUBLIC_URL is unset (local).** The connect screen shows `https://connect.stand-in.example/standin/connect/<id>` (`src/hub/hub.ts:38` default). A person scanning it gets ERR_NAME_NOT_RESOLVED, so "Done when" cannot be done by following the link. My spec rewrites the host to continue. On prod HG_PUBLIC_URL is set and the link is the real Lambda URL (works). The only "label" the stand-in has is this unreachable host name, which is not a label.
3. **Console errors (local and prod).** 12 "Blocked script execution in 'about:srcdoc' / 'about:blank' because the document's frame is sandboxed and the 'allow-scripts' permission is not set" per session (timeline/rules iframes in `web-client/index.html` use `sandbox=""` while the served HTML includes script). Recorded in `A-s13-texts-*.json` (`errs`).
4. UX: the speaker box goes blank (class "denied", no text) when the confirm call fails or is refused. Seen once on each target (`A-s13-s15-prod.log` test 2: `<div id="alexa-says" ... data-outcome="denied"></div>`). Cause: `web-client/main.ts` lines 142 and 238-240 print `r.say`, but the `callTool` fallback (line 83) returns `reason`, not `say`. A person sees an empty red box with no words. Likely triggered by server throttling or a transient error; I did not isolate which.
5. UX: on prod the login acknowledgement was once a bare "Done." instead of "Maya is confirmed." (first prod run, tests 1 and 4). Inconsistent wording; my helper now accepts both.

README: PASS. `README.md` line 80: "**Stand-ins, clearly labelled:** the app hub (Composio), the site builder (Wix) and email sending (SES) run against stand-ins until keys exist." Note it is labelled in the README only, not in the product.

## S15 Long jobs and site building

Driven: teen "Build a site" -> "That's new here. An adult must say yes." (nothing built); guest -> "Tell me who you are first."; Mom asks -> answer in 122 ms local / 234 ms prod (job id, "Confirm on your phone: NN"); she taps; screen shows "Your site is ready: Sunny Bakery", QR + link; the preview page opens (200) and contains "Sunny Bakery". Progress text "Your site is ready. Sunny Bakery." seen on prod (the poll did not catch intermediate steps; at 700 ms polling the job finishes fast). Evidence: `A-s15-01..04-*.png`, `A-s15-texts-local.json`, `A-s15-texts-prod.json`.

FAIL findings:

1. **Stand-in not labelled in the UI (local and prod).** Ready screen: "Your site is ready: Sunny Bakery / Scan the code, or open the link, on your phone." Preview page: "Sunny Bakery / Fresh and local. / Welcome to Sunny Bakery. / A one-page site for Sunny Bakery. / Come by and say hello." Nothing says this is a sample built by a stand-in, not Wix. The button reads "Build a site for my bakery" with no marking. A judge would believe a real site was published.
2. **Console errors:** same sandbox "Blocked script execution" errors (8 per run).
README: PASS, line 80 (Wix named as a stand-in).

## S14 Real smart home (local only)

- `npm run ha:test` (official image `ghcr.io/home-assistant/home-assistant:stable`, port 8020): **PASS, 5/5** (`A-s14-ha-test.log`). `npx vitest run tests/s14`: 13/13 (`A-s14-unit.log`). `npm run ha:down` removed the container (`A-s14-ha-down.log`).
- FAIL finding: **`npm run ha:up` fails from a cold state.** With no `hg-ha` container it ended with "Error: timeout" at `scripts/ha-up.ts:65` three times (`A-s14-ha-up.log`, `A-s14-ha-up-attempt2.log`, and a direct run) and left no container behind. After I started the container by hand with the same `docker run` command the script uses, `npm run ha:up` succeeded (`A-s14-ha-up-attempt3.log`). The README quickstart route is therefore unreliable. Cause not fully diagnosed. A stale `.ha-bootstrap` (mode 0644, dated Oct 20) was present, contradicting the note that it is deleted and kept 0600; it is gitignored.
- Prod: MANUAL / not applicable. The deployed Lambda cannot reach a local container (stated in PROGRESS.md).

## S16 AgentCore gateway

- Off by default: PASS. `cdk synth HouseholdGuard-roadmap -c stage=roadmap` with no switch gives 0 `AWS::BedrockAgentCore::*` resources; with `-c agentcore=1` it gives Gateway, GatewayTarget, PolicyEngine, Policy with `EnforcementMode: LOG_ONLY`; with `-c agentcoreEnforce=1` also, `ENFORCE` (`A-s16-synth.log`). `npx vitest run tests/s16`: 39/39 (`A-s16-unit.log`).
- Reply time (docs/REPLY-TIME.md, measured by the project, not re-run by me): direct 165 ms p50 / 252 ms p95 / 343 ms slowest = within 500 ms. **Through the gateway 351 ms p50 / 549 ms p95 / 798 ms slowest = OVER the 500 ms limit at p95.** So the gateway must stay off for Alexa+; the "when on, measured and compared" requirement is met, and the answer is that it fails the limit. README says "off by default" but does not mention it misses the limit.

## 30 replay cases

- Local: `npx vitest run tests/replay` -> 30/30 pass (`A-replay-local.log`).
- Prod: `audit/2026-10-21/replay-prod.ts` replays over HTTP (fresh household per case, phone taps, PIN for Leo, set_rule for rule cases, `/demo/guest` to clear the speaker). Result: **26 pass, 0 differ**, 4 not replicable over HTTP (`A-replay-prod.log`):
  - `adult-lights-by-pin-done`, `adult-unlock-by-pin-held`: Mom has no PIN in the seeded household and no public tool sets one. MANUAL.
  - `needs-approval-teen-lights-held`, `deny-adult-lights-denied`: no public tool creates those rules. MANUAL (covered in-process only).
- Note: after an adult edits a rule, the household-wide current speaker stays that adult for 5 minutes, so a "guest" request right after is answered as Mom (and hit the 3-push lock until I cleared the session). This is the documented one-speaker-slot limit, not a regression.

## Not touched

Nothing under `src/`, `web-client/`, `infra/` or existing tests was modified. `package.json` and `package-lock.json` show as modified in git status; that was not me (another auditor).
