# Part A audit: S8, S9, S10, S11, S12 (auditor a3, 2026-10-21)

Specs: `tests/audit/s8.spec.ts` ... `s12.spec.ts` (+ `tests/audit/common.ts`). Real Chromium, web client, fresh `?hh=` house per test.
Command pattern (per slice N, target T in local|prod):
`AUDIT_TARGET=T AUDIT_GROUP=a3sN npx playwright test -c playwright.audit.config.ts tests/audit/sN.spec.ts`
Logs: `audit/2026-10-21/partA-sN-T.log` (final run). Video/trace/png per test: `audit/2026-10-21/pw-T/a3sN/<test-folder>/{video.webm,trace.zip,test-*.png}`. Named screenshots: `audit/2026-10-21/s8-*.png s9-*.png s10-*.png s11-*.png s12-*.png`. JSON: `results-T-a3sN.json`.
"prod" = URL in .env.deploy. "roadmap" = other deployed stage (used inside S12 only). Roadmap test-user login credentials were read in-process, never printed.

## Result table

| Slice | local | prod | Notes |
|---|---|---|---|
| S8 token on every call | PASS | PASS | 401 for no/empty/garbage/tampered key on /mcp and tools/call; 401 on all 4 phone routes with no/junk key, 401/403 with a voice key; bad Origin 403; demo buttons refused without key |
| S8 /privacy, /.well-known | PASS | PASS | privacy text, household-guard.json, oauth-protected-resource all 200 |
| S8 README/FEEDBACK/FRICTION_LOG/LICENSE | PASS | PASS (same repo files) | exist, non-empty, MIT, friction log has severity |
| S8 UX: zero console errors on plain load | FAIL | FAIL | see F1 |
| S9 approval from MCP Apps screen books ride | PASS | PASS | teen sees no Yes; Mom with no tap sees no Yes; after Mom's own tap, Yes in sandboxed frame books $38; timeline says "Ride booked for Maya: $38" |
| S10 `npm run prove` exit 0 on shipped rules | PASS | n/a (repo-local) | `audit/2026-10-21/s10-prove-shipped.log` |
| S10 prove fails with counterexample (child unlock) | PASS | n/a | `s10-prove-child-unlock-fail.log` exit 1, counterexample names Role::"child", action unlock. Also fails for open-unlock mutation and guest-buy mutation. Control: a stray `permit` alone still passes (Cedar forbid beats permit, correct) |
| S10 quiet hours in house time zone | PASS | PASS | see "S10 clock" below |
| S10 9:30 PM exact | MANUAL | MANUAL | browser cannot move the server clock |
| S11 break -> check -> repair -> next ride needs one yes | PASS | PARTIAL (F2) | local: full flow in 12 s. prod: "Check now" button did NOT repair; flow passed only because the scheduled heal fixed it later (test took 1.7 min) |
| S11 ride between break and check not booked | PASS | PASS | "That service is not working. An adult was told." |
| S11 teen cannot break | FAIL (UX) | FAIL (UX) | F3 |
| S11 healthy check changes nothing | PASS | PASS | |
| S12 demo sign-in works | PASS | PASS | body data-token-kind=demo |
| S12 forged tokens (alg none, HS256, junk RS256) | PASS | PASS | 401 |
| S12 hosted sign-in page loads, PKCE S256 + code flow | MANUAL (no sign-in server: /config.json sign_in=null, panel hidden, asserted) | PASS | prod hosted UI `hg-prod-...amazoncognito.com/login`, response_type=code, code_challenge_method=S256, no client secret |
| S12 real Cognito login in browser | MANUAL | PASS (roadmap stage) | wrong password refused with visible message; right password returns to page, "Signed in with your family account", tools list works with family-account token |
| S12 demo flag off on roadmap | PASS | PASS | /demo-token 404, /mcp 401 |
| S12 prod demo-token reserved houses | n/a | PASS | `hh=service`/`gateway` answer 200 but the key is for house "demo" |
| S12 email/push approval path | STAND-IN / MANUAL | STAND-IN / MANUAL | no verified SES sender and no adult address configured; real email cannot be observed. Shown only: held ride sends nothing, `/approve` with no/junk key says "This link does not work." |

### S10 clock
Server clock cannot be set from a browser (now 4 PM New York, 8 PM UTC). Method: Mom sets quiet hours for a window around the current New York hour (4 PM to 6 PM) by calling `set_rule` with the page's own key and tapping her phone number; Maya's $15 ride -> "Quiet hours: no buying from 4 PM to 6 PM." (outcome denied); Mom (adult) is exempt and gets the normal phone check, then books. A window that matches only the UTC hour does NOT block (server reads the house zone, New York, not UTC), on prod, where the server clock is UTC. The UI button "No buying after 9 PM" was also driven: preview "Kids cannot buy from 9 PM to 6 AM." before the tap, card shows it after; a teen's click gets "Ask an adult to change rules." Existing vitest covers 9:30 PM; I did not use it as proof.

## FAILS and findings

**F1 (S8/Part C, local+prod, low) console errors on every page load.** Expected 0, got "Blocked script execution in 'about:blank'/'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set." (2 on load, ~10 during a session). Source: the `sandbox=""` timeline and rules iframes. Spec `S8 UX...zero console errors` kept failing. Evidence: `pw-*/a3s8/s8-S8-UX-*`.

**F2 (S11, prod, HIGH for the recorded demo) "Check now" cannot repair on prod.** `POST /demo/check-rides` returned `{"status":"broken","cause":"api_changed","detail":"missing: price_cents; new: fare_cents; User: arn:aws:sts::679241558430:assumed-role/HouseholdGuard-WebServiceRoleA9172838-.../HouseholdGuard-Web..."}`, page says "The ride service is not working." and never reaches "Fixed". Likely cause: the Web Lambda role has no `bedrock:InvokeModel` (infra/ grants it only to worker and heal lambdas, lines ~132 and ~144); the 5-minute scheduled heal later repaired it, so the button path is what is broken. Expected: "Fixed. The next ride needs a yes." within seconds. Also leaks an AWS role ARN fragment to the client in `detail`. Evidence: `partA-s11-prod.log`, `pw-prod/a3s11/s11-S11-break-*`. Local passes.

**F3 (S11 UX, both) teen click on "Break it (demo)" says "The ride service shipped a new version."** though the server refused (403 adults only) and nothing changed. The page claims success it did not get. Spec `S11 a teen cannot break...` fails on both.

**F4 (prod, medium) rate limiting shows up as 429 on static pages and silent failures.** During parallel runs prod returned 429 on `/privacy` and `/demo-token` returned no token; the client then shows an EMPTY red "Alexa says" box (no text) and tests saw `Received ""`. Twice more an intermittent `"Something went wrong. Ask an adult."` and an empty reply appeared under load (S10, S9 prod runs); re-runs passed. Expected: a plain sentence on any failure (the page does `says(r.say)` with undefined). Per-IP limit also means many judges behind one IP share it.

**F5 (UX, minor)** After a phone tap Alexa's line is overwritten by "Done." a moment after "Mom is confirmed." (race with job poll); tests had to tolerate both. "Maya confirmed on their phone" (timeline) uses "their" for a named person. The "Recent buys" screen is a one-time snapshot: opened right after Yes it shows "Nothing yet." until reopened (prod, booking takes longer than the click). `/privacy` uses tech word "scrypt" and the plain note is user-facing. Quiet-hours stop returns outcome `denied` while the audit wording elsewhere says "held" (SLICES says hold); not wrong, but inconsistent.

**F6 (info, prod)** `/demo-token` mints keys including all phone keys (mom, dad, maya) for ANY `?hh=` with no auth, by design while HG_DEMO=1; `/demo/outbox` is also unauthenticated on prod (empty because prod has no local outbox). Must be switched off after judging (already in the README plan).

## MANUAL list
- S10: 9:30 PM wall-clock quiet-hours purchase (server clock fixed to real time).
- S12: local has no sign-in server; email approval send (needs verified SES sender + HG_APPROVER_EMAILS); passkeys not built; Alexa redirect URIs (need vendor id).
