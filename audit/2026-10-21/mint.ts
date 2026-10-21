import { readFileSync } from 'node:fs';
import { mintToken } from '../../src/auth.js';
const env: Record<string,string> = {};
for (const l of readFileSync('.env.deploy','utf8').split('\n')) { const [k,...v]=l.split('='); if(k) env[k]=v.join('='); }
process.env.HG_TOKEN_SECRET = env.HG_TOKEN_SECRET;
process.stdout.write(env.HG_URL+' '+mintToken('audit',900,`audit${Date.now()}`));
