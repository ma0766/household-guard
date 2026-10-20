// Browser MCP client: plain fetch against the Streamable HTTP endpoint (stateless, JSON responses)
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
let token = '';
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
  token = (await (await fetch(`/demo-token?hh=${encodeURIComponent(new URLSearchParams(location.search).get('hh') ?? 'demo')}`)).json()).token;
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
  { id: 'mom', name: 'Mom' },
  { id: 'maya', name: 'Maya' },
  { id: 'leo', name: 'Leo' },
  { id: 'guest', name: 'Guest' },
];
let speaker = 'guest';
const speakersEl = $('speakers');
for (const p of PEOPLE) {
  const b = document.createElement('button');
  b.className = 'secondary who';
  b.setAttribute('data-testid', `who-${p.id}`);
  b.textContent = p.name;
  b.onclick = async () => {
    await connect();
    await fetch('/dev/session', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ person: p.id }) });
    speaker = p.id;
    document.querySelectorAll('.who').forEach((e) => e.classList.toggle('active', e === b));
  };
  speakersEl.appendChild(b);
}

// ---- words → one tool call ----
function parse(text: string): Record<string, unknown> | undefined {
  const t = text.toLowerCase();
  const num = t.match(/(\d{2,3})/)?.[1];
  if (/delete .*account/.test(t)) return { service: 'sim-home', action: 'delete_account' };
  if (/unlock/.test(t)) return { service: 'sim-home', action: 'unlock', item: 'front door' };
  if (/garage/.test(t)) return { service: 'sim-home', action: 'garage', item: 'garage', value: 'open' };
  if (/thermostat|degrees|temperature/.test(t)) return { service: 'sim-home', action: 'thermostat', item: 'thermostat', value: Number(num ?? 72) };
  if (/light/.test(t)) return { service: 'sim-home', action: 'light', item: 'lights', value: /\boff\b/.test(t) ? 'off' : 'on' };
  return undefined;
}

const saysEl = $('alexa-says');
async function say(text: string) {
  const args = parse(text);
  if (!args) {
    saysEl.textContent = "Sorry, I didn't get that.";
    saysEl.className = 'says';
    return;
  }
  const r = await callTool('request_action', args);
  saysEl.textContent = r.say ?? r.reason;
  saysEl.className = `says ${r.outcome === 'allowed' ? '' : r.outcome}`;
  saysEl.dataset.outcome = r.outcome;
  if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(saysEl.textContent!));
  return r;
}

const QUICK = ['Turn off the lights', 'Unlock the front door', 'Delete my account', 'Set the thermostat to 72'];
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
void speaker;
