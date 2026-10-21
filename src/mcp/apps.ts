import type { AuditEntry } from '../audit/audit.js';
import type { Approval } from '../approvals/approvals.js';
import { ICON } from '../audit/report.js';

// MCP Apps: a screen is a ui:// page the host draws in a sandboxed frame. The page asks the host (over postMessage)
// for its data and for any button press; it never calls the house directly and it cannot reach the network.
export const APP_URI = 'ui://household-guard/screen';
export const APP_MIME = 'text/html;profile=mcp-app';
export const APP_META = { ui: { resourceUri: APP_URI }, 'ui/resourceUri': APP_URI };

export interface Card { id: string; who: string; what: string; price_cents: number; why: string; number?: number }
export interface Row { icon: string; text: string; day: string }
export type ScreenData = { view: 'approvals'; cards: Card[] } | { view: 'orders' | 'timeline'; rows: Row[] } | { view: 'preview'; name: string; link: string; qr: { size: number; rows: string[] } } | { view: 'connect'; name: string; link: string; qr: { size: number; rows: string[] } };

export const cardsOf = (list: Approval[], viewerIsAdult: boolean): Card[] =>
  list.map((a) => ({ id: a.id, who: a.personName, what: a.itemText ?? a.itemKey, price_cents: a.amountCents, why: a.reason, ...(viewerIsAdult ? { number: a.number } : {}) }));
export const rowsOf = (entries: AuditEntry[]): Row[] => entries.map((e) => ({ icon: ICON[e.category] ?? '•', text: e.text, day: e.day }));

// Self-contained: no outside addresses, text goes in with textContent only, and the content rule shuts everything else.
export const APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Screen from the house</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>body{font:16px/1.4 system-ui,sans-serif;margin:0;padding:10px;color:#1d2433}h2{font-size:17px;margin:0 0 8px}.card{border:1px solid #d9d4c7;border-radius:10px;padding:10px;margin-bottom:8px}.row{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #e4dfd2}.ic{width:26px;font-size:18px}.t{flex:1}.m{color:#5b6477;font-size:13px}button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid #1d2433;background:#1d2433;color:#fff;margin-right:6px;cursor:pointer}button.no{background:#fff;color:#1d2433}.done{color:#1b6b3a;font-weight:600}</style></head>
<body><div id="root"></div>
<script>
(function () {
  var root = document.getElementById('root');
  var pending = {}, nextId = 1;
  function send(m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      send({ id: id, method: method, params: params });
    });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function say(text) { return text; }
  function label(text) { return text; }
  function money(c) { return '$' + (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2)); }
  function heading(text) { root.textContent = ''; root.appendChild(el('h2', '', text)); }
  function rows(list, title) {
    heading(title);
    if (!list.length) root.appendChild(el('p', '', say('Nothing yet.')));
    list.forEach(function (r) {
      var row = el('div', 'row'); row.appendChild(el('span', 'ic', r.icon)); row.appendChild(el('span', 't', r.text)); row.appendChild(el('span', 'm', r.day)); root.appendChild(row);
    });
  }
  function decide(card, box, answer) {
    var buttons = box.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true; // one press, one answer
    request('tools/call', { name: 'approve_request', arguments: { approval_id: card.id, number: card.number, decision: answer } }).then(function (res) {
      var out = (res && res.structuredContent) || {};
      var good = out.status === 'approved' || out.status === 'rejected';
      if (!good) { for (var j = 0; j < buttons.length; j++) buttons[j].disabled = false; } // not done: let them try again
      box.appendChild(el('p', good ? 'done' : 'm', out.say || say('Done.')));
      if (good) { for (var k = 0; k < buttons.length; k++) buttons[k].style.display = 'none'; }
    }, function () { box.textContent = ''; box.appendChild(el('p', '', say('Something went wrong. Ask an adult.'))); });
  }
  function approvals(cards) {
    heading(label('Waiting for an adult'));
    if (!cards.length) root.appendChild(el('p', '', say('Nothing is waiting.')));
    cards.forEach(function (c) {
      var box = el('div', 'card');
      box.appendChild(el('div', '', c.who + ' wants: ' + c.what));
      box.appendChild(el('div', '', money(c.price_cents)));
      box.appendChild(el('div', 'm', c.why));
      if (c.number !== undefined) {
        var yes = el('button', 'yes', label('Yes')); yes.setAttribute('data-testid', 'app-yes');
        var no = el('button', 'no', label('No')); no.setAttribute('data-testid', 'app-no');
        yes.onclick = function () { decide(c, box, 'yes'); };
        no.onclick = function () { decide(c, box, 'no'); };
        box.appendChild(yes); box.appendChild(no);
      }
      root.appendChild(box);
    });
  }
  function connect(d) {
    heading(d.view === 'preview' ? label('Your site is ready: ') + d.name : label('Connect ') + d.name);
    root.appendChild(el('p', '', say('Scan the code, or open the link, on your phone.')));
    var cell = 6, n = d.qr.size, canvas = document.createElement('canvas');
    canvas.width = canvas.height = (n + 8) * cell; canvas.setAttribute('data-testid', 'app-qr');
    var g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.fillStyle = '#000';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (d.qr.rows[y].charAt(x) === '1') g.fillRect((x + 4) * cell, (y + 4) * cell, cell, cell);
    root.appendChild(canvas);
    var l = el('p', 'm', d.link); l.setAttribute('data-testid', 'app-link'); root.appendChild(l);
  }
  function render(data) {
    if (!data) { heading(label('Sign in first')); return; }
    if (data.view === 'connect' || data.view === 'preview') { connect(data); return; }
    if (data.view === 'approvals') approvals(data.cards || []);
    else rows(data.rows || [], data.view === 'orders' ? label('Recent buys') : label('What happened'));
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var m = e.data || {};
    if (m.id !== undefined && pending[m.id]) { var p = pending[m.id]; delete pending[m.id]; if (m.error) p.reject(m.error); else p.resolve(m.result); return; }
    if (m.method === 'ui/notifications/tool-result') render((m.params && m.params.structuredContent && m.params.structuredContent.data) || undefined);
  });
  request('ui/initialize', { protocolVersion: '2025-11-21', appInfo: { name: 'household-screen', version: '1' }, appCapabilities: {} }).then(function () {
    send({ method: 'ui/notifications/initialized', params: {} });
  });
})();
</script></body></html>`;
