# Product feedback for Amazon (Alexa+ add-ons, MCP, Bedrock)

1. **Let a household attach one rulebook that Alexa checks before calling any add-on.** Add-ons run separately; no add-on can apply a family's rules to another add-on. Only Amazon can. AWS already does this for business agents (AgentCore Policy, Cedar). Today our rules cover only actions routed through our add-on.
2. **Pass a speaker/person id and a confidence level to MCP add-ons**, as custom skills already get. Without it we invented a phone-tap + PIN flow. It works, but it is friction every household feels.
3. **Align the protocol version.** The hackathon requires MCP 2025-11-25 while the documented Alexa client sends 2025-03-26 on `initialize`. We negotiate both; please document which wins.
4. **Support `tools/list_changed`.** Tool changes only reach customers after a redeploy, so we froze an 8-tool facade and do all the changing behind it.
5. **Publish a device table for MCP App screens** (Echo Show, Fire TV, phone). The docs say "Alexa-enabled devices" only.
6. **Open a sandbox tier for hackathon entrants.** Add-on tools are preview-only; we could not test on a real Echo. A web client was enough to build, not to learn.
7. **Document a pattern for slow work under the 500 ms rule**, and support MCP tasks (2025-11-25). We return a `job_id` and a `job_status` tool.
8. **Bedrock onboarding.** The Anthropic use-case form blocked `Converse` with a generic `ResourceNotFoundException` ("Model use case details have not been submitted… try again in 15 minutes") even after a first call had worked. A clearer error, and one status page for account/model access, would save hours. Our worker therefore fails closed (holds) until access returns.
9. **Powertools idempotency (Node):** a response containing `undefined` fields fails with an opaque "Failed to update success record" after the action already ran. A clearer error, or `removeUndefinedValues` on by default, would prevent silent "busy" answers.
10. **Lambda Web Adapter:** after a config change, old warm containers keep serving the old code/env for ~30 s. Worth a line in the docs for anyone testing right after deploy.
11. **Account linking for hubs:** the hosted sign-in token has no family group unless the `openid` scope is requested. A one-line note in the linking guide would have saved an hour.
12. **Publish the Alexa redirect URIs** (or let a stack read them) so a first deploy does not need a second pass; today they depend on a vendor id issued at registration.
13. **AgentCore Gateway latency:** measured over 100 calls each, a gateway hop took p95 549 ms against 252 ms direct (from a laptop). For a 500 ms add-on budget, a published latency figure would help teams decide.
14. **Gateway sample code:** the gateway role needs `GetPolicyEngine` and a creation order the docs sample does not show.
15. **Home Assistant MCP server:** locks are hidden until the owner exposes them to assistants; clearer wording on that page would help anyone wiring a door.
