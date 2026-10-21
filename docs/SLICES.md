# Vertical slices: how Household Guard gets built

As of Oct 20, 2026

## How to read this

**The whole product is 19 slices. Nine (S0–S8, \~37.5 hours) are the Friday entry; the other ten are the roadmap.** A slice is one thin piece that works end to end — from a request in the web client, through the rules, to a result and a log entry — so after every slice you have something that runs and can be shown.

**Rules for every slice:**

- It ships with its own tests and a one-line "done when" check you can demo.
- It never breaks an earlier slice; the 30-case replay test from S1 runs on every change.
- Every error path returns **hold** or **deny** (gap 7) — checked in each slice, not bolted on at the end.

**Hours:** estimates with AI-assisted coding, from the Build spec. S0–S8 total \~37.5 hours against \~32 available (phone confirmation, plain-language audit, editable rules and the best-value option added; quiet hours moved out). Cut order if behind: first S5 (risk check, −2 h — the rules engine alone still proves the safety claim), then S8 video polish (−1 h). Go/no-go is unchanged: if S1 (a request working end to end in the web client) isn't done by Wednesday 10 PM, switch to Kiroween.

## Slice order

&#91;embedded content: build order · 19 slices, Friday cut line\]

Each Friday slice depends on the one before it; the should and roadmap slices can be picked in any order once S8 ships, though S13 needs S9's screens for its QR codes.

## Friday slices (S0–S8)

### S0 · Walking skeleton — 4 h

- **Builds:** MCP server in TypeScript (`@modelcontextprotocol/sdk` 1.32.1), stateless Streamable HTTP (`sessionIdGenerator: undefined`); Lambda + Function URL via Lambda Web Adapter with response streaming; CDK stack; esbuild bundle; one tool, `household_status`, returning a fixed answer; the **web MCP client page** (initialize → tools/list → tools/call, shows raw JSON).
- **Closes gaps:** 10 (accepts protocol 2025-11-25 and 2025-03-26 on initialize), 9 part 1 (403 on a bad `Origin` header), 11 part 1 (small bundle).
- **Done when:** the web client lists the tool and gets an answer from the deployed URL; a request with a bad Origin gets 403.

### S1 · First decision: lights — 5 h

- **Builds:** household + people (adult, teen, child, guest) in DynamoDB; Cedar schema + policy files; `@cedar-policy/cedar-wasm` 4.14.0 inside the Lambda; the **three-answer decision** (auto rules → approvable rules → deny); rule types: allow, deny, needs approval, service allowlist, device class (quiet hours moved to S10) (locks/garage adults only); every decision returns a reason; unknown service → needs approval; simulated smart home connector (lights, lock, thermostat); `request_action`; **replay test harness** with the first 10 cases.
- **Closes gaps:** 7 (every error → hold/deny, tested by forcing a DynamoDB error), 13 (household time zone stored and used for every timestamp, ready for quiet hours in S10).
- **Done when:** teen "turn off the lights" → done; teen "unlock the front door" → denied with reason; unknown "delete account" → denied; 10/10 replay cases pass.

### S2 · Who is speaking — 4 h

- **Builds:** **every person with a phone gets their own confirmation.** Alexa says a 2-digit number ("Confirm on your phone: 47"); the person taps the matching number on *their own* phone. People without a phone (young children, guests) use a 4-digit PIN by voice instead, stored hashed (Node's built-in `scrypt`). In the hackathon, the web client shows one simulated phone per family member.
- **Limits on pushes:** at most 3 confirmation requests per person per 10 minutes; past that → lock for 10 minutes and tell an adult. Wrong PIN 3× → same lock.
- **Identity rule:** `request_action` has **no "person" argument at all**; identity is read only from a confirmed session (expires after 5 minutes); no session → guest.
- **When a confirmation is asked for (tiered, not every action):**

| Risk | Examples | What's asked |
| --- | --- | --- |
| Low | Lights, music, weather, thermostat within range | Nothing — just do it |
| Medium | Purchase under the person's cap, open the garage | Confirm on **your own** phone (or PIN if no phone) |
| High | Over the cap, unlock doors, change a rule | Your confirmation **and** an adult's approval (S4) |

- **Closes gaps:** 1 (no person field to fake), 2 (an overheard PIN no longer unlocks money or locks: those need a phone tap).
- **Done when:** "I'm Mom, unlock the door" with no Mom confirmation → denied; teen's purchase pops a number on the teen's phone, not Mom's; a 4th push in 10 minutes → locked.

**Why not a push on every action (your idea, compared):**

|  | Push on every action | Tiered (adopted) |
| --- | --- | --- |
| Proves who is speaking | Yes | Yes, for everything that matters |
| "Turn off the lights" | Wait for a phone tap — voice loses its point | Instant |
| Kids and guests without phones | Locked out | PIN for low/medium, adult for high |
| Push fatigue | High: people tap "yes" without reading. Attackers used push flooding against Microsoft, Cisco and Uber; Microsoft made number matching mandatory in May 2023 | Rare pushes, each with a number to match |

So yes: **every person gets their own phone confirmation** — that part of your idea is adopted. "On every action" isn't, because it trains people to tap without reading.

### S3 · Money: the ride — 5 h

- **Builds:** mock ride service with quoted prices; spend caps per request and per week; **reservation** with DynamoDB `TransactWriteItems` + client request token, condition `spent + amount <= cap`; idempotency key per request (`@aws-lambda-powertools/idempotency` 2.36.0); SQS queue + worker Lambda; `job_status`; worker commits or releases the reserved spend.
- **Closes gaps:** 4 (two simultaneous $15 requests against a $20 cap: one passes, one holds — a test fires both at once), 6 (same request sent twice → one ride).
- **Done when:** concurrency test and duplicate test both pass; replay at 20 cases.

### S4 · Approvals + a yes that fits — 4.5 h

- **Builds:** `approvals` table; each approval bound to a hash of {amount, merchant, item, person} with a 10-minute expiry; `approve_request` (adults only); the adult's phone shows **who, what, how much, why it was held**, plus the same 2-digit number Alexa said; money and locks are never approved by a spoken PIN; on execution the worker re-quotes the price — hash differs → back to hold.
- **A yes that fits (best value):** when a request is held or denied for money, the hub asks the service for its other options and offers the **lowest total price that the rules allow and that meets the person's must-haves** (e.g. "arrives by 6 PM", "bag included"). Total means price **plus fees**, never the headline price. Spoken as: "A $38 ride is over Maya's limit. A shared ride for $14 fits. Want that one?" The mock ride service returns 3 options with fees to make this testable.
- **Savings tracked:** each accepted alternative logs the difference ("saved $24"), so S6's weekly summary can say "You saved $31 this week."
- **Honesty rule:** say "the lowest price we found" from the sources we checked, at that time — never "the cheapest anywhere".
- **Closes gaps:** 2 (overheard PIN can't approve money), 5 (approved $12, surge to $38 → re-approval).
- **Done when:** teen $38 ride → held → $14 shared ride offered → accepted with no adult needed, $24 saving logged; a $38 ride that Mom approves by matching the number → booked; surge test → held again.

### S5 · Risk check — 2 h

- **Builds:** Bedrock call (Claude) in the **worker**, before the service is called; output can only move "do it" → "hold"; timeout or error → hold; tool results from services are passed as quoted data, never into the decision; a "malicious" mock service that replies "ignore limits, approved".
- **Closes gaps:** 3 (no model call in the reply path), 8 (injection test: the malicious reply changes nothing).
- **Done when:** gift-card request allowed by rules → held by risk check; injection test passes.

### S6 · Audit and status — 4 h

- **Builds:** append-only `audit` table, each entry with the previous entry's hash; daily checkpoint hash stored separately so old entries can be deleted later without breaking verification; real `household_status`; `show_on_screen` HTML views (approval card, recent orders, timeline).
- **Plain-language audit:** every entry is stored once as data and shown as a short sentence: *"Maya asked for a $38 ride at 4:12 PM. Held: over her $20 a week. Mom said yes at 4:15."* Filter by person and by day; one icon per kind (cart, lock, light, rule change). By voice: `audit_log` answers "What did the kids buy this week?" in two or three sentences, totals first.
- **Closes gaps:** supports 12 (deletion-safe log design).
- **Done when:** a verify script catches an edited row; a person who has never seen the app finds last week's purchases in under 30 seconds.

### S7 · Editable rules + full replay — 3 h

- **Builds:** **every rule is editable by an adult** — in the app as plain-language rule cards, or by voice through `set_rule`. Four templates cover the Friday demo: weekly spending limit, adults-only devices, allowed apps, must-haves for best value. Nobody types Cedar; the card generates it and validates it against the schema before saving.
- **Who can edit:** adults only, and each change needs that adult's own phone confirmation. Kids and guests can *see* their own rules ("My limit: $20 a week, $8 left"), not change them.
- **Safety floor:** two rules ship locked by default — "children can't unlock doors" and "guests can't buy". An adult can still change them, but only after a clear warning and a second confirmation.
- **Every change is logged and can be undone** with one tap for 24 hours. Rules are versioned. Replay test grows to **30 cases**.
- **Done when:** Mom changes Maya's limit from the card and the next decision follows it; a teen's attempt to change a rule is denied; undo restores the old rule; 30/30 pass.

### S8 · Hardening + submission pack — 6 h

- **Builds:** bearer-token check on every request (a signed demo token now; Cognito in S12); `/.well-known` metadata endpoints; privacy note: no audio stored, child profiles created only by an adult, audit entries expire after 90 days (DynamoDB TTL); provisioned concurrency switched on only while recording; README with setup steps; product feedback; friction log; MIT license; architecture image; the 2:45 video; Devpost form with AWS Builder + Open Source fields.
- **Closes gaps:** 9 part 2 (token checked every call), 11 part 2 (warm Lambda for the demo), 12 (privacy basics — not legal advice).
- **Done when:** submitted by Fri 12:00 PM ET with the repo public and the video under 3 minutes.

## Should slices: only if S0–S8 are green by Thursday noon

In this order — each one is visible in the video and strengthens the "provably safe" pitch.

### S9 · Real screens with MCP Apps — 3 h

- **Builds:** S6's HTML views become `ui://` resources (`@modelcontextprotocol/ext-apps` 2.0.3), linked from tool results via `_meta.ui.resourceUri` as Amazon's docs describe; the web client renders them in a sandboxed frame; buttons call `approve_request` through the host.
- **Done when:** the approval card appears from a `show_on_screen` result and its Approve button works.

### S10 · Rule proofs in CI — 3 h

- **Builds:** GitHub Actions job running Cedar Analysis (`cedar-lean-cli analyze compare`, from the cedar-spec repo) on every rule change: new set vs old set → equivalent / more permissive / less permissive; plus fixed properties ("no child may unlock", "no guest may purchase").
- **Done when:** a pull request that lets a child unlock fails CI with a counterexample.

* **Also builds:** a **plain-language preview** on every rule card before saving, generated from the same analysis: "This lets Maya spend $10 more per week" or "This change lets a child unlock the front door — are you sure?"

- **Also builds (moved from S1):** quiet hours ("no purchases after 9 PM") as a rule template, evaluated in the household's time zone.

### S11 · Self-healing demo — 4 h

- **Builds:** EventBridge rule every 5 minutes; health check = safe read call per connector; diagnose: expired login vs changed API; repair: Bedrock rewrites the field mapping from the mock service's API spec; contract tests in a sandbox; versions in S3; promote or roll back; **first money action after a repair needs one approval**.
- **Done when:** renaming `price` to `fare_cents` in the mock service breaks the check, the repair passes tests, and the next ride asks for approval.

### S12 · Real sign-in and phone approvals — 6 h

- **Builds:** Amazon Cognito as our OAuth 2.1 server: authorization code + PKCE S256, refresh tokens, `client_credentials` for service-level calls, no dynamic client registration, all Alexa redirect URIs registered; replace S8's demo token; adult approvals sent by SMS or web push (SNS) instead of the web panel.
- **Done when:** the web client signs in through Cognito and an approval reaches a real phone.

* **Also builds:** approvals signed with a **passkey** that requires Face ID or a fingerprint (WebAuthn `userVerification: "required"`, checked on the server via the UV flag), so a teen holding Mom's unlocked phone still can't approve.

## S19 · Private things stay private

- **Builds:** order history, delivery status and the cart as `request_action` actions (`order_history`, `order_status`, `cart`) decided by Cedar; adults only by default; a `forbid` on `order_gift` for everyone but adults, in both rule sets; the reply "That's private. Ask a grown-up."; a rule card (`private_orders`) so an adult can open orders to teens or children (gifts stay private); Mom's gift for Leo seeded in the demo house; 4 more replay cases (34).
- **Why:** the Tom's Guide birthday story, cited in docs/SPEC.md.
- **Done when:** Leo's ask gets the private reply with no item names in the response or the timeline; Mom hears the list; a guest is denied; replay shows 34 of 34.

## After-Friday slices (S13–S18)

Every "later" item from the Build spec lands in one of these.

### S13 · Connect any app, per person — 4–6 h

- **Builds:** Composio (`@composio/core` 0.25.0) with `userID = household:person`; `find_capability` searches connected and available toolkits; `connect_service` returns Composio's hosted Connect Link, shown as a QR code (S9 screen); the `connected_account.expired` webhook marks the connector broken and re-asks; each new service enters the rules as "needs approval" until an adult allows it.
- **Decision recorded:** Zapier MCP is not used — its connections run as the account owner, with no per-person sign-in.
- **Done when:** a teen connects a music app; her token is separate from Mom's.

### S14 · Real smart home — 3–4 h

- **Builds:** connector to Home Assistant's built-in MCP server (`/api/mcp`, since 2025.2): OAuth with PKCE, only entities exposed to it, reachable over HTTPS (Nabu Casa or a tunnel); replaces the simulated home behind the same tools.
- **Done when:** a real (or Home Assistant demo) light changes, with the same rules applied.

### S15 · Long jobs + "build my website" — 8 h

- **Builds:** job framework from S3 generalised (progress %, spoken "done" notice); worker acts as an MCP client to the **Wix MCP** server (create, update, publish a site; sign-in with a Wix account or API key + account ID); preview link + QR on screen; MCP experimental **tasks** added alongside our own `job_id`, since Alexa support isn't documented.
- **Done when:** "Build a one-page site for my bakery" returns a published preview within the job.

* **Trip budgets (not this week):** a trip such as "Bahamas in March" becomes one job with one reserved total, one approval, and the best-value rule from S4 applied to each booking. Flights would come from **Duffel** (self-serve sign-up; $3 per confirmed order plus 1% of order value for its managed content), since Amadeus closed its free self-service APIs on July 17, 2026. Hotels: Alexa+ is adding Expedia lodging directly in 2026, so check that add-on before building our own.

### S16 · The AgentCore path — 14–20 h

- **Builds:** AgentCore Gateway in front of the connectors; **AgentCore Policy** with the same Cedar files (tool arguments as `context.input.<field>`), log-only first, then enforce; a request interceptor Lambda injects the week's spend; **AgentCore Identity** token vault as the AWS-native alternative to Composio (client-credentials, 3-legged consent, token exchange).
- **Watch:** the gateway adds a network hop inside the 500 ms budget — measure before switching.
- **Done when:** the same 30 replay cases give the same answers through the gateway.

### S17 · Fire TV screen — 12+ h

- **Builds:** Vega SDK 0.24 app (React Native) from `react-native-multi-tv-app-sample`: approvals, recent orders, audit timeline, QR codes for linking; reads from our API. Requires macOS (Apple silicon recommended) or Ubuntu 20.04+ x86\_64 with KVM; Node 18+; 20 GB free; **not Windows or WSL**. Opened by "Alexa, open Household Guard"; voice control of its screens beyond media isn't documented.
- **Done when:** an approval appears on the Vega Virtual Device and can be accepted with the remote.

### S18 · Certification and compliance — ongoing

- **Builds:** add-on submitted with `alexa-ai submit`; meets Amazon's principles (no hidden costs, say what data is used and why, finish tasks inside Alexa, work on screen and screenless devices, clear failure paths); ask Amazon whether a hub fronting other services is allowed; full COPPA program (parental notice and consent methods, written retention policy, written security program, vendor assurances) with a lawyer's review; use Alexa's speaker identity if Amazon exposes it to add-ons.
- **Done when:** certified, or Amazon's answer on hubs is in hand.

## Coverage check: nothing left out

Every item in the Build spec, mapped to the slice that builds it. **84 rows, 0 unassigned.** Where an item is built in two steps, both slices are listed.

### The 10 tools

| Tool | Slice |
| --- | --- |
| `household_status` | S0 (stub) → S6 (real) |
| `request_action` | S1 |
| `confirm_identity` | S2 |
| `job_status` | S3 |
| `approve_request` | S4 |
| `audit_log` | S6 |
| `show_on_screen` | S6 (HTML) → S9 (MCP Apps) |
| `set_rule` | S7 |
| `find_capability` | S13 |
| `connect_service` | S13 |

### Layer features

| Layer | Feature | Slice |
| --- | --- | --- |
| 1 Identity | Roles: adult, teen, child, guest | S1 |
| 1 Identity | PIN by elicitation, 3 fails → 10-min lock | S2 |
| 1 Identity | Adult phone for approvals | S4 (web panel) → S12 (real SMS/push) |
| 1 Identity | Voice ID slot | S18 |
| 2 Rules | Allow, deny, needs approval, service allowlist, device class | S1 |
| 2 Rules | Spend cap per request and per week | S3 |
| 2 Rules | Deterministic decision + stated reason | S1 |
| 2 Rules | Unknown service → needs approval | S1 → S13 |
| 3 Risk | Bedrock check, stricter-only | S5 |
| 3 Risk | Prompt-injection defense | S5 |
| 4 Hub | Simulated smart home | S1 |
| 4 Hub | Mock ride service | S3 |
| 4 Hub | Composio breadth | S13 |
| 4 Hub | Home Assistant | S14 |
| 4 Hub | Wix MCP | S15 |
| 5 Healing | Health check every 5 min | S11 |
| 5 Healing | Diagnose login vs API change | S11 |
| 5 Healing | Bedrock repair + contract tests | S11 |
| 5 Healing | Promote / keep old + mark broken | S11 |
| 5 Healing | Versions + one-step rollback | S11 |
| 5 Healing | Approval for first money action after repair | S11 |
| 6 Jobs | Queue, worker, `job_id` | S3 |
| 6 Jobs | Progress + spoken "done" notice | S15 |
| 7 Screens | Approval card, orders, audit timeline | S6 → S9 |
| 7 Screens | Fire TV companion | S17 |
| 8 Audit | Append-only, hash-chained | S6 |
| 8 Audit | Deletion-safe checkpoints + 90-day expiry | S6 + S8 |

### Added: identity, editable rules, usability

| Feature | Slice |
| --- | --- |
| Own-phone confirmation per person, with number matching | S2 |
| Push limit: 3 per 10 min, then lock + tell an adult | S2 |
| Tiered confirmation (low / medium / high risk) | S2 |
| Approvals signed with a passkey (Face ID / fingerprint) | S12 |
| Every rule editable by adults as plain-language cards + undo | S7 |
| Plain-language preview of a rule change | S10 |
| Plain-language audit sentences, filters, voice summary | S6 |

| Feature | Slice |
| --- | --- |
| Best-value alternative: lowest total incl. fees within the rules | S4 |
| Savings tracked and reported weekly | S4 + S6 |
| Quiet hours (time windows) | S10 |

### AWS services

| Service | Slice |
| --- | --- |
| Lambda + Function URL, CloudWatch logs | S0 |
| DynamoDB | S1 |
| SQS | S3 |
| Bedrock | S5, S11 |
| EventBridge, S3 | S11 |
| Cognito, SNS | S12 (S8 uses a demo token) |
| AgentCore Gateway, Policy, Identity | S16 |

### The 13 gaps

| # | Gap | Slice |
| --- | --- | --- |
| 1 | Model fills in tool arguments | S2 |
| 2 | Spoken PIN overheard | S2 + S4 |
| 3 | Bedrock too slow for reply | S5 |
| 4 | Two requests beat the cap | S3 |
| 5 | Approval then price change | S4 |
| 6 | Alexa retries a call | S3 |
| 7 | Fail open by accident | S1, checked in every slice |
| 8 | Prompt injection from tool results | S5 |
| 9 | Public endpoint + auth | S0 + S8 → S12 |
| 10 | Protocol version mismatch | S0 |
| 11 | Cold starts | S0 + S8 |
| 12 | Children's data (COPPA) | S6 + S8 → S18 |
| 13 | Time zones | S1 |

### The "later" items

| Item | Slice |
| --- | --- |
| Per-person sign-in (Composio) | S13 |
| AgentCore Identity alternative | S16 |
| Zapier MCP decision (not used) | S13 |
| Real smart home | S14 |
| "Build my website" | S15 |
| Approval and audit screens (MCP Apps) | S9 |
| Fire TV screen | S17 |
| OAuth 2.1 server (Cognito) | S12 |
| Rules on AgentCore Policy | S16 |
| Rule proofs in CI | S10 |
| Long jobs, MCP tasks | S15 |
| Certification | S18 |

### Hackathon submission

| Requirement | Slice |
| --- | --- |
| Web MCP client demo | S0 |
| 30-case replay test | S1 → S7 |
| README, product feedback, friction log, MIT license | S8 |
| Architecture image, video under 3 min | S8 |
| AWS Builder + Open Source fields | S8 |

## Usability standard: a 5th grader can use it

This is a rule for every slice, not a slice of its own — and it is worth points: design is a quarter of the judging.

| Rule | Example | Checked how |
| --- | --- | --- |
| No tech words on screen or in speech | Never "policy", "Cedar", "token", "MCP"; say "rule", "limit", "ask Mom" | Word list check in CI |
| Short sentences | Under 12 words; reading level grade 5 or below | Readability score check on every user-facing string, in CI |
| One question per screen | Approval card: who, what, price, why held — then **Yes** / **No** | Screen review |
| Show the real thing | Picture or icon of the item, the price, the person's name | Screen review |
| Always say why | "Held: over Maya's $20 a week" | Every decision has a reason (S1) |
| Voice first | "What did the kids buy this week?" gets totals in 2–3 sentences | Replay cases |
| Mistakes are cheap | Undo any rule change for 24 hours (S7) | Test |

**Hallway test before you record the video:** two people who have never seen the app. Each must (1) approve a held request and (2) find last week's purchases, in under 30 seconds each, without help. If either fails, fix the screen, not the person.

## Cross-cutting: repo, tests, infrastructure

### Repo layout

```
household-guard/
  infra/                 CDK stack (Lambda, Function URL, DynamoDB, SQS, later EventBridge/S3/Cognito/SNS)
  src/mcp/               server, tool definitions, version negotiation, Origin + token checks
  src/identity/          sessions, PIN hashing (scrypt), lockout
  src/policy/            schema.cedarschema, auto.cedar, approvable.cedar, evaluator
  src/spend/             reservation transaction, idempotency
  src/approvals/         request hash, expiry, approve flow
  src/worker/            SQS handler, Bedrock risk check, commit/release
  src/connectors/        sim-home, mock-ride, (later) composio, home-assistant, wix
  src/audit/             hash chain, checkpoints, verify script
  web-client/            MCP client page + parent-phone panel + screens
  tests/policy/          Cedar unit tests per rule
  tests/replay/          30 scripted requests with expected answers
  tests/contract/        one per connector (also used by self-healing)
  LICENSE (MIT), README.md, FEEDBACK.md, FRICTION_LOG.md
```

### Tests that run on every change

| Test | Proves | From slice |
| --- | --- | --- |
| Cedar unit tests | Each rule says what it should | S1 |
| Replay (30 cases) | Every role × action gives the expected answer | S1 → S7 |
| Fail-closed test | Forced DynamoDB / Bedrock errors give hold or deny | S1, S5 |
| Concurrency test | Two simultaneous buys can't beat a cap | S3 |
| Duplicate test | A retried call books once | S3 |
| Surge test | Approval doesn't survive a price change | S4 |
| Injection test | Hostile service replies change nothing | S5 |
| Audit verify | An edited log row is caught | S6 |
| Cedar Analysis | New rules are no more permissive than intended | S10 |
| Contract tests | Each connector still matches its service | S11 |

### Infrastructure notes

- One region for everything: **us-east-1** (Bedrock, AgentCore Policy and all other services listed are available there).
- One DynamoDB table with key prefixes (`PERSON#`, `RULES#`, `SPEND#`, `APPROVAL#`, `SESSION#`, `AUDIT#`) is fastest to set up; TTL on sessions, approvals and audit entries.
- AWS credits for the hackathon have run out, so keep provisioned concurrency off except while recording, and tear down after Nov 20 (end of judging).
