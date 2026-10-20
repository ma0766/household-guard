import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// .env.deploy is gitignored (.env*) — the signing secret never reaches git
const ENV_FILE = '.env.deploy';
const env: Record<string, string> = {};
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) env[k] = v.join('='); }
env.HG_TOKEN_SECRET ||= randomBytes(32).toString('hex');
writeFileSync(ENV_FILE, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

execFileSync('npx', ['tsx', 'scripts/build-lambda.ts'], { stdio: 'inherit' });
execFileSync('npx', ['cdk', 'deploy', '--require-approval', 'never', '--outputs-file', 'dist/cdk-outputs.json'], {
  stdio: 'inherit',
  env: { ...process.env, HG_TOKEN_SECRET: env.HG_TOKEN_SECRET },
});
const out = JSON.parse(readFileSync('dist/cdk-outputs.json', 'utf8')).HouseholdGuard;
env.HG_URL = out.Url.replace(/\/$/, '');
writeFileSync(ENV_FILE, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
console.log(`deployed: ${env.HG_URL}`);
