import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { currentStage } from './stage.js';

// .env.deploy* is gitignored (.env*) — secrets never reach git. Each stage has its own file and its own signing secret.
const { stage, stack, envFile: ENV_FILE } = currentStage();
console.log(`stage: ${stage} (stack ${stack})`);
const env: Record<string, string> = {};
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) env[k] = v.join('='); }
env.HG_TOKEN_SECRET ||= randomBytes(32).toString('hex');
const save = () => writeFileSync(ENV_FILE, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
save();

execFileSync('npx', ['tsx', 'scripts/build-lambda.ts'], { stdio: 'inherit' });

function cdkDeploy() {
  // context from the stage's env file: the public address (for email links and sign-in callbacks), the verified sender, the adult's address
  const ctx = [['webUrl', env.HG_URL], ['emailFrom', env.HG_EMAIL_FROM], ['approverEmail', env.HG_APPROVER_EMAIL], ['alexaVendorId', env.HG_ALEXA_VENDOR_ID]].filter(([, v]) => v).flatMap(([k, v]) => ['-c', `${k}=${v}`]);
  execFileSync('npx', ['cdk', 'deploy', stack, '-c', `stage=${stage}`, ...ctx, ...(process.env.DEPLOY_ARGS ? process.env.DEPLOY_ARGS.split(' ') : []), '--require-approval', 'never', '--outputs-file', 'dist/cdk-outputs.json'], { stdio: 'inherit', env: { ...process.env, HG_TOKEN_SECRET: env.HG_TOKEN_SECRET } });
  return JSON.parse(readFileSync('dist/cdk-outputs.json', 'utf8'))[stack] as Record<string, string>;
}

let out = cdkDeploy();
const url = out.Url.replace(/\/$/, '');
if (env.HG_URL !== url) {
  // first deploy of this stage: the sign-in callback and the email links need the address, which only exists now. Deploy once more.
  env.HG_URL = url;
  save();
  out = cdkDeploy();
}
Object.assign(env, { HG_POOL_ID: out.UserPoolId, HG_WEB_CLIENT_ID: out.WebClientId, HG_SERVICE_CLIENT_ID: out.ServiceClientId, HG_SIGN_IN_DOMAIN: out.SignInDomain });

// a family account to sign in with (created once; the password stays in the gitignored env file)
if (out.UserPoolId && !env.HG_TEST_PASSWORD) {
  const aws = (...a: string[]) => spawnSync('aws', [...a, '--region', 'us-east-1', '--output', 'json'], { encoding: 'utf8' });
  const user = 'family@example.test';
  const password = `Hg-${randomBytes(9).toString('base64url')}-9z`;
  const made = aws('cognito-idp', 'admin-create-user', '--user-pool-id', out.UserPoolId, '--username', user, '--message-action', 'SUPPRESS', '--temporary-password', password);
  if (made.status === 0 || /UsernameExistsException/.test(made.stderr)) {
    aws('cognito-idp', 'admin-set-user-password', '--user-pool-id', out.UserPoolId, '--username', user, '--password', password, '--permanent');
    aws('cognito-idp', 'admin-add-user-to-group', '--user-pool-id', out.UserPoolId, '--username', user, '--group-name', 'hh-demo');
    Object.assign(env, { HG_TEST_USER: user, HG_TEST_PASSWORD: password });
  } else console.error('could not create the test family account:', made.stderr.slice(0, 200));
}
save();
console.log(`deployed: ${env.HG_URL}`);
