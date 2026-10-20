import { spawn } from 'node:child_process';

// local stack: DynamoDB Local + API server (8016) + Vite dev client (8017)
const env = { ...process.env, HG_LOCAL: '1' };
const run = (cmd: string, args: string[]) => spawn(cmd, args, { stdio: 'inherit', env });
run('npx', ['tsx', 'watch', 'scripts/start-local.ts']);
run('npx', ['vite']);
