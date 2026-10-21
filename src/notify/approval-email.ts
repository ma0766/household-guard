import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { mintLinkToken } from '../auth.js';
import { loadHousehold } from '../core/household.js';
import { money } from '../text.js';
import type { Approval } from '../approvals/approvals.js';
import { defaultNotifier } from './notify.js';

// One email per held request, to each adult we have an address for. It never changes the answer: any failure is swallowed.
const clean = (s: string) => (s.split(/[\r\n]/)[0] ?? '').replace(/\S*\.[a-z]{2,}\S*/gi, '').replace(/[^A-Za-z0-9 ,.'$-]/g, '').trim().slice(0, 60); // one plain line, nothing a caller typed can add a header or a link
const withArticle = (item: string) => (/^(a|an|the)\s/i.test(item) ? item : /^[aeiou]/i.test(item) ? `an ${item}` : `a ${item}`);

function addresses(meta: Record<string, unknown> | undefined, hh: string): Record<string, string> {
  const house = process.env.HG_APPROVER_HOUSEHOLD;
  let fromEnv: Record<string, string> = {};
  if (process.env.HG_APPROVER_EMAILS && (!house || house === hh)) {
    try {
      fromEnv = JSON.parse(process.env.HG_APPROVER_EMAILS);
    } catch {
      /* ignore a bad value */
    }
  }
  return { ...fromEnv, ...((meta?.emails as Record<string, string> | undefined) ?? {}) };
}

// A teen asking again and again must not fill an adult's inbox (or hurt the sender's name): 3 emails per adult per 10 minutes.
async function mayEmail(deps: Deps, hh: string, adult: string, now: number): Promise<boolean> {
  const recent = (await deps.store.query(Store.hk(hh), `MAIL#${adult}#`)).filter((r) => now - (r.at as number) < 10 * 60_000);
  if (recent.length >= 3) return false;
  await deps.store.put({ pk: Store.hk(hh), sk: `MAIL#${adult}#${String(now).padStart(15, '0')}#${Math.random().toString(36).slice(2, 6)}`, at: now, ttl: Math.floor(now / 1000) + 3600 });
  return true;
}

export async function notifyApproval(deps: Deps, hh: string, a: Approval): Promise<void> {
  try {
    const base = process.env.HG_PUBLIC_URL?.replace(/\/$/, '');
    if (!base) return;
    const [{ people }, metaRow] = await Promise.all([loadHousehold(deps.store, hh), deps.store.get(Store.hk(hh), 'META')]);
    const emails = addresses(metaRow, hh);
    const notifier = deps.notifier ?? defaultNotifier();
    const now = (deps.now ?? Date.now)();
    const item = clean(a.itemText ?? a.itemKey) || 'something';
    const name = clean(a.personName) || 'Someone';
    // all adults at once with ONE shared wait, so the reply never waits longer than that (and never more than 3 emails per adult per 10 minutes)
    const sends = people.filter((p) => p.role === 'adult' && emails[p.id]).map(async (adult) => {
      if (!(await mayEmail(deps, hh, adult.id, now))) return;
      const link = `${base}/approve?t=${mintLinkToken(adult.id, hh, a.id, (a.expiresAt - now) / 1000)}`;
      const text = [`${name} wants: ${item}.`, `Price: ${money(a.amountCents)}.`, a.reason, `Say yes or no here: ${link}`, 'The link works for 10 minutes.', 'Pick the number Alexa said.'].join('\n');
      await notifier.send({ to: emails[adult.id], subject: `${name} wants ${withArticle(item)}: ${money(a.amountCents)}`, text });
    });
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(sends), new Promise((r) => (timer = setTimeout(r, 800)))]);
    clearTimeout(timer);
  } catch (e) {
    console.error('approval email failed', e);
  }
}
