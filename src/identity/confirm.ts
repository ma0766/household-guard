import type { Deps } from '../core/request-action.js';
import { ensureSeeded, loadHousehold, setSession } from '../core/household.js';
import { openChallenge, openChallengesFor, tapNumber } from '../approvals/challenge.js';
import { beginAttempt, clearWrong, failAttempt, isLocked } from './guard.js';
import { verifyPin } from './pin.js';
import { T } from '../text.js';
import { Store } from '../core/store.js';
import { openSuggestions } from '../devices/suggest.js';
import { openApprovals } from '../approvals/approvals.js';
import { money } from '../text.js';

export interface ConfirmOutcome {
  status: 'waiting' | 'confirmed' | 'locked' | 'failed' | 'unknown';
  say: string;
  number?: number;
  challenge_id?: string;
}

// "I'm Maya." → a number to match on Maya's own phone. A name alone proves nothing; only the tap (or PIN) does.
export async function confirmIdentity(deps: Deps, hh: string, args: { name: string; pin?: string }): Promise<ConfirmOutcome> {
  const now = (deps.now ?? Date.now)();
  try {
    await ensureSeeded(deps.store, hh);
    const { people } = await loadHousehold(deps.store, hh, now);
    const want = args.name.trim().toLowerCase();
    const p = people.find((x) => x.id !== 'guest' && (x.id === want || x.name.toLowerCase() === want));
    if (!p) return { status: 'unknown', say: "I don't know that name." };
    if (await isLocked(deps.store, hh, p.id, now)) return { status: 'locked', say: T.locked };

    if (!p.hasPhone) {
      // people without a phone use a 4-digit PIN by voice — good for low and medium risk only
      if (!args.pin) return { status: 'failed', say: 'Say your PIN.' };
      if ((await beginAttempt(deps.store, hh, p.id, now)) === 'locked') return { status: 'locked', say: T.locked };
      const row = await deps.store.get(Store.hk(hh), `PERSON#${p.id}`);
      if (verifyPin(args.pin, row?.pinHash)) {
        await clearWrong(deps.store, hh, p.id, now);
        await setSession(deps.store, hh, p.id, 'pin', now);
        return { status: 'confirmed', say: `Hi ${p.name}.` };
      }
      return (await failAttempt(deps.store, hh, p.id, p.name, now)) === 'locked' ? { status: 'locked', say: T.locked } : { status: 'failed', say: 'That PIN is not right.' };
    }

    const { challenge, locked } = await openChallenge(deps, hh, p, 'login');
    if (locked || !challenge) return { status: 'locked', say: T.locked };
    return { status: 'waiting', say: T.confirmOnPhone(challenge.number), number: challenge.number, challenge_id: challenge.id };
  } catch {
    return { status: 'failed', say: T.oops };
  }
}

// What a person's own phone shows: things to confirm (3 numbers, no hint which is right) and notices for adults.
export async function phoneInbox(deps: Deps, hh: string, personId: string, opts: { link?: boolean } = {}) {
  const now = (deps.now ?? Date.now)();
  const { people } = await loadHousehold(deps.store, hh);
  const me = people.find((p) => p.id === personId);
  const open = await openChallengesFor(deps, hh, personId);
  const challenges = open.map((c) => {
    const text = c.kind === 'login' ? 'Is this you? Tap the number Alexa said.' : c.kind === 'rule' ? `${me?.name ?? 'Someone'} wants to change a rule. ${(c.meta as any)?.text ?? ''} Tap the number Alexa said.` : `${me?.name ?? 'Someone'} asked: ${describe(c.args)}. Tap the number Alexa said.`;
    return { id: c.id, kind: c.kind, text, options: c.options, ...((c.meta as any)?.needsKey ? { needs_key: true } : {}) };
  });
  const notices = me?.role === 'adult' ? (await deps.store.query(Store.hk(hh), 'NOTICE#', { reverse: true, limit: 5 })).filter((n) => now - n.at < 3600_000).map((n) => ({ text: n.text as string, at: n.at as number })) : [];
  // an adult's phone also shows held requests: who, what, how much, why — plus the number Alexa said (among 3)
  const approvals = me?.role === 'adult' && (me.hasPhone || opts.link) ? (await openApprovals(deps, hh)).filter((a) => !(a.scam && a.personId === me.id)).map((a) => ({ id: a.id, who: a.personName, what: a.itemText ?? a.itemKey, amount: money(a.amountCents), why: a.reason, rule: a.rule ? T.why(a.rule) : undefined, options: a.options, text: `${a.personName} wants: ${a.itemText ?? a.itemKey}. ${money(a.amountCents)}. ${a.reason}` })) : [];
  const links = (await deps.store.query(Store.hk(hh), `PHONELINK#${personId}#`, { reverse: true, limit: 3 })).filter((l) => now - (l.at as number) < 86400_000).map((l) => ({ text: String(l.text), url: String(l.url) })); // a link made for THIS person only
  const suggestions = me?.role === 'adult' && me.hasPhone ? await openSuggestions(deps, hh) : [];
  return { person: personId, has_phone: !!me?.hasPhone, challenges, notices, approvals, suggestions, links };
}

function describe(a?: { action: string; item?: string; value?: string | number }): string {
  if (!a) return 'something';
  if (a.action === 'unlock') return `unlock the ${a.item ?? 'door'}`;
  if (a.action === 'garage') return 'open the garage';
  return `${a.action} ${a.item ?? ''}`.trim();
}

export async function phoneConfirm(deps: Deps, hh: string, personId: string, body: { challenge_id: string; number: number; key?: string }) {
  const { people } = await loadHousehold(deps.store, hh);
  const me = people.find((p) => p.id === personId);
  if (!me || !me.hasPhone) return { status: 'not_yours' as const, say: 'That is not for you.' };
  return tapNumber(deps, hh, personId, me.name, body.challenge_id, Number(body.number), typeof body.key === 'string' ? body.key : undefined);
}
