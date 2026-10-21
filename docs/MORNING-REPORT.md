# Morning report (written 2026-10-21)

## The short version
All of S0 to S16 is built, tested and pushed on branch `roadmap`. **Update: you signed in again. `npm run verify` now exits 0 (S0 to S16 all PASS) and e2e passes 18/18, so `roadmap` is merged into `main`.** Prod was NOT redeployed.

## Proof (what I ran)
- Tag `submission-v1` is on the remote. The submitted site was never touched.
- Independent review of S0 to S8: done earlier; every gap fixed (list in `docs/PROGRESS.md`).
- `grep -rnE "\.skip|\.only|xit\(|it\.todo" tests` prints nothing.
- `npm run e2e`: **18 passed**. That includes an approval from an MCP Apps screen, the proof that fails when a rule lets a child unlock, and a repaired connector that then needs one approval.
- `npm run verify`: lint ok, typecheck ok, e2e ok. Unit tests: **424 of 427 pass**. S0 to S4, S6 to S10, S12 to S16 are PASS. **S5 (2 tests) and S11 (1 test) FAIL** only because they call the real Bedrock model and the sign-in expired ("Your session has expired").
- `npm audit`: 0 vulnerabilities. gitleaks over all history: no leaks. `docs/THREAT_MODEL.md` is written (each threat, defense, proving test).

## Done
S0 to S16, each with tests and a review. Roadmap is live on its own stack (`HouseholdGuard-roadmap`): real Cognito sign-in worked in a real browser; a real ride ran through the queue and worker. Demo house reset: `npm run demo:reset` (Mom, Dad, Maya 15, Leo 8 with PIN 4821, a guest). README quickstart followed from a clean clone: it found two test files that reached the cloud table (fixed, tests now always use the local one). A time-of-day bug in a quiet-hours test was also fixed.

## Stand-ins (not real yet)
- App hub (Composio): stand-in, no key. Tool names unverified.
- Site builder (Wix): stand-in, no key. Tool names are guesses.
- Email sending (SES): stand-in. No verified sender.

## Skipped on purpose
- S17 Fire TV: needs a Mac or Ubuntu with KVM; this is WSL.
- S18 Certification: needs Amazon and a lawyer, not code.

## Broken or limited
- AgentCore gateway is slower than 500 ms at p95 (549 ms vs 252 ms direct). It is OFF by default. It answers as a guest only.
- Home Assistant works only on this laptop (Docker, port 8020).
- Dad shows on the web page only when you open it with `?dad=1` (after `npm run demo:reset`).
- The open demo sign-in on the submitted site is still on, as submitted.

## What you must do next (in order)
1. Nothing to merge: done. Do not deploy prod unless you want to.
2. Verify an SES sender; put `HG_EMAIL_FROM` and `HG_APPROVER_EMAIL` in `.env.deploy.roadmap`; `npm run deploy:roadmap`.
3. Add Composio and Wix keys when you have them. Add `HG_ALEXA_VENDOR_ID` when Amazon gives it.
4. Make the repo public, copy it to GitHub, record the video, run the hallway test with two people, submit on Devpost.
5. After judging: switch the open demo off with `-c demo=0`.
6. Costs and cleanup: the roadmap stack costs a little (`npx cdk destroy` it with stage roadmap when done). A Home Assistant container is running: `npm run ha:down`. Fill the "what happened" column in FRICTION_LOG.md.
