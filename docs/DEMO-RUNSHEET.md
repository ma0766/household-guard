# Demo run sheet (the 2:45 script, in an order that works)

Why this exists: the audit found that the script in `docs/SPEC.md` asks one person to tap on their phone more often than the safety limit allows (3 taps per person per 10 minutes, then a 10-minute lock). The recorded run in `audit/2026-10-21/demo-run.webm` uses the order below. The limit stays; the order changes.

Before every take: `npm run demo:reset`, then open `http://127.0.0.1:8016/?dad=1`. The reset clears the locks.

Taps used per person: Maya 3, Mom 3, Dad 2. Nobody goes over 3.

| Time | What you do | What the viewer sees |
| --- | --- | --- |
| 0:00 | Tap **Maya** and tap her number on her phone (Maya tap 1). Press **Book a ride to the airport**. | Held: over her $20 a week. A $14 shared ride is offered. Mom's phone shows the card. |
| 0:20 | Say the problem line (a slide in the final video). | |
| 0:45 | Tap **Guest**: *Turn off the lights* (done), *Unlock the front door* (refused), *Book a ride* (refused). | Same three asks, three different answers. |
| | Tap **Maya** and tap her number (Maya tap 2): same three asks. Press **Accept** on the $14 ride, tap her number (Maya tap 3). | Lights done, unlock refused, the $38 ride held, the $14 ride booked, $24 saved. |
| | Tap **Mom** and tap her number (Mom tap 1): same three asks. Tap her number for the unlock (Mom tap 2) and the ride (Mom tap 3). | An adult can do all three, each with her own tap. |
| 1:30 | Tap **Dad** and tap his number (Dad tap 1). Press **Buy a gift card**. Tap his number (Dad tap 2). | "That needs a closer look. An adult can tap NN to say yes." The rules said yes; the AI check held it. |
| 1:50 | Press **Break it (demo)** (Dad is the confirmed adult). Press **Book a ride to the mall**. Press **Check now**. Press **Book a ride to the mall** again. Tap Mom's number on her card. | The ride service breaks, is fixed, and the next ride needs one yes. |
| 2:15 | Scroll to **What happened**. Press **What did the kids buy this week?** | The timeline in plain sentences. Show the replay test in a terminal: `npx vitest run tests/replay` (30 of 30). |
| 2:35 | Show `docs/architecture.svg`. | The AWS services. |

Raw action time for this order, recorded: about 1 minute 11 seconds (`audit/2026-10-21/B-demo-timing-local.json`). The rest of the 2:45 is narration.
