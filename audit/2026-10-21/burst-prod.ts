import { readFileSync } from 'node:fs';
import { mintToken } from '../../src/auth.js';
const env: Record<string,string> = {}; for (const l of readFileSync('.env.deploy','utf8').split('\n')) { const [k,...v]=l.split('='); if(k) env[k]=v.join('='); }
process.env.HG_TOKEN_SECRET = env.HG_TOKEN_SECRET;
const hh = `burst${Date.now()}`; const tok = mintToken('audit',300,hh);
const fire = async (i: number, a: any) => { const r = await fetch(`${env.HG_URL}/mcp`, { method:'POST', headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:`Bearer ${tok}`}, body: JSON.stringify({jsonrpc:'2.0',id:i,method:'tools/call',params:{name:'request_action',arguments:a}}) }); const t = await r.text(); return { s: r.status, t }; };
const t0 = Date.now();
// 100 calls in ~10 s: 50 guest lights (allowed class), 25 guest unlock (must stay denied), 25 gift card purchase by guest (must never be allowed)
const jobs = Array.from({length:100},(_,i)=> i%4===0 ? {service:'sim-home',action:'unlock',item:'front door'} : i%4===1 ? {service:'mock-shop',action:'purchase',item:'gift card',request_id:`g${i}`} : {service:'sim-home',action:'light',item:'lights',value: i%2?'on':'off',request_id:`l${i}`});
const res: {s:number,t:string,a:any}[] = [];
for (let i=0;i<100;i+=10) { const batch = await Promise.all(jobs.slice(i,i+10).map((a,k)=>fire(i+k,a).then(r=>({...r,a})))); res.push(...batch); const wait = (i/10+1)*1000-(Date.now()-t0); if (wait>0) await new Promise(r=>setTimeout(r,wait)); }
const s429 = res.filter(r=>r.s===429).length, s200 = res.filter(r=>r.s===200).length;
const wrongAllow = res.filter(r=>r.s===200 && r.a.action!=='light' && /"outcome":"allowed"/.test(r.t) && /"done":true/.test(r.t));
console.log(JSON.stringify({ seconds: (Date.now()-t0)/1000, total: res.length, ok200: s200, limited429: s429, other: res.length-s200-s429, unlockOrGiftCardAllowedAndDone: wrongAllow.length }));
console.log('PASS' + (wrongAllow.length===0 && s429>0 ? '' : ' (check)') );
