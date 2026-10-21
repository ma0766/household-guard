# Progress

Update after every slice. One line per check, with the command that proved it.

| Slice | Status | Proof (command + result) | Commit |
| --- | --- | --- | --- |
| S0 Walking skeleton | DONE | `npx vitest run tests/s0` 6/6 (both protocol versions, 403 bad Origin, 401 no token); `npx playwright test` s0 PASS; `npm run deploy` + `npm run smoke:deployed` → initialize/tools/list/tools/call ✓ + bad Origin 403 against deployed URL | S0 |
| S1 First decision: lights | DONE | `npm run verify` S1 PASS: `npx vitest run tests/s1 tests/replay` 10/10 replay cases, forced-DynamoDB-error → held, tz tests; `npx playwright test e2e/s1-lights.spec.ts` PASS (teen lights done, unlock denied, delete account denied; screenshot test-results/s1-denied.png) | S1 |
| S2 Who is speaking | DONE | `npx vitest run tests/s2` (name alone → denied; number lands on own phone only; 4th push → locked; 3 wrong PIN/number → locked, incl. 30 parallel guesses; PIN scrypt-hashed; phone keys bound to one person); `npx playwright test e2e/s2-who.spec.ts` PASS (test-results/s2-number-match.png) | S2 |
| S3 Money: the ride | DONE | `npx vitest run tests/s3 tests/replay`: concurrency (two $15 vs $20 cap → one allowed, one held by the DB reservation, `why: cap_race`), duplicate (same request_id twice → one ride, one spend), worker failure releases money; replay at 20 cases; `npx playwright test e2e/s3-ride.spec.ts` PASS; deployed with SQS + worker Lambda | S3 (in S2/S4 commits) |
| S4 Approvals + a yes that fits | DONE | `npx vitest run tests/s4` 18 tests (teen $38 held → $14 shared offered → accepted, $24 SAVED row; Mom approves by number → booked; surge → held again + new approval, money released; PIN/non-adult can't approve; voice approval needs a fresh phone confirmation); `npx playwright test e2e/s4-approvals.spec.ts` PASS (test-results/s4-*.png) | S4 |
| S5 Risk check | DONE (mock) — live Bedrock blocked, see below | `npx vitest run tests/s5` 17 pass + 1 live-Bedrock test skipped until access works; gift card allowed by rules → held by risk check; injection tests; BedrockRisk fail-closed (throw/timeout/garbage/not-low → hold); `npx playwright test e2e/s5-risk.spec.ts` PASS | S5 |
| S6 Audit and status | DONE | `npx vitest run tests/s6` (hash chain: edited row / edited data / removed row / cut-off end / 20 parallel writers / daily checkpoint lets old rows be deleted; `npm run audit:verify -- <household> --local` exits 1 on an edited row, 0 when clean; plain sentences; person/day filters; voice summary totals first; real household_status; screens escape outside text); `npx playwright test e2e/s6-audit.spec.ts` PASS (test-results/s6-timeline-saving.png: the $24 saving in the timeline) | S6 |
| S7 Editable rules + full replay | DONE | `npx vitest run tests/s7 tests/replay` (limit change follows on the next decision; teen/guest/PIN-only/stolen tap refused; undo newest-only within 24h; locked rules need warning + 2nd tap; bad input refused before save; kids see own rules; OCC on parallel edits); replay = 30 of 30 cases; `npx playwright test e2e/s7-rules.spec.ts` PASS (test-results/s7-rule-card.png) | S7 |
| S8 Hardening + submission pack (code parts) | not started | | |

## Decisions

- 2026-10-20 Table name `household-guard` (DynamoDB needs 3+ chars). Local DynamoDB on 127.0.0.1:8018 (claimed in ~/.claude/ports.md), server+client on 8016, Vite dev 8017.
- 2026-10-20 Bearer token is an HMAC-signed value from day one (`src/auth.ts`); secret from `HG_TOKEN_SECRET` (deploy generates it into gitignored `.env.deploy`). Hosted web client signs in via `/demo-token` (enabled by `HG_DEMO=1` on the deployed Lambda) — demo only; S8 revisits.
- 2026-10-20 Origin check: 403 only when an Origin header is present and is neither same-host nor in `HG_ALLOWED_ORIGINS`; CLI clients send none.
- 2026-10-20 Bedrock: `anthropic.claude-haiku-5-5` is not available to this account; `us.anthropic.claude-haiku-4-5-20251001-v1:0` answers a Converse call. Use that for S5.
- 2026-10-20 Lambda Web Adapter layer `...LambdaAdapterLayerX86:30` (from adapter README).

- 2026-10-20 Cedar text is generated from a rules config (`src/policy/rules.ts`) so adults edit cards, never Cedar (S7); defaults are committed as `src/policy/auto.cedar` / `approvable.cedar` and a test keeps them in sync.
- 2026-10-20 Replay "outcome" is the three-answer decision (allowed/held/denied); later slices add a `done:false` + confirm step on top without changing the decision.
- 2026-10-20 Guest is a stored person; no confirmed session = guest.
- 2026-10-20 One household-wide "current speaker" session slot (latest confirmation wins, 5 min). Low-risk actions use it; medium/high actions always need a tap on THAT person's own phone, so a teen speaking after Mom's confirmation cannot finish anything that matters. Known limit: Alexa gives add-ons no per-speaker identity.
- 2026-10-20 A request waiting for a phone tap returns outcome `allowed` + `done:false` + `next:confirm_on_phone` (the rules said yes; nothing has run). Agents must check `done`.
- 2026-10-20 Phone keys: each simulated phone gets a token with aud=phone and sub=person; the voice-side token cannot read or tap phones (reviewer finding).
- 2026-10-20 Guess guard counts an attempt BEFORE checking it (optimistic-concurrency write), so parallel guesses cannot beat the 3-try limit.
- 2026-10-20 Approvals only for purchases (money). An adult's yes on an exact purchase skips the AI risk check (stronger than the check). The risk check is skipped never otherwise (PIN path, cheaper-option path, tap path all get checked).
- 2026-10-20 Idempotency: with a `request_id` a retry is remembered for an hour; without one only for 5 seconds (so asking the same thing again, later, gets a fresh answer). The web client sends a fresh request_id per utterance.
- 2026-10-20 By voice, `approve_request` needs the adult's phone confirmation to be newer than the held request and under a minute old; the number is spoken aloud so it proves nothing alone. The phone route is the strong path.
- 2026-10-20 Audit hash is a keyed HMAC (`HG_AUDIT_KEY`, falls back to the token secret) so someone who can only write to the table cannot recompute a believable chain. Entries expire after 90 days (TTL); daily checkpoints (kept 400 days) let verification still work after old rows are gone. Known limit: deleting ALL rows plus the head record is only detectable against an outside copy.
- 2026-10-20 Who may read: guests/unconfirmed see nothing in the log or screens; kids see only their own; adults see the house. `household_status` stays open (it only says how many things wait and how much each kid has left).
- 2026-10-20 The log never changes an answer: building or writing a sentence can fail loudly in logs but never throws to the caller. Words from callers are whitelisted/trimmed before they reach a sentence.
- 2026-10-20 Rule edits: every change (and undo) needs the adult's own phone tap; the 3-pushes-per-10-minutes limit applies to rule edits too (by design). The weekly-limit card sets the per-buy limit to the same amount. Undo only reverts the newest applied change.
- 2026-10-20 Fixed a real bug found by the S7 test: the audit hash depended on key order in `data`; the hash now sorts keys at every level.

## Blocked on user

- Amazon Bedrock: `aws bedrock-runtime converse` on `us.anthropic.claude-haiku-4-5-20251001-v1:0` returns "Model use case details have not been submitted for this account" (it worked once early on, then stopped; looks like account verification still in progress). Needs: AWS console → Bedrock → Model access → submit the Anthropic use-case form, wait ~15 min. Until then the deployed worker's risk check fails closed (every purchase gets held for an adult) and local/tests use the mock. The live test in tests/s5/risk.test.ts un-skips itself when the call works. Retried 2026-10-20 (3 times) — still blocked.

## Left for the human (not in the goal)

- Make the GitLab repo PUBLIC (GitLab: Settings → General → Visibility → Public) and add an MIT LICENSE before submitting on Devpost.
- Copy the repo to a GitHub repo before submitting; Devpost accepts GitHub only.
- Record the 2:45 video (script in docs/SPEC.md, "Demo script")
- Hallway test with two people (docs/SLICES.md, "Usability standard")
- Fill the friction log "what happened" column from real build notes
- Submit on Devpost before Fri Oct 23, 12:00 PM PT
