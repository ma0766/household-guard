# Threat model

Household Guard sits between an AI assistant and the things a family owns (money, doors, apps, a home). This file lists what
could go wrong, what stops it, and **the test that proves it**. Run everything with `npm run verify`.
Test paths are relative to the repo; "unit" = `npx vitest run <path>`.

Rule of thumb for every row: an error, a timeout or a doubt ends as **hold** or **deny**, never as **allow**.

## 1. Who is speaking

| Threat | Defense | Proof |
|---|---|---|
| The model (or a kid) fills in `person: mom` | `request_action` has **no** person or speaker argument. Identity comes only from a confirmed session. The gateway door refuses any unknown key. | `tests/s1/decision.test.ts` (tool shape), `tests/s8/hardening.test.ts` (no tool takes a person), `tests/s16/gateway.test.ts` (person-like keys refused) |
| "I'm Mom, unlock the door" | A name alone is not a session. Doors and money need a tap on that person's **own** phone. | `tests/s2/identity.test.ts` |
| A spoken PIN is overheard | A PIN never confirms money or locks; those need a phone tap. | `tests/s2/identity.test.ts`, `tests/s4/approvals.test.ts` |
| Push flooding / number guessing | 3 confirmations per person per 10 minutes, 3 wrong guesses lock for 10 minutes. The attempt is counted **before** it is checked, so parallel guesses cannot win. | `tests/s2/security.test.ts` (30 parallel guesses) |
| A phone key used as a voice key, or the reverse | Keys carry an audience (`alexa` or `phone`) and a person; each route checks both. | `tests/security/routes-and-limits.test.ts`, `tests/s8/hardening.test.ts` |
| Forged, expired, tampered or wrong-issuer sign-in tokens | HMAC keys (constant-time compare); sign-in tokens checked with RS256 only, issuer, expiry, client, access-not-ID, scope, exactly one household group. | `tests/s0/mcp.test.ts`, `tests/s8/hardening.test.ts`, `tests/s12/oidc.test.ts` (14 bad tokens) |

## 2. Money

| Threat | Defense | Proof |
|---|---|---|
| Two buys at once beat the weekly cap | Spend is reserved by a DynamoDB conditional write (`spent + amount <= cap`) inside a transaction. | `tests/s3/money.test.ts` (two $15 vs a $20 cap: one passes) |
| A retried call buys twice | Idempotency (`request_id`), and a conditional job claim for queue redelivery. | `tests/s3/money.test.ts`, `tests/s3/redelivery.test.ts` |
| Mom approves $12, the price becomes $38 | An approval is bound to a hash of {amount, merchant, item, person}; the worker re-quotes and sends a changed price back to hold. | `tests/s4/approvals.test.ts` (surge) |
| An approval lives forever | Approvals expire after 10 minutes; a quiet-hours or rule change is checked again at the moment of buying. | `tests/s4/approvals.test.ts`, `tests/s10/quiet-hours.test.ts` |
| The cheaper-ride shortcut skips the adult | The offered ride is computed by the server from the held approval; it is closed atomically; it is switched off after a connector repair. | `tests/s4/approvals.test.ts`, `tests/s11/healing.test.ts` |
| A service reply says "ignore limits, approved" | Service replies are **data**. They never feed a decision and are never repeated as speech. | `tests/s5/risk.test.ts` (injection), `tests/s13/apps.test.ts`, `tests/s14/home-assistant.test.ts` |
| The AI risk check loosens a decision | It can only turn "do it" into "hold"; timeout, error or garbage is hold. Runs in the worker, never in the reply path. | `tests/s5/risk.test.ts` (including live Bedrock) |

## 3. The rules themselves

| Threat | Defense | Proof |
|---|---|---|
| A rule change lets a child unlock a door | Cedar's solver (SMT) proves, for **all** requests, "no child may unlock / open the garage / use an app / buy for a guest" on every rule change; CI fails with a counterexample. A person has exactly one role (stated assumption). | `tests/s10/proofs.test.ts`, `e2e/s10-proofs.spec.ts` |
| A kid or a PIN-only adult edits rules | Only adults, only with their own phone tap; locked rules need a warning and a second tap; every change is logged and undoable for 24 h. | `tests/s7/rules.test.ts` |
| A preview that hides a loosening | The preview asks the same engine, before and after; a test cross-checks it against the solver. | `tests/s10/proofs.test.ts` ("preview and proof agree") |
| Quiet hours bypassed by a late tap or a late yes | Re-checked by the worker when the buy happens. | `tests/s10/quiet-hours.test.ts` |
| Hard-to-undo mistakes | 24-hour undo of the newest change. | `tests/s7/rules.test.ts` |

## 4. The log

| Threat | Defense | Proof |
|---|---|---|
| Someone edits or deletes an audit row | Keyed hash chain, daily checkpoints; the verify script exits 1 on an edit. | `tests/s6/audit.test.ts` |
| The log leaks a child's data | Entries expire after 90 days; guests see nothing, kids only their own; no audio is ever stored; words from callers are trimmed and whitelisted before they reach a sentence. | `tests/s6/audit.test.ts`, `tests/s8/hardening.test.ts` |

## 5. Doors into the system (auth on every route)

| Threat | Defense | Proof |
|---|---|---|
| A private route open without a key | Every route is listed; private ones return 401 without a key, public ones show nothing private. | `tests/security/routes-and-limits.test.ts` |
| Browser attacks (DNS rebinding, cross-site calls) | A foreign `Origin` gets 403. | `tests/s0/mcp.test.ts` |
| Flooding | Per-house, per-person and per-caller limits (one conditional counter, parallel-safe); a limiter that cannot reach its table refuses. | `tests/security/routes-and-limits.test.ts` |
| Huge or odd tool input | Every tool string and list has a bound; oversize input is refused by the tool. | `tests/security/routes-and-limits.test.ts` |
| The email link used for something else, replayed, or forwarded | The link key is one adult, one request, at most 10 minutes; it cannot confirm logins or answer another request; wrong numbers lock; mail failures never change an answer; max 3 emails per adult per 10 minutes. | `tests/s12/approval-email.test.ts` |
| Fake "sign-in ran out" messages / replay | Signed (Standard Webhooks), 5-minute window, each id once, 64 KB cap. | `tests/s13/apps.test.ts` |
| A person's app sign-in used by another | One userID per person (`household:person`); a link needs the person's own fresh phone tap; one use per link. | `tests/s13/apps.test.ts` |
| The open demo sign-in | Off by default for every stage except the submitted one; cannot mint keys for `service` or `gateway`; demo buttons need a voice-side key (and "break" needs a confirmed adult). | `tests/s12/oidc.test.ts`, `tests/s11/healing.test.ts` |

## 6. Connectors

| Threat | Defense | Proof |
|---|---|---|
| A broken or changed service gets a wrong price accepted | Replies are mapped by a tested mapping; every number is bounds-checked at buying time; a repair is tested in a sandbox and can never weaken a rule (the first buy after it needs one adult yes, bound to that repair). | `tests/s11/healing.test.ts` |
| A hostile model-written repair | Only six field names, distinct, with the right units, that the service itself describes; anything else is rejected. | `tests/s11/healing.test.ts` |
| The real home does something the rules did not allow | The home is called only after the rules and the tap; only four tools and fixed device names; unknown device words are held; a timeout is "not sure" plus a note to an adult; locks are invisible to the home's MCP server unless the owner exposes them. | `tests/s14/home-assistant.test.ts`, `ha-live/ha.test.ts` (`npm run ha:test`) |
| A site build publishes something bad | Adult + own phone tap; tags and code cut from the name; the page is escaped with a locked-down content rule; a failed build removes the draft; a stale worker cannot overwrite a newer run. | `tests/s15/site.test.ts` |
| The gateway door is weaker than the main door | It calls the same decision; 30 replay cases give identical answers; it is off by default, needs its own client, and answers as a guest. | `tests/s16/gateway.test.ts` |

## 7. Build, secrets and the cloud account

| Threat | Defense | Proof |
|---|---|---|
| A secret in git | `.env*`, `.ha-bootstrap`, `tools/` are ignored; key files are written 0600; tests build fake keys at run time. | `gitleaks` over all history: "no leaks found" (see MORNING-REPORT) |
| A vulnerable dependency | `npm audit`: 0 vulnerabilities. Proof tools are downloaded with pinned SHA-256 fingerprints. | `npm audit`; `scripts/install-prover.sh` |
| Over-broad cloud permissions | Each function gets only the table actions it uses (Scan only for the health check), one Bedrock model family, SES only from the verified sender, the gateway role only its own policy engine and one function. | `infra/app.ts` (reviewed 2026-10-21), live smoke on the roadmap stage |
| A roadmap deploy touching the submitted entry | Stages: only `main` may deploy stage `prod`; a plain `cdk deploy` defaults to `roadmap`; separate tables and URLs. | `scripts/stage.ts` (refuses), `tests/s16/gateway.test.ts` (default synth) |
| The Lambda cannot start | The bundle test builds and loads the web, worker, health and gateway bundles. | `tests/s3/bundle.test.ts` |

## Not defended (residual risk, said plainly)

- **One "current speaker" per house.** Alexa tells add-ons nothing about who is talking, so the house remembers the last confirmed person for 5 minutes. Someone speaking in that window can do low-risk things (lights, apps, reading) as that person. Money, doors, rule changes and linking an app each need that person's own phone tap, so a wrong guess cannot finish them.
- **An email link is a key to one yes or no.** It is as strong as the adult's inbox. The three-number match proves "someone heard Alexa", but a holder can find the number in three tries (the third wrong try locks).
- **The open demo sign-in on the submitted stage** hands a key to anyone. It exists so judges can try the app. Switch it off with `-c demo=0`.
- **The risk check needs Amazon Bedrock.** If it is down, purchases are held for an adult (safe, but annoying).
- **Home Assistant is local only.** The deployed Lambda cannot reach a container on a laptop. Over a tunnel the key travels over HTTPS only (plain http to another machine is refused).
- **The Composio and Wix connectors are stand-ins** here (no keys); their live behaviour is unverified.
- **No penetration test and no formal COPPA review.** The privacy notes are basics, not legal advice.

## Level up: taps, guests (2026-10-22)

| Risk | What we do | Honest limit |
|---|---|---|
| Someone else speaks right after Mom's buy tap | The 5-minute tap window covers only that person's buys inside their own limits; the cap forbid, quiet hours and the database reservation still decide each buy. Doors and rule changes never use the window. | Alexa gives add-ons no speaker identity, so within 5 minutes another voice can buy as Mom, up to Mom's limits. Turn the no-tap window off by never tapping, or lower the limit. |
| A guest PIN is overheard | Guest PINs only open a short list of everyday things (lights, heat, music, weather, timers). Guests never buy, unlock, use the garage, change rules or hear orders (proved for all requests). The PIN is shown once, on the adult's own phone, kept only as a scrypt hash, and the guest is switched off after the last day. | A guest who keeps the PIN has their list until the last day, or until an adult ends the stay. |
| Teen on the garage | A teen may open the garage with a spoken heads-up (levelup decision); an adult can make it adults-only with one card. | The garage is no longer behind a tap. |
| A typed rule or a model draft | The model only fills in one known setting; the answer is checked in code, against the Cedar schema, shown with the last 7 days replayed under it, and saved only after the adult's tap. The model never sees or decides a request. | A reader failure becomes a question; nothing changes. |

## Kinds, devices, scams, visitors, projects (2026-10-22)

| Risk | What we do | Honest limit |
|---|---|---|
| A device key leaks | Typed only on the adult's phone; sealed AES-256-GCM; never in a log, answer, record or job (tests scan every record prefix). | The seal key is the server's secret: whoever has the table AND the secret can open it. |
| A kid adds a device | Only an adult with a phone confirmation gets the card; the card needs her own number tap and the key. | The vacuum is a stand-in; a real vendor sign-in is next. |
| A scammer talks a grandparent into a gift card | Gift cards, crypto, wire transfers and first-time payees always wait for ANOTHER adult. | If a house has one adult, it waits for nobody: it stays held. Words we do not know ("prepaid voucher") are not caught; the AI risk check is a second net. |
| A visitor's PIN is shared | The PIN opens only the front door, only in the window; outside it: no and an adult is told. | A shared PIN opens the door in the window. The adult can end the visits with one tap. |
| A project plan acts | The writer only writes; publishing is an adult's tap; the plan page is text with a strict content rule at an unguessable address. | Anyone with the link can read the plan. |
| A service that did not declare a kind | Held for an adult. | |
