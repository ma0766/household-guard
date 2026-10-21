> Build order, hours and scope: follow docs/SLICES.md. Where this file disagrees with it (for example the older "Friday scope" table), SLICES.md wins.

# Build spec: Household Guard

As of Oct 20, 2026

## Your ideas, condensed and checked

**Yes, other entrants may land on a similar idea** — the household-permissions idea came from your Hackathon Radar, and anyone asking an AI for an Alexa+ entry can get something close. The project gallery isn't public, so I can't check. What separates you is depth: the hard limits in the next section, solved well, plus a demo that proves it.

| # | Your idea | Already exists? | What that means for us |
| --- | --- | --- | --- |
| 1 | Per-person rules for purchases and home control | **Partly** — Alexa has voice purchase codes and Amazon Kids; Skyfire and Runlayer do spend/tool policy for businesses | Our angle: one rulebook across every service the agent calls, not only Amazon purchases |
| 2 | "Claude Code for Alexa" — Alexa can do anything a developer can ("build my business a website") | **The pieces exist** — OpenClaw already talks to Echo through a skill and webhooks (Mar 2026); the Wix MCP server can create, update and publish sites | Not new on its own. Worth doing only as a long-running job with a screen to review results |
| 3 | Alexa controls Fire TV and shows things on screen ("show my orders on the TV") | **Partly** — Alexa+ is free on Fire TV (Jan 2026): scene search, smart home control, Ring feed on TV. Apps can let Alexa launch, play, search, change channel and navigate | Our own Fire TV app can show anything we want; whether a third-party MCP add-on can draw on the TV is **not confirmed** in the docs |
| 4 | Self-healing MCP endpoint that fixes a broken connection and retries | **Yes** — SelfHeal (Product Hunt, \~3 months ago) rewrites broken connector code, tests it live, redeploys in \~16 s, with rollback | Not a moat by itself. Our version must heal **behind a fixed set of Alexa tools** (see limits) |
| 5 | Auto-connect to any app by reading its developer docs | **Yes** — Zapier MCP covers 9,000+ apps; Composio 1,000+ with per-user sign-in; Stainless, Speakeasy, Gram and AWS Labs generate MCP servers from API specs | Use them as the plumbing; don't rebuild a connector catalog in 3 days |
| 6 | Sign in to other apps through Alexa without a phone | **Mostly no** — Alexa+ add-ons link accounts by QR code on screens, a push to the Alexa phone app, or Login with Amazon. Voice-only linking exists only for classic custom skills and still sends a code to the phone | Realistic version: link **once** to our hub, which holds the other connections. The TV shows the QR code |
| 7 | Who builds the MCP connection to Alexa? | **The service owner** builds the MCP server and deploys it as an add-on with Amazon's `alexa-ai` CLI; Amazon's tooling inspects and packages it | So we would be one add-on fronting many services. Whether Amazon certifies such a hub is an **open question** |
| 8 | Clone a company with traction and bring it to Amazon | Copying a business model is legal; copying code, trademarks, designs or patented methods is not. It isn't an antitrust issue. (Not legal advice.) | See the side-by-side section below |

**Verdict on the merge:** ideas 1, 3, 4, 5 and 6 fit together as one product — a household hub where every agent action passes through one set of rules, with the TV as the screen for approvals. Idea 2 ("build me a website") becomes a later feature on the same hub, not the core.

## Hard limits that shape the design

These come from Amazon's Alexa+ add-on docs. Each one is a problem most entrants will ignore — solving them is your technical depth.

| Limit (from the docs) | Why it breaks the naive design | Our design answer |
| --- | --- | --- |
| Round trip must be **under 500 ms** | "Build my website" or "fix this connector" takes minutes | Every slow tool returns a `job_id` in under 500 ms; work runs in the background; the user hears "I'll tell you when it's done" |
| Alexa+ picks up tool changes **only after redeploy** | A self-healing server can't add or rename tools on the fly | A **fixed facade** of \~8 tools that never changes; healing happens behind it |
| No documented **speaker identity** for add-ons (person ID exists only for classic custom skills) | We can't assume Alexa tells us who is speaking | Identity comes from our side: a per-person PIN by voice, or approval on a parent's phone; voice ID used only if Amazon exposes it |
| Tokens are **per Amazon account**, not per person | The whole household shares one link | Our hub stores per-person profiles under that one account |
| Linking happens by **QR code, Alexa app push, or Login with Amazon** | No silent "sign in for me" | Link our hub once; connect other services through it; show QR codes on the TV |
| OAuth 2.1 + PKCE, refresh tokens required; no dynamic client registration | Can't bolt on random auth | Hub runs a proper OAuth 2.1 server (e.g. Amazon Cognito) |
| Alexa+ fills missing details from context, then uses MCP **elicitation** to ask | Good for "which light?" | Use elicitation for confirmations and PINs |
| Tool results can include a UI via `_meta.ui` (**MCP Apps**) | We can show screens, but device support (Echo Show vs Fire TV) isn't documented | Build the approval and audit screens as MCP Apps; also show them in our web client for the demo |
| Real Alexa+ developer tools are **preview-only**; hackathon accepts a web MCP client | We can't test on a real Echo | Web client page sends initialize → tools/list → tools/call over Streamable HTTP |

**Version note:** the hackathon requires MCP spec 2025-11-25, while Amazon's client docs show it sending protocol version 2025-03-26 on initialize. Support version negotiation for both.

## The problem, as you'll pitch it

**One sentence:** Alexa+ can now spend money, book rides and unlock doors through outside services — but it serves a whole household with one account and one set of permissions, so a child, a guest and a parent all have the same power.

**Why judges should care (numbers you can cite):**

- Alexa+ customers complete purchases on devices **3×** more often (Jassy's 2026 shareholder letter).
- Amazon is opening Alexa+ to outside services through MCP — Priceline, Lyft, Fandango, Taskrabbit and others — with checkout through Amazon Wallet.
- Morgan Stanley projects agentic AI shoppers could reach up to **$385B** in US e-commerce spending by 2030 (as cited by Forkast).
- The docs show add-ons get a per-account token, with no documented speaker identity. That gap is real and checkable, not a guess.

**The history that makes this real:** Amazon has paid for this problem before. In 2017 it agreed to refund up to **$70 million** for in-app purchases children made without permission between November 2011 and May 2016, after a federal judge found Amazon liable in 2016. The cause: one parent password unlocked 15 minutes of further purchases. Household Guard's approvals lock to one exact item and price and expire after 10 minutes — the fix for that exact failure. Fewer surprise charges means fewer refunds for Amazon and fewer angry parents.

**It saves the customer money too:** when something is over a limit, the answer isn't just "no" — it's the lowest-priced option we found that fits ("A $14 shared ride fits your limit"), with the savings tracked every week.

**The ask to Amazon (the "Shape" part):** add-ons work separately — Alexa picks one, or asks the customer to choose — so no outside add-on can apply a family's rules to every other add-on. Only Amazon can. Our request: **let a household attach one set of rules that Alexa checks before calling any add-on.** AWS already does exactly this for business agents with AgentCore Policy, in the same Cedar language we use.

**What we're not claiming:** that Amazon can't solve it. The claim is that a neutral rulebook — one that also limits spending outside Amazon — is something Amazon has little reason to build.

## Private things stay private (S19)

**Why:** Tom's Guide reported that Alexa+ spoiled a child's birthday: a recent-orders question read out the household's order history, birthday gifts included, because Alexa does not tell who is asking. Source: [How Alexa+ accidentally ruined my kid's birthday — here's how to stop it from happening to you (Tom's Guide)](https://www.tomsguide.com/ai/alexa-just-spoiled-my-kids-birthday-heres-what-happened). The workarounds in the coverage (turn off delivery announcements, archive orders) are settings one person flips for the whole house; they do not depend on who is speaking.

**Our answer:** order history, delivery status and the cart are actions in `request_action`, decided by the same Cedar rules as everything else. Only adults hear them by default. A gift is never read aloud or shown to a child, a teen or a guest: that is a `forbid` in both rule sets that no rule card can remove, and `npm run prove` proves it for all requests. A child who asks hears "That's private. Ask a grown-up." The audit timeline says who asked, never what was ordered. An adult can open orders to teens or children with a rule card ("Let teens hear orders"); gifts stay private even then.

## Architecture

&#91;embedded content: Household Guard architecture · 8 layers\]

Alexa+ only ever sees the fixed facade. The rules engine sits between every request and every service; the AI risk check can push it stricter but never looser. Self-healing and long jobs live behind the facade, so nothing they change requires a redeploy to Alexa.

## Rules engine: the tech choice

**Use Cedar, not OPA.** "Openappa" is most likely **OPA (Open Policy Agent)** — a strong open-source rules engine, but **Cedar** fits this project better: it is Amazon's own open-source policy language, it is what AWS uses to police agent tool calls in AgentCore, and its rules can be **mathematically checked**, not just tested.

|  | Cedar | OPA (Rego) | AgentCore Policy (Cedar, managed) |
| --- | --- | --- | --- |
| What it is | Open-source policy language from AWS (Apache 2.0) | CNCF open-source policy engine; its core developers joined Apple in Aug 2025, project stays under CNCF | AWS-hosted Cedar engine attached to an AgentCore Gateway; GA March 2026 |
| Default | Deny unless a rule permits; a `forbid` always beats a `permit` | Whatever you write | Deny by default |
| Can you **prove** a rule never breaks? | **Yes** — Cedar Analysis (June 2025) uses SMT solvers, with a compiler proven correct in Lean | No equivalent built in; you test | Same Cedar language, so yes |
| Speed | \~0.3 ms per decision in my test (`@cedar-policy/cedar-wasm` 4.14.0, Node) | Fast too | AWS quotes "<1 ms" for evaluation, plus a gateway hop |
| Runs inside our Lambda | Yes | Yes (`@open-policy-agent/opa-wasm`, last updated Nov 2024) | No — a separate gateway in front of our tools |
| Fit for AWS Builder prize | Strong | Weak | Strongest, but more setup |

**Decision:** run Cedar **inside** our MCP server now (fastest, no extra hop, fits the 500 ms budget). Because AgentCore Policy speaks the same Cedar, the same rule files can move there later.

### How "rules can never be broken" is actually guaranteed

No single tool guarantees it. Five layers do, together:

1. **Default deny.** If no rule says yes, the answer is no. An unknown action (I tested `delete_account`) is denied with no rule written for it.
2. **Forbid beats permit.** "Only adults unlock doors" is a `forbid`; no later `permit` can override it, even one written by mistake.
3. **Proofs, not just tests.** Before any rule change goes live, Cedar Analysis checks properties such as "no policy ever lets a child unlock a door" across **every possible request**, and compares old and new rule sets (more permissive? less?).
4. **The database is the last guard.** Spend caps can't rely on Cedar alone: two requests at the same moment could both see $10 spent and both pass. So the spend is **reserved with a DynamoDB conditional write** (`spent + amount <= cap`) in a transaction; if it fails, the request is held. AWS's own guidance: transactions with a client request token give accurate, retry-safe counts.
5. **The AI can't touch the decision.** Identity comes from the PIN or session, never from what the model typed into a tool argument. The Bedrock risk check can only change allow → hold.

### Three answers from a yes/no engine

Cedar only says allow or deny. We get three answers by asking twice:

- Ask the **auto** rules: allow → **do it**.
- If denied, ask the **approvable** rules: allow → **hold for an adult**.
- Denied by both → **deny**, with the reason.

**Example rule (tested):**

```
permit(principal in Role::"teen", action == Action::"purchase", resource)
when { context.week_spent_cents + context.amount_cents <= principal.weekly_cap_cents };

forbid(principal, action == Action::"unlock", resource)
unless { principal in Role::"adult" };
```

Test results: teen $38 ride → deny; teen $15 with $0 spent → allow; teen $15 with $10 already spent (cap $20) → deny; teen unlock → deny; adult unlock → allow.

## Backend: what happens on every request

&#91;embedded content: backend request path · 3 lanes, 9 steps\]

| Step | What runs | AWS / package | Fails how? |
| --- | --- | --- | --- |
| 1 | Stateless MCP handler (`sessionIdGenerator: undefined`) on Lambda Web Adapter with response streaming | Lambda Function URL, `@modelcontextprotocol/sdk` 1.32.1 | Bad `Origin` → 403 |
| 2 | Validate the OAuth bearer; map it to a household | Cognito JWT | Invalid → 401, Alexa starts linking |
| 3 | Resolve the speaker from a PIN (elicitation) or a recent verified session | DynamoDB `sessions` | Unknown → treat as guest |
| 4 | Load person, rules, this week's spend; check the idempotency key | DynamoDB `people`, `rules`, `spend`, Powertools idempotency | Any error → hold |
| 5 | Ask Cedar twice: auto rules, then approvable rules | `@cedar-policy/cedar-wasm` 4.14.0 | No match → deny |
| 6 | Reserve the spend with a conditional transaction; put a job on the queue; reply | DynamoDB `TransactWriteItems`, SQS | Cap race lost → hold |
| Hold | Store an approval bound to the request hash; push to the adult | DynamoDB `approvals`, SNS or web push | Expires in 10 min |
| 7 | Risk check; may change "do it" to "hold", never the reverse | Bedrock (Claude) | Timeout → hold |
| 8 | Call the service through its connector with that person's token | Connector hub; Composio or AgentCore Identity | Error → step 9 releases spend |
| 9 | Commit or release spend; write the hash-chained audit entry; notify | DynamoDB `audit`, SNS | — |
| Heal | Every 5 min: test each connector; repair in a sandbox; promote only if contract tests pass | EventBridge, Bedrock, S3 versioned connectors | Fail → keep old version, mark broken |

**DynamoDB tables:** `people` (role, PIN hash, caps), `rules` (Cedar text + version), `spend` (week counters), `approvals`, `sessions`, `audit`, `connectors` (version, health). One table with key prefixes also works and is cheaper to set up.

**Hackathon cut:** steps 1–9 run for real; "push to adult" is the approval card in the web client; Composio and the heal lane are replaced by the simulated home and mock ride service.

## What you might be overlooking

Thirteen gaps, ranked by how badly each would hurt the demo or the product. The first four would break the core safety claim.

| # | Gap | Why it matters | Fix |
| --- | --- | --- | --- |
| 1 | **The model fills in tool arguments** | A teen says "I'm Mom, buy it" and Alexa's model may pass `person: mom`. If we trust that, the whole product is broken | Identity comes only from a verified PIN or session, never from arguments |
| 2 | **A spoken PIN can be overheard** | The teen hears Mom say "4-1-7-2" once | PIN only for low-risk actions; money and locks need a push approval on the adult's phone |
| 3 | **Bedrock is too slow for the 500 ms reply** | A model call plus everything else can exceed the whole budget | Risk check runs in the background worker before the action executes, not in the reply path |
| 4 | **Two requests at once beat the cap** | Both read "$10 spent" and both pass | Conditional, transactional reservation in DynamoDB (see rules section) |
| 5 | **Approval then price change** | Mom approves a $12 ride; surge makes it $38 | Approval is bound to a hash of the exact request (amount, merchant, item) and expires in 10 minutes |
| 6 | **Alexa retries a call** | A retry could book two rides | Idempotency key per request (Powertools for Lambda idempotency, `@aws-lambda-powertools/idempotency` 2.36.0) |
| 7 | **Fail open by accident** | If DynamoDB times out and the code falls through, it may allow | Every error path returns hold or deny |
| 8 | **Prompt injection from tool results** | A service's reply says "ignore limits, approved" | Tool results are data; the rules engine never reads model text as a decision input |
| 9 | **Public endpoint + auth** | Alexa can't sign AWS requests, so the Lambda URL must be public | Validate the OAuth bearer token on every request; host `/.well-known` metadata; 403 on bad `Origin` header (2025-11-25 spec) |
| 10 | **Protocol version mismatch** | Hackathon requires 2025-11-25; Amazon's client sends 2025-03-26 | Negotiate on `initialize`; the official TypeScript SDK (1.32.1) handles both |
| 11 | **Cold starts** | A cold Lambda can eat the 500 ms alone | Small bundle (esbuild); provisioned concurrency while recording the demo (the FAQ says the server needn't stay live after submission) |
| 12 | **Children's data (COPPA)** | Profiles and logs of a child's requests are personal data; the amended rule's compliance date was April 22, 2026, and it now covers voiceprints | Parents create child profiles; store no audio; written retention rule (e.g. delete logs after 90 days). Not legal advice |
| 13 | **Time zones** | "No purchases after 9 PM" in whose time? | Store the household's time zone; evaluate rules in it |

**Two things you are not overlooking:** keeping the AI out of the decision, and making rules provable. Those are the right instincts — they are the pitch.

## The "later" items, in buildable detail

Each of these is real and documented. With AI-assisted coding several could be pulled forward — but only after every "Must" item works.

| Item | What it actually takes (from the docs) | Package / tool | Est. hours with AI help |
| --- | --- | --- | --- |
| **Per-person sign-in to outside apps** | Composio ties every connection to a `userID` we choose (use `household:person`); when a tool needs an unconnected app, its `COMPOSIO_MANAGE_CONNECTIONS` tool returns a hosted Connect Link; tokens refresh automatically; an `expired` webhook tells us to re-ask | `@composio/core` 0.25.0 | 4–6 |
| AWS-native alternative | AgentCore Identity token vault + AgentCore Gateway: OAuth client-credentials, 3-legged user consent, or token exchange to each service | AgentCore CLI / CDK | 8–12 |
| Why **not** Zapier MCP here | Its connections act with the account owner's credentials, with no per-end-user sign-in — wrong for a household with different people | — | — |
| **Real smart home** | Home Assistant's built-in MCP server (since 2025.2) at `/api/mcp`; OAuth with PKCE; only entities you expose; admin account by default; must be reachable over HTTPS from the internet | Home Assistant + Nabu Casa or a tunnel | 3–4 |
| **"Build my website"** | Wix MCP can create, update and publish sites and call site APIs; sign in with a Wix account, or API key + account ID. Our worker acts as an MCP client to Wix as a background job | `@modelcontextprotocol/sdk` client | 6 |
| **Approval and audit screens** | MCP Apps: a `ui://` HTML resource linked from the tool result (`_meta.ui.resourceUri`, per Amazon's docs), shown in a sandboxed frame | `@modelcontextprotocol/ext-apps` 2.0.3 | 3 |
| **Fire TV screen** | Vega SDK 0.24: macOS 10.15+ (Apple silicon recommended) or Ubuntu 20.04+ x86\_64; **no Windows or WSL**; Node 18+; 20 GB free; Virtual Device included (Ubuntu needs KVM). Start from `react-native-multi-tv-app-sample`. Alexa reaches it with "open Household Guard"; voice control of its screens beyond media isn't documented | Vega SDK + Vega Studio | 12+ |
| **Our OAuth 2.1 server for Alexa** | Authorization code + PKCE S256, refresh tokens required, no dynamic client registration, register all Alexa redirect URIs, host the metadata document, privacy policy | Amazon Cognito | 4 |
| **Move rules to AgentCore Policy** | Attach a policy engine to an AgentCore Gateway; tool arguments appear as `context.input.<field>`; start in log-only mode, then enforce; a request interceptor (Lambda) can inject the week's spend | AgentCore Policy | 6–8 |
| **Rule proofs in CI** | Run Cedar Analysis to compare each new rule set with the old one before deploy | `cedar-lean-cli analyze compare` (cedar-spec repo) | 3 |
| **Long jobs, standard way** | MCP 2025-11-25 adds experimental **tasks** (poll, fetch later). Alexa support isn't documented, so keep our own `job_id` + `job_status` and add tasks as a bonus | MCP SDK | 2 |
| **Certification (after the hackathon)** | Amazon's principles: no hidden costs; say what data you need and why; finish tasks inside Alexa; work on screen and screenless devices; clear failure paths. Whether a hub fronting other services is allowed is not stated | Alexa+ certification guidelines | — |

**Fastest wins to pull forward if you're ahead:** MCP Apps screens (3 h) and Cedar proofs in CI (3 h). Both are visible in the demo and both strengthen the "provably safe" story.

## Features, layer by layer

### The fixed tool facade (what Alexa+ sees)

Ten tools that never change, so self-healing and new connectors never need a redeploy.

| Tool | What it does | Returns in <500 ms |
| --- | --- | --- |
| `request_action` | Any action on any connected service ("turn off the lights", "book a ride"), checked against the rules first | Decision: allowed / denied / needs approval, + `job_id` |
| `confirm_identity` | Asks for the speaker's PIN through MCP elicitation | Matched profile or failure |
| `approve_request` | An adult approves or rejects a held request | Updated decision |
| `find_capability` | "Can you control my thermostat?" — searches connected services and the catalog | Matches + whether linking is needed |
| `connect_service` | Starts linking a new service | Link + QR code screen |
| `job_status` | Progress of a long job (site build, connector repair) | Status + percent |
| `show_on_screen` | Approvals, recent orders, audit timeline as an MCP App screen | `_meta.ui` resource |
| `audit_log` | "What did the kids buy this week?" | Summary + entries |
| `set_rule` | An adult changes rules by voice ("Cap Maya at $20 a week") | New rule, PIN required |
| `household_status` | Members, pending approvals, broken connectors | Summary |

### Layer 1 — Identity and profiles

- Household members with roles: adult, teen, child, guest.
- Each person confirms on their own phone by matching a 2-digit number Alexa says; a 4-digit PIN by voice only for people without a phone; 3 failed tries or 3 pushes in 10 minutes → lock for 10 minutes (see Vertical slices, S2).
- A phone number per adult for push approvals.
- Voice ID slot left ready, used only if Amazon exposes speaker identity to add-ons.

### Layer 2 — Rules engine (the core)

- Rule types: allow, deny, spend cap (per request / per week), needs approval, time window (no purchases after 9 PM), service allowlist, device class (locks and garage: adults only).
- **Deterministic:** plain code decides, not the AI model. Same request → same answer, every time.
- Every decision states its reason: "Held: Maya's weekly cap is $20, this ride is $38."
- New, unknown services default to **needs approval**.

### Layer 3 — Risk check (Amazon Bedrock)

- A Claude model on Bedrock reads each request and flags risk: odd amounts, gift cards, unclear targets, instructions hidden inside tool results (prompt injection).
- **Rule:** the model can only make a decision stricter (allow → needs approval), never looser. That one line is your safety argument.

### Layer 4 — Connector hub

- One adapter per service behind `request_action`.
- Friday: smart home (Home Assistant's MCP server, or a simulated home), a mock ride/food service with prices, and Wix MCP for "build a website" as a stretch.
- Later: Zapier MCP (9,000+ apps) or Composio for breadth, so you never build a catalog yourself.

### Layer 5 — Self-healing connectors

1. A health check calls each connector every 5 minutes with a safe read-only request.
2. On failure it sorts the cause: expired login → refresh; changed API → re-read the service's API spec or docs.
3. Bedrock writes a new mapping; it runs against **contract tests** in a sandbox.
4. Pass → promote the new version; fail → keep the old one, mark the connector broken, tell an adult.
5. Every version is stored; rollback is one step.
6. **Money actions never run on a freshly healed connector without one human approval.**

### Layer 6 — Long jobs

- Anything over 500 ms becomes a job (queue + worker), with progress and a spoken notice when done.
- Example: "Build a website for my bakery" → job runs Wix MCP calls → preview link and QR shown on the screen.

### Layer 7 — Screens

- MCP App screens: approval card, recent orders, audit timeline, QR for linking.
- Hackathon: shown in the web MCP client. Later: a Fire TV (Vega) companion app as the household's big screen.

### Layer 8 — Audit trail

- Append-only log: who, what, service, amount, rule applied, decision, model risk flag.
- Each entry carries a hash of the previous one, so tampering shows.

### AWS services (qualifies for the AWS Builder mini challenge)

| Need | AWS service |
| --- | --- |
| Host the MCP server | Lambda + API Gateway (Streamable HTTP) |
| OAuth 2.1 sign-in | Cognito |
| Profiles, rules, audit log | DynamoDB |
| Risk check, connector repair | Bedrock (Claude) |
| Long jobs | SQS or Step Functions |
| Logs and alarms | CloudWatch |

## Friday scope: what gets built by when

From now (Tue 1 PM) to submission (Fri noon) is about 71 clock hours. Assume \~32 working hours. The full spec above is \~80 hours, so most of it waits.

| Priority | Item | Hours |
| --- | --- | --- |
| **Must** | MCP server on Lambda, Streamable HTTP, both protocol versions | 4 |
| **Must** | Profiles, PIN, rules engine + 30-case replay test | 7 |
| **Must** | 6 facade tools: `request_action`, `confirm_identity`, `approve_request`, `set_rule`, `audit_log`, `show_on_screen` | 5 |
| **Must** | Simulated smart home + mock ride service with prices | 3 |
| **Must** | Bedrock risk check (stricter-only) | 2 |
| **Must** | Web MCP client page with approval and audit screens | 4 |
| **Must** | Hash-chained audit log | 1 |
| **Must** | README, product feedback, friction log | 3 |
| **Must** | 3-minute video | 3 |
|  | **Must total** | **32** |
| Should (only if ahead by Thu noon) | Self-healing demo on the mock ride connector: rename a field → health check fails → repaired → tests pass | 4 |
| Later | "Build my website" via Wix MCP as a long job | 6 |
| Later | Fire TV (Vega) companion app as the household screen | 12+ |
| Later | Zapier / Composio breadth, real Cognito linking, certification | 15+ |

**Go/no-go stays Wed 10 PM:** if `request_action` doesn't work end to end in the web client by then, switch to Kiroween.

**Pressure-test on the self-healing demo:** it's the most impressive 20 seconds in the video, but it's also a known product (SelfHeal). Present it as "healing that can never weaken the rules", not as the invention.

## Should we clone a company instead?

**No change: stay with Household Guard.** It is already a clone of a model with traction — Skyfire's spend rules and Runlayer's per-tool policy — moved from businesses to households and onto Alexa+. Here is the side-by-side against the companies you named:

| Clone | Track it fits | Buildable by Fri? | Problem on Amazon's side | Verdict |
| --- | --- | --- | --- | --- |
| **Skyfire + Runlayer → Household Guard** | Alexa+ | Yes | Shared account, no per-person limits | **Build this** |
| Retell AI (phone voice agents) → a business's agent on Alexa+ | Alexa+ | Yes, but thin | No clear Amazon gap; Retell could add MCP quickly | Weak: looks like a wrapper |
| Home Assistant (merges every brand) | Alexa+ | No — 2M homes, years of work | Already bridges to Alexa | Don't compete; **use** its MCP server as a connector |
| Flock Safety (camera AI for police) | Ring | Not without Ring API approval | Ring cut Flock over surveillance fears | Wrong fit — the backlash is the problem |
| Coram AI (business camera AI) | Ring | Not without Ring API approval | Ring sells its own business analytics | Post-hackathon backup |
| Sensi AI (senior monitoring) | Ring / Alexa+ | No — health data, real devices | Ring lists Elder Care as its own app | Park |
| Plaud (AI recorder) | Bee | No — needs a Bee device | Bee is Amazon's own Plaud competitor | Skip |

## Demo script (2:45)

| Time | On screen | Line |
| --- | --- | --- |
| 0:00–0:20 | Teen's request held; parent's approval card pops up | "Alexa+ just let a 15-year-old book a $38 ride. Here's what happens with Household Guard." |
| 0:20–0:30 | The problem, one slide | One account, one set of permissions, a whole family. The 3× purchase stat. |
| 0:30–0:45 | Leo (8) asks "what did Mom order?" and hears "That's private. Ask a grown-up."; Mom asks and hears the list, gift included; the timeline shows no item names | "Alexa+ read a kid's birthday gifts out loud. Ours keeps them private." (S19) |
| 0:45–1:30 | Web MCP client: initialize → tools/list → tools/call; three speakers (adult, teen, guest) make the same three requests | Allowed / held / denied, each with its reason; the held $38 ride offers a $14 shared ride that fits, and the $24 saving is logged |
| 1:30–1:50 | Gift-card request; Bedrock flags it; rule allowed it, model made it stricter | "The AI can only tighten the rules, never loosen them." |
| 1:50–2:15 | (If built) break the ride connector; health check fails; repaired; tests pass; next ride needs one approval | Self-healing that can't weaken safety |
| 2:15–2:35 | Audit timeline; 30/30 replay test passing | Proof, not promises |
| 2:35–2:45 | Architecture diagram with AWS services | Repo link, MIT license |

## Friction log and feature requests (draft for the submission)

Up to 10% bonus on the judging score. Each entry: what we tried, what we expected, what happened, how bad, our workaround, our suggestion. Fill in the "what happened" column from real attempts while building — these drafts are from the docs.

| # | Area | Expected | Found in docs | Severity | Workaround | Suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Rules across add-ons | A household's rules apply to every add-on Alexa calls | Add-ons work separately; Alexa picks one or asks the customer; no hook for one add-on to check another | **Critical** | Our rules only cover actions routed through our add-on | Let a household attach one policy Alexa checks before any add-on call, like AgentCore Policy at a gateway |
| 2 | Speaker identity | Add-on learns who is speaking (custom skills get a person ID) | No person or speaker info documented for MCP add-ons | **Critical** | Our own phone confirmation + PIN | Pass a per-add-on person ID and confidence level, as custom skills already do |
| 3 | Protocol version | Client and hackathon use the same MCP version | Hackathon requires 2025-11-25; Amazon's client docs show 2025-03-26 on initialize | Important | Negotiate both | Align the client with the required version, or document which one wins |
| 4 | Changing tools | New tools show up without a redeploy | Tool changes reach customers only after `alexa-ai deploy` | Important | Fixed facade of 10 tools | Support `tools/list_changed` notifications |
| 5 | Screens | Clear list of devices that show MCP App screens | Docs say "Alexa-enabled devices" without naming Echo Show or Fire TV | Important | Screens shown in our web client | Publish a device support table |
| 6 | Testing access | Test on a real Echo | Add-on tools are preview-only for select partners | Important | Web MCP client, as the FAQ allows | Open a sandbox tier for hackathon entrants |
| 7 | 500 ms limit | Guidance for slow actions | 500 ms round trip required; no documented pattern for long jobs | Nice-to-have | Our own `job_id` + `job_status` | Support MCP tasks (2025-11-25) and document it |

## Sources

- Alexa+ docs: [MCP Toolkit overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html) · [Quickstart (500 ms rule, alexa-ai CLI)](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html) · [Client lifecycle](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html) · [Authentication](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-authentication) · [Account linking for MCP add-ons](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-account-linking) · [Supported capabilities](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-supported-capabilities.html)
- [Voice-forward account linking](https://developer.amazon.com/docs/alexaplus/account-linking/use-voice-forward-account-linking.html) · [Skill personalization (person ID)](https://developer.amazon.com/en-US/docs/alexa/custom-skills/add-personalization-to-your-skill.html)
- [Voice-enabling Fire TV apps](https://developer.amazon.com/docs/fire-tv/voice-enable-your-app-and-content.html) · [Alexa+ free on Fire TV (About Amazon)](https://www.aboutamazon.com/md/news/devices/alexa-plus-fire-tv-free-ai)
- [OpenClaw on smart speakers (Ampere, Mar 2026)](https://www.ampere.sh/blog/openclaw-on-smart-speaker) · [About the Wix MCP](https://dev.wix.com/docs/api-reference/articles/wix-mcp/about-the-wix-mcp)
- [SelfHeal (Product Hunt)](https://www.producthunt.com/p/selfheal/selfheal) · [MCP server generators (Fast.io)](https://www.fast.io/resources/best-mcp-server-generator-tools.md) · [Zapier MCP research (Jun 2026)](https://rywalker.com/research/zapier-mcp)
- [Hackathon FAQs (preview-only tools; web client is enough)](https://amazonappdev2026.devpost.com/details/faqs) · [Amazon adopts MCP for Alexa+ (Forkast)](https://forkast.news/amazon-adopts-mcp-for-alexa-closing-the-smart-home-agent-commerce-loop/) · [Jassy letter summary](https://www.shopifreaks.com/andy-jassys-annual-shareholder-letter-covers-ai-chips-drones-satellites-grocery-and-a-200b-infrastructure-bet/)

**Rules engine and backend sources:**

- [Policy in AgentCore is GA (AWS, Mar 2026)](https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available/) · [Policy + Lambda interceptors in AgentCore Gateway (AWS blog)](https://aws.amazon.com/blogs/machine-learning/secure-ai-agents-with-policy-and-lambda-interceptors-in-amazon-bedrock-agentcore-gateway/) · [Gateway outbound auth](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-outbound-auth.html)
- [Cedar repo (cedar-wasm, symcc)](https://github.com/cedar-policy/cedar) · [Introducing Cedar Analysis (AWS, Jun 2025)](https://aws.amazon.com/blogs/opensource/introducing-cedar-analysis-open-source-tools-for-verifying-authorization-policies) · [Cedar paper](https://arxiv.org/pdf/2403.04651)
- [Apple acquires OPA developers; CNCF keeps OPA (Aug 2025)](https://www.opensourceforu.com/2025/08/apple-acquires-open-policy-agent-developers-while-cncf-retains-control-of-open-source-project/)
- [DynamoDB resource counters (AWS)](https://aws.amazon.com/blogs/database/implement-resource-counters-with-amazon-dynamodb/) · [Serverless MCP on Lambda](https://agentcat.com/guides/building-serverless-mcp-server/) · [MCP 2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog) · [MCP Apps overview](https://mcpbundles.com/blog/2025/11/24/mcp-apps-interactive-ui-protocol)
- [Composio authentication](https://docs.composio.dev/docs/authentication) · [Home Assistant MCP Server](https://www.home-assistant.io/integrations/mcp_server) · [Vega SDK install](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html) · [Alexa+ certification guidelines](https://developer.amazon.com/docs/alexaplus/add-ons/certification-guidelines.html)
- [FTC final COPPA amendments (Hunton)](https://hunton.com/privacy-and-information-security-law/ftc-publishes-final-coppa-rule-amendments)
- Package versions checked on npm on Oct 20, 2026; Cedar test run locally.
