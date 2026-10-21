Measured 2026-10-21T02:48Z from a WSL2 machine over the internet, 100 calls per path, warmed first, paths alternating. Both answer a low-risk lights request.

| Path | Calls | Errors | p50 | p95 | Slowest | 500 ms limit (p95) |
|---|---|---|---|---|---|---|
| direct (Function URL → /mcp) | 100 | 0 | 165 ms | 252 ms | 343 ms | within 500 ms |
| through the AgentCore Gateway | 100 | 0 | 351 ms | 549 ms | 798 ms | OVER 500 ms |
