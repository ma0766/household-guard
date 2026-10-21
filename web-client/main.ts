// Browser MCP client: plain fetch against the Streamable HTTP endpoint (stateless, JSON responses)
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
let token = '';
let phoneTokens: Record<string, string> = {};
let nextId = 1;

function log(dir: '→' | '←', obj: unknown) {
  logEl.textContent += `${dir} ${JSON.stringify(obj, null, 1)}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

async function rpc(method: string, params?: unknown, id: number | undefined = nextId++) {
  const msg = id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
  log('→', msg);
  const r = await fetch('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify(msg),
  });
  const text = await r.text();
  const out = text ? JSON.parse(text) : { status: r.status };
  log('←', out);
  return out;
}

let connected = false;
async function connect() {
  if (connected) return;
  const t = await (await fetch(`/demo-token?hh=${encodeURIComponent(new URLSearchParams(location.search).get('hh') ?? 'demo')}`)).json();
  token = t.token;
  phoneTokens = t.phones; // each simulated phone holds only its own person's key
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'web-client', version: '0.1.0' } });
  await rpc('notifications/initialized', undefined, undefined);
  connected = true;
}

async function callTool(name: string, args: Record<string, unknown>) {
  await connect();
  const out = await rpc('tools/call', { name, arguments: args });
  return out.result?.structuredContent ?? { outcome: 'held', reason: 'Something went wrong. Ask an adult.' };
}

// ---- who is talking ----
const PEOPLE = [
  { id: 'mom', name: 'Mom', phone: true },
  { id: 'maya', name: 'Maya', phone: true },
  { id: 'leo', name: 'Leo', phone: false },
  { id: 'guest', name: 'Guest', phone: false },
];
const saysEl = $('alexa-says');
function says(text: string, outcome = 'allowed') {
  saysEl.textContent = text;
  saysEl.className = `says ${outcome === 'allowed' ? '' : outcome}`;
  saysEl.dataset.outcome = outcome;
  if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// A waiting job (confirm on phone, a ride being booked…): ask again until it ends — Alexa never holds the line open.
let watch = 0;
async function waitJob(id: string) {
  const mine = ++watch; // a newer question cancels the older wait
  for (let i = 0; i < 240 && mine === watch; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (mine !== watch) return;
    const r = await callTool('job_status', { job_id: id });
    if (r.status && r.status !== 'waiting') {
      says(r.say, r.done ? 'allowed' : 'held');
      void refresh();
      if (r.status === 'held' && r.approval_id) return waitJob(r.approval_id); // sent back to an adult: keep listening for their answer
      return r;
    }
  }
}

const speakersEl = $('speakers');
const pinRow = document.createElement('div');
pinRow.className = 'row';
pinRow.hidden = true;
pinRow.innerHTML = '<input id="pin" data-testid="pin" placeholder="4-digit PIN" inputmode="numeric" maxlength="4" /><button id="btn-pin" data-testid="btn-pin">Say PIN</button>';
speakersEl.after(pinRow);
let pinFor = '';
for (const p of PEOPLE) {
  const b = document.createElement('button');
  b.className = 'secondary who';
  b.setAttribute('data-testid', `who-${p.id}`);
  b.textContent = p.name;
  b.onclick = async () => {
    document.querySelectorAll('.who').forEach((e) => e.classList.toggle('active', e === b));
    pinRow.hidden = true;
    if (p.id === 'guest') {
      await connect();
      await fetch('/demo/guest', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      return says('Hi. I do not know you yet.', 'held');
    }
    if (!p.phone) { pinFor = p.id; pinRow.hidden = false; return says('Say your PIN.', 'held'); }
    const r = await callTool('confirm_identity', { name: p.name });
    says(r.say, r.status === 'waiting' ? 'held' : 'denied');
    if (r.status === 'waiting') void waitJob(r.challenge_id);
  };
  speakersEl.appendChild(b);
}
$('btn-pin').onclick = async () => {
  const r = await callTool('confirm_identity', { name: pinFor, pin: ($('pin') as HTMLInputElement).value });
  says(r.say, r.status === 'confirmed' ? 'allowed' : 'denied');
};

// ---- simulated phones: one per family member, each polls its own inbox ----
const phonesEl = $('phones');
const phoneEls: Record<string, HTMLElement> = {};
for (const p of PEOPLE.filter((x) => x.id !== 'guest')) {
  const d = document.createElement('div');
  d.className = 'phone';
  d.setAttribute('data-testid', `phone-${p.id}`);
  d.innerHTML = `<h3>${p.name}'s phone</h3><div class="body">${p.phone ? 'Nothing waiting.' : 'No phone. Uses a PIN.'}</div>`;
  phonesEl.appendChild(d);
  phoneEls[p.id] = d.querySelector('.body') as HTMLElement;
}
async function refreshPhones() {
  if (!connected) return;
  for (const p of PEOPLE.filter((x) => x.phone)) {
    const r = await fetch(`/phone/${p.id}/inbox`, { headers: { authorization: `Bearer ${phoneTokens[p.id]}` } });
    if (!r.ok) continue;
    const inbox = await r.json();
    const body = phoneEls[p.id];
    const sig = JSON.stringify([inbox.challenges, inbox.notices, inbox.approvals]);
    if (body.dataset.sig === sig) continue;
    body.dataset.sig = sig;
    body.innerHTML = '';
    for (const c of inbox.challenges) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<p>${c.text}</p>`;
      for (const n of c.options) {
        const btn = document.createElement('button');
        btn.textContent = String(n);
        btn.setAttribute('data-testid', `phone-${p.id}-num-${n}`);
        btn.onclick = async () => {
          const out = await (await fetch(`/phone/${p.id}/confirm`, { method: 'POST', headers: { authorization: `Bearer ${phoneTokens[p.id]}`, 'content-type': 'application/json' }, body: JSON.stringify({ challenge_id: c.id, number: n }) })).json();
          if (out.status !== 'confirmed') says(out.say, 'denied');
        };
        card.appendChild(btn);
      }
      body.appendChild(card);
    }
    for (const ap of inbox.approvals ?? []) {
      const card = document.createElement('div');
      card.className = 'card approval';
      card.setAttribute('data-testid', `approval-${p.id}`);
      card.innerHTML = `<p><b>${ap.who}</b> wants: ${ap.what}</p><p>${ap.amount}</p><p>${ap.why}</p><p>Tap the number Alexa said:</p>`;
      for (const n of ap.options) {
        const btn = document.createElement('button');
        btn.textContent = String(n);
        btn.setAttribute('data-testid', `approve-${p.id}-num-${n}`);
        btn.onclick = async () => {
          const out = await (await fetch(`/phone/${p.id}/approve`, { method: 'POST', headers: { authorization: `Bearer ${phoneTokens[p.id]}`, 'content-type': 'application/json' }, body: JSON.stringify({ approval_id: ap.id, number: n }) })).json();
          if (out.status !== 'approved') says(out.say, 'denied');
        };
        card.appendChild(btn);
      }
      const no = document.createElement('button');
      no.className = 'secondary';
      no.textContent = 'No';
      no.setAttribute('data-testid', `reject-${p.id}`);
      no.onclick = () => void fetch(`/phone/${p.id}/reject`, { method: 'POST', headers: { authorization: `Bearer ${phoneTokens[p.id]}`, 'content-type': 'application/json' }, body: JSON.stringify({ approval_id: ap.id }) });
      card.appendChild(no);
      body.appendChild(card);
    }
    for (const n of inbox.notices) {
      const e = document.createElement('p');
      e.className = 'notice';
      e.textContent = n.text;
      body.appendChild(e);
    }
    if (!inbox.challenges.length && !inbox.notices.length && !(inbox.approvals ?? []).length) body.textContent = 'Nothing waiting.';
  }
}
// ---- "What happened": the screen comes from the house itself (show_on_screen), shown in a sandboxed frame ----
async function refreshTimeline() {
  if (!connected) return;
  const person = ($('tl-person') as HTMLSelectElement).value;
  const dayPick = ($('tl-day') as HTMLSelectElement).value;
  const day = dayPick === 'today' ? new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : undefined;
  const out = await callTool('show_on_screen', { view: 'timeline', ...(person ? { person } : {}), ...(day ? { day } : {}) });
  const frame = $('timeline') as HTMLIFrameElement;
  if (out.html && frame.srcdoc !== out.html) frame.srcdoc = out.html;
}
async function refresh() { await Promise.all([refreshPhones(), refreshTimeline()]); }
setInterval(() => void refresh().catch(() => undefined), 1000);
($('tl-person') as HTMLSelectElement).onchange = () => void refreshTimeline();
($('tl-day') as HTMLSelectElement).onchange = () => void refreshTimeline();
$('btn-voice-summary').onclick = async () => {
  const r = await callTool('audit_log', { who: 'kids', when: 'this week' });
  const el = $('summary');
  el.hidden = false;
  el.textContent = r.say;
};

// ---- words → one tool call ----
function parse(text: string): Record<string, unknown> | undefined {
  const t = text.toLowerCase();
  const num = t.match(/(\d{2,3})/)?.[1];
  if (/delete .*account/.test(t)) return { service: 'sim-home', action: 'delete_account' };
  if (/unlock/.test(t)) return { service: 'sim-home', action: 'unlock', item: 'front door' };
  if (/garage/.test(t)) return { service: 'sim-home', action: 'garage', item: 'garage', value: 'open' };
  if (/thermostat|degrees|temperature/.test(t)) return { service: 'sim-home', action: 'thermostat', item: 'thermostat', value: Number(num ?? 72) };
  if (/ride|taxi|cab/.test(t)) return { service: 'mock-ride', action: 'purchase', item: `ride to the ${(t.match(/airport|mall|library|school/) ?? ['mall'])[0]}`, ...(/shared/.test(t) ? { option_id: 'shared' } : {}) };
  if (/gift card/.test(t)) return { service: 'mock-shop', action: 'purchase', item: 'gift card' };
  if (/light/.test(t)) return { service: 'sim-home', action: 'light', item: 'lights', value: /\boff\b/.test(t) ? 'off' : 'on' };
  return undefined;
}

const altEl = document.createElement('div');
altEl.className = 'row';
saysEl.after(altEl);
function showAlt(a?: { args: Record<string, unknown>; alt: { option_id: string; label: string; total_cents: number; saves_cents: number }; approval: string }) {
  altEl.innerHTML = '';
  if (!a) return;
  const b = document.createElement('button');
  b.setAttribute('data-testid', 'accept-alt');
  b.textContent = `Yes, the ${a.alt.label.toLowerCase()} ($${(a.alt.total_cents / 100).toFixed(0)})`;
  b.onclick = async () => {
    altEl.innerHTML = '';
    const r = await callTool('request_action', { ...a.args, option_id: a.alt.option_id, replaces: a.approval, request_id: crypto.randomUUID() });
    says(r.say ?? r.reason, r.outcome === 'allowed' && !r.done ? 'held' : r.outcome);
    if (r.next === 'confirm_on_phone' && r.job_id) void waitJob(r.job_id);
  };
  altEl.appendChild(b);
}

async function say(text: string) {
  const args = parse(text);
  if (!args) return says("Sorry, I didn't get that.", 'held');
  const r = await callTool('request_action', { ...args, request_id: crypto.randomUUID() }); // one id per utterance; a retry of the same call reuses it
  says(r.say ?? r.reason, r.outcome === 'allowed' && !r.done ? 'held' : r.outcome);
  showAlt(r.alternative ? { args, alt: r.alternative, approval: r.approval_id } : undefined);
  if (r.next === 'confirm_on_phone' && r.job_id) void waitJob(r.job_id);
  else if (r.approval_id) void waitJob(r.approval_id);
  return r;
}

const QUICK = ['Turn off the lights', 'Unlock the front door', 'Delete my account', 'Set the thermostat to 72', 'Book a ride to the mall', 'Book a ride to the airport', 'Buy a gift card'];
for (const q of QUICK) {
  const b = document.createElement('button');
  b.className = 'secondary';
  b.textContent = q;
  b.onclick = () => void say(q);
  $('quick').appendChild(b);
}
$('btn-say').onclick = () => void say(($('say') as HTMLInputElement).value);
$('btn-talk').onclick = () => {
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!SR) return void (saysEl.textContent = 'Voice needs Chrome.');
  const rec = new SR();
  rec.lang = 'en-US';
  rec.onresult = (e: any) => {
    const text = e.results[0][0].transcript;
    ($('say') as HTMLInputElement).value = text;
    void say(text);
  };
  rec.start();
};

$('btn-connect').onclick = connect;
$('btn-tools').onclick = async () => { await connect(); await rpc('tools/list'); };
$('btn-status').onclick = async () => { await connect(); await rpc('tools/call', { name: 'household_status', arguments: {} }); };
