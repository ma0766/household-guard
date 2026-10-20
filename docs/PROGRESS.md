# Progress

Update after every slice. One line per check, with the command that proved it.

| Slice | Status | Proof (command + result) | Commit |
| --- | --- | --- | --- |
| S0 Walking skeleton | DONE | `npx vitest run tests/s0` 6/6 (both protocol versions, 403 bad Origin, 401 no token); `npx playwright test` s0 PASS; `npm run deploy` + `npm run smoke:deployed` → initialize/tools/list/tools/call ✓ + bad Origin 403 against deployed URL | S0 |
| S1 First decision: lights | not started | | |
| S2 Who is speaking | not started | | |
| S3 Money: the ride | not started | | |
| S4 Approvals + a yes that fits | not started | | |
| S5 Risk check | not started | | |
| S6 Audit and status | not started | | |
| S7 Editable rules + full replay | not started | | |
| S8 Hardening + submission pack (code parts) | not started | | |

## Decisions

- 2026-10-20 Table name `household-guard` (DynamoDB needs 3+ chars). Local DynamoDB on 127.0.0.1:8018 (claimed in ~/.claude/ports.md), server+client on 8016, Vite dev 8017.
- 2026-10-20 Bearer token is an HMAC-signed value from day one (`src/auth.ts`); secret from `HG_TOKEN_SECRET` (deploy generates it into gitignored `.env.deploy`). Hosted web client signs in via `/demo-token` (enabled by `HG_DEMO=1` on the deployed Lambda) — demo only; S8 revisits.
- 2026-10-20 Origin check: 403 only when an Origin header is present and is neither same-host nor in `HG_ALLOWED_ORIGINS`; CLI clients send none.
- 2026-10-20 Bedrock: `anthropic.claude-haiku-5-5` is not available to this account; `us.anthropic.claude-haiku-4-5-20251001-v1:0` answers a Converse call. Use that for S5.
- 2026-10-20 Lambda Web Adapter layer `...LambdaAdapterLayerX86:30` (from adapter README).

## Blocked on user

- (none yet)

## Left for the human (not in the goal)

- Make the GitLab repo PUBLIC (GitLab: Settings → General → Visibility → Public) and add an MIT LICENSE before submitting on Devpost.
- Copy the repo to a GitHub repo before submitting; Devpost accepts GitHub only.
- Record the 2:45 video (script in docs/SPEC.md, "Demo script")
- Hallway test with two people (docs/SLICES.md, "Usability standard")
- Fill the friction log "what happened" column from real build notes
- Submit on Devpost before Fri Oct 23, 12:00 PM PT
