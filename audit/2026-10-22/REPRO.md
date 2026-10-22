# Repro: typing a rule as Mom (e2e/rule-repro.spec.ts, Chromium)
Steps: new house, Mom signs in (own-phone tap), types "Maya can spend 30 dollars a week" in the question box, Send.
Result: Alexa says "Sorry, I didn't get that. Try: turn off the lights, or book a ride." No console error, no network error, rules unchanged (Maya: $20 a week).
Screenshots: repro-1-mom-signed-in.png, repro-2-typed-sentence.png
Root cause: the question box only maps words to request_action (parse() in web-client/main.ts). There is no rule grammar and no path from words to set_rule. The rule screen offers fixed buttons only (Maya's $ box, quiet hours, orders, undo), so any other rule has no way in.

Second no-op: the rule panel itself has no sentence field either (index.html: a number box for Maya, quiet-hours, orders and undo buttons). Moved the repro to tests/audit/rule-repro.spec.ts (run with the audit config; it records, it does not assert).
