import { readFileSync } from 'node:fs';
import { mintToken } from '../../src/auth.js';
const env: Record<string,string> = {};
for (const l of readFileSync('.env.deploy','utf8').split('\n')) { const [k,...v]=l.split('='); if(k) env[k]=v.join('='); }
process.env.HG_TOKEN_SECRET = env.HG_TOKEN_SECRET;
const hh = `audit${Date.now()}`; const tok = mintToken('audit',300,hh);
const post = async (body:unknown)=>{const t=performance.now();const r=await fetch(`${env.HG_URL}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:`Bearer ${tok}`},body:JSON.stringify(body)});await r.text();return {ms:performance.now()-t,s:r.status};};
const call=(i:number,n:string,a:unknown)=>({jsonrpc:'2.0',id:i,method:'tools/call',params:{name:n,arguments:a}});
const pct=(x:number[],p:number)=>[...x].sort((a,b)=>a-b)[Math.min(x.length-1,Math.floor(p/100*x.length))];
const cold = await post(call(0,'household_status',{}));
console.log('first call (maybe cold) ms', Math.round(cold.ms));
for (const [name,args] of [['household_status',{}],['request_action',{service:'sim-home',action:'light',item:'lights',value:'on'}],['audit_log',{}]] as const) {
  const ms:number[]=[]; let bad=0;
  for(let i=1;i<=50;i++){const r=await post(call(i,name,{...args,...(name==='request_action'?{request_id:`a${Date.now()}${i}`}:{})}));ms.push(r.ms);if(r.s!==200)bad++;}
  console.log(name,'n=50 bad=',bad,'p50',Math.round(pct(ms,50)),'p95',Math.round(pct(ms,95)),'max',Math.round(Math.max(...ms)));
}
