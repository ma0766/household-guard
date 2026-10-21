import type { AuditEntry } from './audit.js';
import { ICON } from './report.js';
import { money } from '../text.js';
import type { Approval } from '../approvals/approvals.js';

// HTML screens (approval card, recent orders, timeline). Everything from outside is escaped.
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STYLE = `<style>body{font:16px/1.4 system-ui,sans-serif;margin:0;padding:8px;color:#1d2433}.row{display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #e4dfd2}.ic{font-size:20px;width:28px}.t{flex:1}.m{color:#5b6477;font-size:13px}h2{font-size:16px;margin:0 0 6px}.card{border:1px solid #d9d4c7;border-radius:10px;padding:10px;margin-bottom:8px}</style>`;

export function timelineHtml(entries: AuditEntry[], title = 'What happened'): string {
  const rows = entries.length
    ? entries.map((e) => `<div class="row" data-kind="${esc(e.kind)}" data-category="${esc(e.category)}"><span class="ic" title="${esc(e.category)}">${ICON[e.category] ?? '•'}</span><span class="t">${esc(e.text)}</span><span class="m">${esc(e.day)}</span></div>`).join('')
    : '<p>Nothing yet.</p>';
  return `<!doctype html><meta charset="utf-8">${STYLE}<h2>${esc(title)}</h2>${rows}`;
}

export function approvalsHtml(list: Approval[]): string {
  const cards = list.length
    ? list.map((a) => `<div class="card"><b>${esc(a.personName)}</b> wants: ${esc(a.itemText ?? a.itemKey)}<br>${esc(money(a.amountCents))}<br><span class="m">${esc(a.reason)}</span></div>`).join('')
    : '<p>Nothing is waiting.</p>';
  return `<!doctype html><meta charset="utf-8">${STYLE}<h2>Waiting for an adult</h2>${cards}`;
}

export function ordersHtml(entries: AuditEntry[]): string {
  const rows = entries.length ? entries.map((e) => `<div class="row"><span class="ic">🛒</span><span class="t">${esc(e.text)}</span><span class="m">${esc(e.day)}</span></div>`).join('') : '<p>No buys yet.</p>';
  return `<!doctype html><meta charset="utf-8">${STYLE}<h2>Recent buys</h2>${rows}`;
}
