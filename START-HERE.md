# Start here — Household Guard

About 30 minutes of setup by you, then Claude Code builds S0–S8 on its own.

## 1. Accounts and access (you must do these; Claude can't)

- [ ] **Devpost:** joined the Amazon Developer Hackathon (deadline Fri Oct 23, 12:00 PM PT / 3:00 PM ET).
- [ ] **AWS account** signed in from your terminal: `aws configure sso` (or access keys), then `aws sts get-caller-identity` prints your account.
- [ ] **Bedrock:** in the AWS console, us-east-1 → Amazon Bedrock → confirm an Anthropic Claude model is available to your account (first use of Anthropic models may ask for a short use-case form).
- [ ] **CDK bootstrap once:** `npx aws-cdk bootstrap aws://<ACCOUNT_ID>/us-east-1`
- [ ] **GitHub:** `gh auth login`, then create a **public** repo named `household-guard`.
- [ ] **Nothing from Amazon's Alexa developer program is needed** for Friday — the hackathon FAQ accepts a web MCP client instead of a real Echo.

## 2. Your machine (Windows → work inside WSL2 Ubuntu)

- [ ] Node 22 LTS in WSL (`node -v` → v22.x). The MCP Inspector needs 22.19+.
- [ ] Docker Desktop running with WSL integration on (for DynamoDB Local).
- [ ] Chrome on Windows (for the voice "Talk" button demo).
- [ ] Claude Code updated: `claude update`. `/goal` and auto mode need a recent version.

## 3. Put the files in place

```
household-guard/
  CLAUDE.md              ← from this kit
  .claude/settings.json  ← from this kit (pre-approved commands)
  docs/SPEC.md           ← export the "Build spec" tab as Markdown
  docs/SLICES.md         ← export the "Vertical slices" tab as Markdown
  docs/PROGRESS.md       ← from this kit
  GOAL.txt               ← from this kit (the /goal text)
```

Then: `git init && git add . && git commit -m "spec" && git remote add origin <your repo> && git push -u origin main`

## 4. Launch

```
cd household-guard
claude --permission-mode auto
```

Inside Claude Code:

1. `/rename household-guard-build`
2. Paste: `/goal ` followed by the full text of GOAL.txt
3. Walk away. Check in with `/goal` (status, turns, last reason) or by opening docs/PROGRESS.md.

## 5. Check-ins (5 minutes each)

| When | Look for | If not |
| --- | --- | --- |
| Tue 11 PM | S0 PASS, web client lists tools | Read "Blocked on user" in PROGRESS.md; fix; re-run `/goal` |
| **Wed 10 PM — go/no-go** | S1 PASS: a request works end to end in the web client | Switch to Kiroween |
| Thu noon | S0–S5 PASS | Cut S5 first (see SLICES.md cut order) |
| Thu night | S0–S8 PASS | Record the video anyway with what works |
| Fri 9 AM | Video recorded, hallway test done | — |
| **Fri 12:00 PM ET** | Submitted on Devpost (3 h buffer) | — |

## If the goal stops

- `Goal cleared after an unrecoverable error` → fix the cause it names (login, credits), then paste the `/goal` again. Progress is in git and PROGRESS.md.
- `Goal paused` (usage limit) → it resumes when the limit resets, or send any message.
- Context getting long and Claude repeating mistakes → `/compact Keep PROGRESS.md state, current slice, failing test names`, then continue.
