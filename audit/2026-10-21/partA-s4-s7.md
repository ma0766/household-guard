# Part A audit: S4, S5, S6, S7 (auditor a2)

Specs: `tests/audit/s4.spec.ts`, `s5.spec.ts`, `s6.spec.ts`, `s7.spec.ts` (helpers in `tests/audit/lib.ts`). Chromium, real web client, fresh `?hh=` house per test.
Local = server on :8016 (MOCK risk check). Prod = deployed URL (live Bedrock). Evidence roots: `audit/2026-10-21/pw-local/a2/<test>/{video.webm,trace.zip,*.png}` and `audit/2026-10-21/pw-prod/a2s4|a2s5|a2s6|a2s7/<test>/...`; named screenshots `audit/2026-10-21/s{4a,4b,4c,5a,5b}-{local,prod}.png`, `s6-*-{local,prod}.png`, `s7-*-{local,prod}.png`; text dumps `s6-timeline-*.txt`, `s6-summary-*.txt`, `s7-rules-*.txt`.

Commands:
- local: `AUDIT_TARGET=local AUDIT_GROUP=a2 npx playwright test -c playwright.audit.config.ts tests/audit/s4.spec.ts tests/audit/s5.spec.ts tests/audit/s6.spec.ts tests/audit/s7.spec.ts`
- prod: same with `AUDIT_TARGET=prod AUDIT_GROUP=a2s<N>` per file (AWS creds + `.env.deploy` loaded into the env of the process, nothing printed). Run log: `audit/2026-10-21/partA-prod-run.log`.

Test-side doors (no UI exists, so setup only, written in lib.ts): surge and "hostile service reply" flags are set in the DynamoDB `CONN#mock-ride` row (local 8018 / prod table via AWS creds); the audit-row edit is a DynamoDB update on my own throwaway house.

## Results

| Slice | Check | Local | Prod |
|---|---|---|---|
| S4 | a: Maya $38 ride held, $14 shared offered, accepted with her own tap, no adult card, "Saved $24" in timeline | FAIL (console errors only; every functional step passed) | FAIL (same) |
| S4 | b: Mom taps the matching number on the approval card, $38 ride booked | PASS | PASS |
| S4 | c: surge after approval, booking held again at the new price, nothing booked | PASS | PASS |
| S5 | a: gift card allowed by rules, held by risk check ("needs a closer look"), Mom gets card | PASS (mock) | PASS (live Bedrock; see note) |
| S5 | b: hostile ride-service reply: held ride identical, hostile text never shown, nothing booked | PASS (mock) | PASS (live) |
| S6 | plain sentences, person filter, day filter, voice summary | FAIL (summary has 4 sentences; spec says 2-3) | FAIL (same) |
| S6 | verify script catches edited row | PASS (`audit/2026-10-21/s6-verify-cli-local.log`: clean exit 0, edited exit 1 "BROKEN at entry 2: an entry was edited") | PASS (`s6-verify-cli-prod.log`, same result; needs prod audit key in env, see finding 6) |
| S7 | a: limit $20 -> $50 follows on next decision; teen refused; preview before tap | PASS | PASS |
| S7 | b: undo restores $20, next ride held again | PASS | PASS |
| S7 | c: quiet hours card preview + save | PASS | PASS |
| S7 | d: locked safety rules warn before change | MANUAL: web client has no control for the two locked rules; only reachable by calling `set_rule` directly. Vitest covers it. | MANUAL (same) |

Note S5 prod: the UI cannot prove which model answered; the prod build is configured for live Bedrock and the gift card and the hostile-note ride were held with "That needs a closer look." Not independently proven from the browser.

## Findings (FAIL / defects)

1. **Console errors on the page (S4a, local+prod).** 8 x "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed ... 'allow-scripts' permission is not set". The timeline/rules iframes use `sandbox=""` but the served HTML contains script. Part C wants zero console errors. (Other specs filter these and count them as annotation.)
2. **Voice summary is 4 sentences** (S6): "The kids spent $14 this week. That is 1 buy. The last was Maya's, $14. You saved $24." SLICES S6 says two or three. Local+prod. Soft assertion kept failing.
3. **429 Too Many Requests in the browser on prod (S6 run 1, 4 console errors).** The client polls every 1 s (show_on_screen x2 + household_status + phone inboxes) plus job polling: ~180-300 MCP calls/min against a limit of 300/min per house, and demo-token is 20/min per caller. Other auditors shared this IP so partly environmental, but a demo on one IP is near the ceiling. Also caused intermittent prod failures (page never showed phone number buttons) in a combined run.
4. **After a phone tap the line sometimes reads bare "Done." in amber ("held" style) instead of "Maya is confirmed."** (prod, intermittent; helper now accepts both). Inconsistent, and the person's name is lost.
5. **Rule edits eat the push budget.** Each rule change and each undo costs one of 3 pushes per 10 minutes, as the sign-in tap does. sign-in + change + undo hits the limit; a 4th gives "Too many tries. Wait 10 minutes." and locks Mom out of rule changes. By design but a real demo trap.
6. **`npm run audit:verify` without the prod audit key reports "BROKEN at entry 1: an entry was edited" on a clean log** (false alarm from a wrong HMAC key; correct once env is loaded).
7. Spoken held line for the $38 ride never says the price: "Held: over Maya's $20 a week. A shared ride for $14 fits..." ($38 appears only on Mom's card). SLICES S4 wording says "A $38 ride is over Maya's limit".
8. The audit text "Mom confirmed on their phone" uses "their" for a named person.
9. The 6 kinds of entry look fine, lights logged with the light icon (an early read missed it only because of the 1 s refresh lag).

## UX notes
- Teen rule refusal wording: "Ask an adult to change rules." (good, plain). Raise preview: "This lets Maya spend $30 more a week." Quiet preview: "Kids cannot buy from 9 PM to 6 AM." Both shown before the tap.
- Kids see their own limit only after confirming; an unconfirmed page shows an empty rules frame and timeline with no hint text.
- The held line shows the approving number ("An adult can tap 26 to say yes") on the teen's screen by design; any of three options appears on Mom's card.
- Local S7b once took 36 s because `open()` retried after the demo-token rate limit.
