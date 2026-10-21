import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// small bundle = faster cold start. Cedar's wasm is read from disk at runtime, so it ships as a real node_module.
rmSync('dist/lambda', { recursive: true, force: true });
mkdirSync('dist/lambda', { recursive: true });
execFileSync('npx', ['vite', 'build'], { stdio: 'inherit' });
await build({
  entryPoints: ['src/lambda-web.ts'],
  outfile: 'dist/lambda/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  external: ['@cedar-policy/cedar-wasm', '@cedar-policy/cedar-wasm/nodejs', '@aws-sdk/*'],
  banner: { js: "import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);" },
});
// worker: the job code still imports the rules engine, so it ships Cedar as a real node_module too
await build({ entryPoints: ['src/worker-lambda.ts'], outfile: 'dist/worker/index.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, external: ['@cedar-policy/cedar-wasm', '@cedar-policy/cedar-wasm/nodejs', '@aws-sdk/*'], banner: { js: "import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);" } });
// heal: the scheduled health check (src/heal-lambda.ts)
await build({ entryPoints: ['src/heal-lambda.ts'], outfile: 'dist/heal/index.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, external: ['@cedar-policy/cedar-wasm', '@cedar-policy/cedar-wasm/nodejs', '@aws-sdk/*'], banner: { js: "import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);" } });
// gateway: the AgentCore Gateway's tool target (src/gateway-lambda.ts)
await build({ entryPoints: ['src/gateway-lambda.ts'], outfile: 'dist/gateway/index.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, external: ['@cedar-policy/cedar-wasm', '@cedar-policy/cedar-wasm/nodejs', '@aws-sdk/*'], banner: { js: "import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);" } });
cpSync('node_modules/@cedar-policy/cedar-wasm', 'dist/gateway/node_modules/@cedar-policy/cedar-wasm', { recursive: true });
cpSync('node_modules/@cedar-policy/cedar-wasm', 'dist/heal/node_modules/@cedar-policy/cedar-wasm', { recursive: true });
cpSync('node_modules/@cedar-policy/cedar-wasm', 'dist/lambda/node_modules/@cedar-policy/cedar-wasm', { recursive: true });
cpSync('node_modules/@cedar-policy/cedar-wasm', 'dist/worker/node_modules/@cedar-policy/cedar-wasm', { recursive: true });
cpSync('dist/web', 'dist/lambda/web', { recursive: true });
writeFileSync('dist/lambda/run.sh', '#!/bin/sh\nexec node index.mjs\n');
chmodSync('dist/lambda/run.sh', 0o755);
console.log('lambda bundle ready');
