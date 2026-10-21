import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { getSession, loadHousehold } from '../core/household.js';
import { openChallenge, type Challenge } from '../approvals/challenge.js';
import { previewChange } from './preview.js';
import { applyChange, isFloorLoosening, type RuleChange } from './templates.js';
import type { RulesConfig } from '../policy/rules.js';
import { emit } from '../audit/emit.js';
import { spentThisWeek } from '../spend/spend.js';
import { weekKey } from '../core/time.js';
import { esc } from '../audit/views.js';
import { T, hourWord, money } from '../text.js';

export const UNDO_MS = 24 * 60 * 60 * 1000;
const chgKey = (v: number) => `RULECHG#${String(v).padStart(8, '0')}`;

export interface RuleReply {
  status: 'waiting' | 'denied' | 'invalid' | 'locked';
  say: string;
  number?: number;
  challenge_id?: string;
  sentence?: string;
  warning?: string;
  preview?: string; // what the change would let people do, in plain words (S10)
}

// An adult asks for a change (card or voice). Nothing is saved until THAT adult taps the number on their own phone.
export async function proposeRule(deps: Deps, hh: string, req: { change?: RuleChange; undo?: boolean }): Promise<RuleReply> {
  const now = (deps.now ?? Date.now)();
  try {
    const { people, rules, meta } = await loadHousehold(deps.store, hh);
    const s = await getSession(deps.store, hh, now);
    const me = s && people.find((p) => p.id === s.personId);
    if (!me || me.role === 'guest') {
      await emit(deps, hh, { kind: 'rule', category: 'rule', person: 'guest', personName: 'Someone', text: (t) => `Someone tried to change a rule at ${t}. No. Nobody was confirmed.`, data: { refused: 'no_session' } });
      return { status: 'denied', say: T.whoAreYou };
    }
    if (me.role !== 'adult') {
      await emit(deps, hh, { kind: 'rule', category: 'rule', person: me.id, personName: me.name, text: (t) => `${me.name} tried to change a rule at ${t}. No. Only adults can.`, data: { refused: 'not_adult' } });
      return { status: 'denied', say: 'Ask an adult to change rules.' };
    }
    if (s!.method !== 'phone') {
      await emit(deps, hh, { kind: 'rule', category: 'rule', person: me.id, personName: me.name, text: (t) => `${me.name} tried to change a rule at ${t}. Needs their phone first.`, data: { refused: 'needs_phone' } });
      return { status: 'denied', say: T.confirmPhone };
    }

    let meta2: Record<string, unknown>;
    let sentence: string;
    let warning: string | undefined;
    let preview: string;
    if (req.undo) {
      const last = await latestChange(deps, hh);
      if (!last || last.at + UNDO_MS < now) return { status: 'invalid', say: last ? 'That is too old to undo.' : 'Nothing to undo.' };
      sentence = `Undo: ${last.sentence}`;
      const loosens = (['childrenNoUnlock', 'guestsNoBuy'] as const).some((k) => rules.floor[k] && !last.before.floor[k]);
      if (loosens) warning = 'This turns off a locked rule.';
      preview = previewChange(rules, last.before, people).join(' ');
      meta2 = { undoVersion: last.version, text: `Undo the last change. ${last.sentence} ${preview}`, stage: loosens ? 1 : 'final' };
    } else {
      const a = applyChange(rules, req.change!, people);
      if (!a.ok) return { status: 'invalid', say: a.error };
      sentence = a.sentence;
      warning = a.warning;
      preview = previewChange(rules, a.config, people).join(' ');
      meta2 = { change: req.change, baseVersion: rules.version, text: `${a.sentence}${a.warning ? ' ' + a.warning : ''} ${preview}`, stage: isFloorLoosening(req.change!) ? 1 : 'final' };
    }
    void meta;
    const { challenge, locked } = await openChallenge(deps, hh, me, 'rule', undefined, meta2);
    if (locked || !challenge) return { status: 'locked', say: T.locked };
    return { status: 'waiting', say: T.confirmOnPhone(challenge.number), number: challenge.number, challenge_id: challenge.id, sentence, warning, preview };
  } catch {
    return { status: 'denied', say: T.oops };
  }
}

interface ChangeRow {
  version: number;
  by: string;
  sentence: string;
  before: RulesConfig;
  at: number;
  status: 'applied' | 'undone';
}

async function latestChange(deps: Deps, hh: string): Promise<ChangeRow | undefined> {
  const rows = (await deps.store.query(Store.hk(hh), 'RULECHG#', { reverse: true })) as unknown as ChangeRow[];
  return rows.find((r) => r.status === 'applied');
}

async function save(deps: Deps, hh: string, next: RulesConfig, baseVersion: number, extra: any[]): Promise<boolean> {
  const pk = Store.hk(hh);
  try {
    await deps.store.transact([
      ...extra, // the change record (or the undo mark) commits WITH the new rules: a saved change is always undoable
      { Update: { TableName: deps.store.table, Key: { pk, sk: 'RULES#current' }, UpdateExpression: 'SET config = :c', ConditionExpression: 'config.version = :v', ExpressionAttributeValues: { ':c': next, ':v': baseVersion } } },
      { Put: { TableName: deps.store.table, Item: { pk, sk: `RULES#v${next.version}`, config: next }, ConditionExpression: 'attribute_not_exists(pk)' } },
    ]);
    return true;
  } catch (e: any) {
    if (e?.name === 'TransactionCanceledException') return false; // rules changed under us
    throw e;
  }
}

// Called by the phone tap. Floor-loosening needs a second, separate tap after a clear warning.
export async function completeRule(deps: Deps, hh: string, personId: string, c: Challenge): Promise<{ done: boolean; reason: string; jobId?: string }> {
  const now = (deps.now ?? Date.now)();
  const m = c.meta as any;
  const { people, rules } = await loadHousehold(deps.store, hh);
  const me = people.find((p) => p.id === personId);
  if (!me || me.role !== 'adult') return { done: false, reason: 'Ask an adult to change rules.' }; // checked again at the moment of the change

  if (m.stage === 1 && m.undoVersion !== undefined) {
    const { challenge, locked } = await openChallenge(deps, hh, me, 'rule', undefined, { ...m, stage: 'final', text: `Are you sure? This turns off a locked rule. ${m.text}` });
    if (locked || !challenge) return { done: false, reason: T.locked };
    return { done: false, reason: `This turns off a locked rule. ${T.confirmOnPhone(challenge.number)}`, jobId: challenge.id };
  }
  if (m.stage === 1) {
    const a = applyChange(rules, m.change, people);
    if (!a.ok) return { done: false, reason: a.error };
    const { challenge, locked } = await openChallenge(deps, hh, me, 'rule', undefined, { ...m, stage: 'final', text: `Are you sure? ${a.warning ?? ''} ${a.sentence}` });
    if (locked || !challenge) return { done: false, reason: T.locked };
    return { done: false, reason: `${a.warning} ${T.confirmOnPhone(challenge.number)}`, jobId: challenge.id };
  }

  let next: RulesConfig;
  let sentence: string;
  let undoneVersion: number | undefined;
  if (m.undoVersion !== undefined) {
    const last = await latestChange(deps, hh);
    if (!last || last.version !== m.undoVersion || last.at + UNDO_MS < now) return { done: false, reason: 'That is too old to undo.' };
    next = { ...last.before, version: rules.version + 1 };
    sentence = `Undone: ${last.sentence}`;
    undoneVersion = last.version;
  } else {
    if (rules.version !== m.baseVersion) return { done: false, reason: 'The rules changed. Try again.' };
    const a = applyChange(rules, m.change, people);
    if (!a.ok) return { done: false, reason: a.error };
    next = a.config;
    sentence = a.sentence;
  }
  const pk = Store.hk(hh);
  const record =
    undoneVersion !== undefined
      ? { Update: { TableName: deps.store.table, Key: { pk, sk: chgKey(undoneVersion) }, UpdateExpression: 'SET #s = :u', ConditionExpression: '#s = :a', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':u': 'undone', ':a': 'applied' } } }
      : { Put: { TableName: deps.store.table, Item: { pk, sk: chgKey(next.version), version: next.version, by: me.id, sentence, before: rules, at: now, status: 'applied', ttl: Math.floor(now / 1000) + 90 * 86400 } } };
  if (!(await save(deps, hh, next, rules.version, [record]))) return { done: false, reason: 'The rules changed. Try again.' };
  await emit(deps, hh, { kind: 'rule', category: 'rule', person: me.id, personName: me.name, text: (t) => `${me.name} ${undoneVersion !== undefined ? 'undid' : 'changed'} a rule at ${t}. ${sentence}`, data: { version: next.version } });
  return { done: true, reason: sentence };
}

// What a person may see about their own rules (kids can look, not change).
export async function myRules(deps: Deps, hh: string): Promise<{ say: string }> {
  const now = (deps.now ?? Date.now)();
  const { people, rules, meta } = await loadHousehold(deps.store, hh);
  const s = await getSession(deps.store, hh, now);
  const me = s && people.find((p) => p.id === s.personId);
  if (!me || me.role === 'guest') return { say: T.whoAreYou };
  if (me.role === 'adult') return { say: 'You can change the rules.' };
  const cap = rules.weeklyCapCents[me.id];
  const parts: string[] = [];
  if (cap === undefined) parts.push('I need an adult to say yes to buys.');
  else parts.push(`My limit: ${money(cap)} a week, ${money(Math.max(0, cap - (await spentThisWeek(deps.store, hh, weekKey(now, meta.timezone), me.id))))} left.`);
  if (rules.adultsOnlyActions.length) parts.push('Some things are for adults only.');
  return { say: parts.join(' ') };
}

export function rulesHtml(rules: RulesConfig, people: { id: string; name: string; role: string }[]): string {
  const row = (icon: string, text: string) => `<div class="row"><span class="ic">${icon}</span><span class="t">${esc(text)}</span></div>`;
  const rows = [
    ...people.filter((p) => p.role !== 'guest').map((p) => row('🛒', rules.weeklyCapCents[p.id] === undefined ? `${p.name}: an adult says yes to buys.` : `${p.name}: ${money(rules.weeklyCapCents[p.id])} a week.`)),
    row('🔒', `Adults only: ${rules.adultsOnlyActions.join(', ') || 'nothing'}.`),
    row('🛒', `Allowed apps: ${rules.allowedServices.join(', ')}.`),
    row('📝', `Best value needs: ${[rules.mustHaves.bagIncluded ? 'a bag' : '', rules.mustHaves.arriveByHour !== undefined ? `arrive by ${rules.mustHaves.arriveByHour}:00` : ''].filter(Boolean).join(' and ') || 'nothing special'}.`),
    row('🎁', (rules.orderRoles ?? []).length ? `Adults and ${(rules.orderRoles ?? []).map((r) => (r === 'teen' ? 'teens' : 'children')).join(' and ')} hear orders. Gifts stay private.` : 'Only adults hear orders. Gifts stay private.'),
    row('🌙', rules.quietHours ? `No buying for kids from ${hourWord(rules.quietHours.fromHour)} to ${hourWord(rules.quietHours.toHour)}.` : 'Quiet hours are off.'),
    row('🔒', rules.floor.childrenNoUnlock ? "Locked: children can't unlock doors." : "Off: children can't unlock doors."),
    row('🔒', rules.floor.guestsNoBuy ? "Locked: guests can't buy." : "Off: guests can't buy."),
  ];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>House rules</title><style>body{font:16px/1.4 system-ui,sans-serif;margin:0;padding:8px}.row{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #e4dfd2}.ic{width:26px}h2{font-size:16px;margin:0 0 6px}</style><h2>House rules</h2>${rows.join('')}`;
}
