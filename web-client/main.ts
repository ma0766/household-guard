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
  let out: any;
  try { out = text ? JSON.parse(text) : { status: r.status }; } catch { out = { status: r.status }; }
  if (r.status === 429) out.tooMany = true; // the house is asking too fast; callTool turns this into a plain sentence
  log('←', out);
  return out;
}

// ---- sign in with a family account: OAuth authorization code + PKCE (S256), the same way Alexa links an account ----
let familyToken = '';
const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const sha256b64url = async (s: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const houseName = () => new URLSearchParams(location.search).get('hh') ?? 'demo';
async function setUpSignIn() {
  let cfg: { sign_in: { authorize_url: string; token_url: string; client_id: string; scope: string } | null } = { sign_in: null };
  try { cfg = await (await fetch('/config.json')).json(); } catch { /* no sign-in server: the demo sign-in is all there is */ }
  const si = cfg.sign_in;
  if (!si) return;
  $('account-panel').hidden = false;
  const redirect = `${location.origin}/`;
  const q = new URLSearchParams(location.search);
  if (q.get('code') && sessionStorage.getItem('hg_state') === q.get('state')) {
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: si.client_id, code: q.get('code')!, redirect_uri: redirect, code_verifier: sessionStorage.getItem('hg_verifier') ?? '' });
    const r = await fetch(si.token_url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json();
    sessionStorage.removeItem('hg_verifier');
    sessionStorage.removeItem('hg_state');
    history.replaceState(null, '', `/?hh=${encodeURIComponent(sessionStorage.getItem('hg_house') ?? 'demo')}`);
    if (j.access_token) {
      familyToken = j.access_token;
      document.body.dataset.auth = 'family-account';
      $('account-status').textContent = 'Signed in with your family account.';
    } else $('account-status').textContent = 'Sign-in did not work. Try again.';
  }
  $('btn-signin').onclick = async () => {
    const verifier = rand(64);
    const state = rand(16);
    sessionStorage.setItem('hg_verifier', verifier);
    sessionStorage.setItem('hg_state', state);
    sessionStorage.setItem('hg_house', houseName());
    const u = new URL(si.authorize_url);
    u.search = new URLSearchParams({ response_type: 'code', client_id: si.client_id, redirect_uri: redirect, scope: si.scope, state, code_challenge: await sha256b64url(verifier), code_challenge_method: 'S256', login_hint: houseName() }).toString();
    location.href = u.toString();
  };
}
const signInReady = setUpSignIn();
// say plainly which parts are practice versions (stand-ins) so nobody watching mistakes them for the real service
let standInText = '';
void (async () => {
  try {
    const list = ((await (await fetch('/config.json')).json()) as { stand_ins?: string[] }).stand_ins ?? [];
    if (!list.length) return;
    standInText = `Demo stand-ins, not real: ${list.join(', ')}.`;
    $('standin-note').textContent = standInText; // the space is already reserved in the page, so nothing jumps
  } catch { /* no note if the config cannot be read */ }
})();

let connected = false;
async function connect() {
  if (connected) return;
  await signInReady;
  const r = await fetch(`/demo-token?hh=${encodeURIComponent(houseName())}`);
  const t = r.ok ? await r.json() : { token: '', phones: {} };
  token = familyToken || t.token;
  document.body.dataset.tokenKind = familyToken ? 'family-account' : 'demo';
  phoneTokens = t.phones; // each simulated phone holds only its own person's key
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'web-client', version: '0.1.0' } });
  await rpc('notifications/initialized', undefined, undefined);
  connected = true;
}

async function callTool(name: string, args: Record<string, unknown>) {
  await connect();
  const out = await rpc('tools/call', { name, arguments: args });
  const say = out.tooMany ? 'Too many asks. Wait a moment.' : 'Something went wrong. Ask an adult.';
  return out.result?.structuredContent ?? { outcome: 'held', say, reason: say }; // always a sentence in both fields: a caller never shows an empty line
}

// ---- who is talking ----
const PEOPLE = [
  { id: 'mom', name: 'Mom', phone: true },
  { id: 'maya', name: 'Maya', phone: true },
  { id: 'leo', name: 'Leo', phone: false },
  { id: 'guest', name: 'Guest', phone: false },
];
// the reset demo house (npm run demo:reset) also has Dad: open the page with ?dad=1 to see his button and phone
if (new URLSearchParams(location.search).get('dad') === '1') PEOPLE.splice(1, 0, { id: 'dad', name: 'Dad', phone: true });
const saysEl = $('alexa-says');
function says(text: string | undefined, outcome = 'allowed') {
  text = text || 'Something went wrong. Ask an adult.';
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
      void refresh(true);
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
async function refreshRules() {
  if (!connected) return;
  const out = await callTool('show_on_screen', { view: 'rules' });
  const frame = $('rules-frame') as HTMLIFrameElement;
  if (out.html && frame.srcdoc !== out.html) frame.srcdoc = out.html;
}
async function ruleCall(args: Record<string, unknown>) {
  const r = await callTool('set_rule', args);
  says(r.say, r.status === 'waiting' ? 'held' : 'denied');
  $('rule-preview').textContent = r.preview ?? '';
  if (r.status === 'waiting') void waitJob(r.challenge_id);
}
$('rule-save-maya').onclick = () => void ruleCall({ template: 'weekly_limit', person: 'maya', dollars: Number(($('rule-maya-limit') as HTMLInputElement).value) });
$('rule-quiet-on').onclick = () => void ruleCall({ template: 'quiet_hours', quiet_from_hour: 21, quiet_to_hour: 6 });
$('rule-quiet-off').onclick = () => void ruleCall({ template: 'quiet_hours', quiet_from_hour: null });
$('rule-undo').onclick = () => void ruleCall({ undo: true });
async function refreshConn() {
  if (!connected) return;
  const c = (await callTool('household_status', {})).connectors?.ride;
  if (!c) return;
  $('conn-status').textContent = c.health === 'broken' ? 'The ride service is not working.' : c.approval_owed ? 'Fixed. The next ride needs a yes.' : 'The ride service works.';
}
async function demoPost(path: string) {
  await connect();
  const res = await fetch(path, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { say?: string };
  return { ok: res.ok, ...body };
}
$('btn-break-ride').onclick = () => void demoPost('/demo/break-ride').then((r) => (r.ok ? says('The ride service shipped a new version.', 'held') : says(r.say ?? 'Only an adult can do that.', 'denied')));
$('btn-check-rides').onclick = () => void demoPost('/demo/check-rides').then((r) => (r.ok ? says(r.say ?? 'Checked.', 'allowed') : says(r.say ?? 'Only an adult can do that.', 'denied')));
let tick = 0;
let refreshing = false; // never start a round while the last one is still running
async function refresh(everything = false) { await Promise.all([refreshPhones(), refreshTimeline(), everything || tick++ % 5 === 0 ? refreshRules() : Promise.resolve(), refreshConn()]); } // the rules frame is redrawn right after anything that could change it, else every 5th round
setInterval(() => { if (refreshing || document.hidden) return; refreshing = true; void refresh().catch(() => undefined).finally(() => { refreshing = false; }); }, 2000);
($('tl-person') as HTMLSelectElement).onchange = () => void refreshTimeline();
($('tl-day') as HTMLSelectElement).onchange = () => void refreshTimeline();
$('btn-voice-summary').onclick = async () => {
  const r = await callTool('audit_log', { who: 'kids', when: 'this week' });
  const el = $('summary');
  el.hidden = false;
  el.textContent = r.say;
};


// ---- MCP Apps host: the house names a screen page (ui://…), we draw it in a sandboxed frame and carry its messages ----
const appFrame = $('app-frame') as HTMLIFrameElement;
const APP_TOOLS = new Set(['approve_request', 'show_on_screen']); // the only things a screen may ask for
let appHtml = '';
let appView = 'approvals';
async function openApp(view: string) {
  await connect();
  if (!appHtml) {
    const tools = (await rpc('tools/list')).result.tools as { name: string; _meta?: { ui?: { resourceUri?: string } } }[];
    const uri = tools.find((t) => t.name === 'show_on_screen')?._meta?.ui?.resourceUri;
    if (!uri) return says('I cannot show that screen.', 'denied');
    appHtml = (await rpc('resources/read', { uri })).result.contents[0].text;
  }
  appView = view;
  $('screen-note').textContent = view === 'connect' ? standInText : '';
  appFrame.srcdoc = appHtml; // a fresh page; it starts by saying hello and we answer below
}
const toApp = (m: Record<string, unknown>) => appFrame.contentWindow?.postMessage({ jsonrpc: '2.0', ...m }, '*');
let connectResult: unknown;
async function pushScreen() {
  if (appView === 'connect') return void toApp({ method: 'ui/notifications/tool-result', params: connectResult });
  const out = await rpc('tools/call', { name: 'show_on_screen', arguments: { view: appView } });
  toApp({ method: 'ui/notifications/tool-result', params: out.result });
}
window.addEventListener('message', (e) => {
  if (e.source !== appFrame.contentWindow) return;
  const m = e.data ?? {};
  if (m.method === 'ui/initialize') toApp({ id: m.id, result: { protocolVersion: '2025-11-21', hostInfo: { name: 'household-web-client', version: '1' }, hostCapabilities: { serverTools: {} }, hostContext: { theme: 'light' } } });
  else if (m.method === 'ui/notifications/initialized') void pushScreen();
  else if (m.method === 'tools/call' && APP_TOOLS.has(m.params?.name)) {
    void rpc('tools/call', m.params).then((out) => {
      toApp({ id: m.id, result: out.result ?? { isError: true, content: [{ type: 'text', text: 'Something went wrong. Ask an adult.' }] } });
      if (m.params.name === 'approve_request') setTimeout(() => void pushScreen(), 400);
    });
  } else if (m.id !== undefined) toApp({ id: m.id, error: { code: -32601, message: 'Not allowed' } });
});
$('btn-connect-spotify').onclick = async () => {
  await connect();
  const out = await rpc('tools/call', { name: 'connect_service', arguments: { toolkit: 'spotify' } });
  says(out.result?.structuredContent?.say ?? 'Something went wrong. Ask an adult.', out.result?.structuredContent?.link ? 'allowed' : 'held');
  if (!out.result?.structuredContent?.data) return;
  connectResult = out.result;
  void openApp('connect');
};
$('btn-allow-spotify').onclick = () => void ruleCall({ template: 'allowed_apps', services: ['sim-home', 'mock-ride', 'mock-shop', 'spotify'] });
// a long job: the answer is a job id at once; we ask again while it works and show the finished site as a screen with a code to scan
$('btn-build-site').onclick = async () => {
  const r = await callTool('request_action', { service: 'wix', action: 'build_site', item: 'a one-page site for my bakery, Sunny Bakery', request_id: `s${Date.now()}${Math.random()}` });
  says(r.say ?? r.reason, r.outcome);
  if (!r.job_id) return;
  for (let i = 0; i < 120; i++) {
    await new Promise((res) => setTimeout(res, 700));
    const out = await rpc('tools/call', { name: 'job_status', arguments: { job_id: r.job_id } });
    const j = out.result?.structuredContent;
    if (!j) continue;
    if (j.status === 'running') says(j.say, 'allowed');
    if (j.status === 'done') {
      says(j.say, 'allowed');
      if (j.data) { connectResult = out.result; void openApp('connect'); }
      return;
    }
    if (j.status === 'failed' || j.status === 'unknown') return says(j.say, 'denied');
  }
};
$('btn-play-jazz').onclick = async () => {
  const r = await callTool('request_action', { service: 'spotify', action: 'use_app', item: 'play jazz', request_id: `u${Date.now()}${Math.random()}` });
  says(r.say ?? r.reason, r.outcome);
};
$('btn-app-approvals').onclick = () => void openApp('approvals');
$('btn-app-orders').onclick = () => void openApp('orders');

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
  if (!args) return says("Sorry, I didn't get that. Try: turn off the lights, or book a ride.", 'held');
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
$('say').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void say(($('say') as HTMLInputElement).value); }); // typing and pressing Enter works like Send
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
