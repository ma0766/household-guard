# Friction log

Format: what we tried · what we expected · what happened · how bad · workaround · suggestion. Rows 1–7 come from the docs (written before building); rows 8+ are from the real build.

| # | Area | Expected | What happened | Severity | Workaround | Suggestion |
|---|---|---|---|---|---|---|
| 1 | Rules across add-ons | A household's rules apply to every add-on Alexa calls | Add-ons work separately; Alexa picks one; no hook to check another | **Critical** | Rules cover only our add-on | One household policy checked before any add-on call |
| 2 | Speaker identity | Add-on learns who is speaking | No person/speaker info for MCP add-ons | **Critical** | Phone tap with number matching + PIN | Pass a person id + confidence |
| 3 | Protocol version | Client and hackathon use the same MCP version | Hackathon: 2025-11-25; Alexa docs: 2025-03-26 | Important | Negotiate both (tested) | Align or document |
| 4 | Changing tools | New tools appear without redeploy | Only after `alexa-ai deploy` | Important | Fixed 8-tool facade | `tools/list_changed` |
| 5 | Screens | Which devices show MCP Apps | "Alexa-enabled devices" | Important | Screens in our web client | Device support table |
| 6 | Testing access | Test on a real Echo | Tools are preview-only | Important | Web MCP client (FAQ allows) | Sandbox tier |
| 7 | 500 ms limit | Pattern for slow actions | None documented | Nice-to-have | `job_id` + `job_status` | MCP tasks + docs |
| 8 | Bedrock access | Model call works once enabled | `ResourceNotFoundException: Model use case details have not been submitted…` — worked once, then stopped (account verification) | Important | Mock in tests/local; deployed worker fails closed | Clearer error; one access status page |
| 9 | Cedar in Lambda | Bundle it with esbuild | The `nodejs` build reads its `.wasm` from disk at runtime | Minor | Ship the package as a real `node_module` beside the bundle | Document for bundlers |
| 10 | DynamoDB conditions | `spent + :amt <= cap` in a condition | Conditions cannot add | Minor | `ADD spent :amt` with `spent <= cap - amt`, plus a code check for the first write of a week (no row yet) | — |
| 11 | Lambda Web Adapter | Env change takes effect at once | Old warm containers served the old env for ~30 s (some 404s, some 200s) | Minor | Wait / retry | Docs note |
| 12 | Powertools idempotency | Any JSON-like result is stored | `undefined` fields → "Failed to update success record" after the action had already run | Important | JSON round-trip the result | Clearer error |
| 13 | Table names | `hg` is a fine table name | DynamoDB needs 3+ characters | Trivial | `household-guard` | — |
| 14 | Idempotency vs. real use | Same words twice = a retry | Asking again a few seconds later returned the old held answer | Important | A fresh `request_id` per utterance; 5-second window without one | Per-call ids from Alexa |
| 15 | Spoken numbers | Alexa says a 2-digit number for matching | Anyone in the room hears it, so a spoken number alone proves nothing | Important | By voice, the adult must have confirmed on their phone *after* the request; the phone path is the strong one | Passkey + user verification (S12) |
