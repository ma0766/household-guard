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
// worker: no rules engine needed (decisions were made before the job was queued)
await build({ entryPoints: ['src/worker-lambda.ts'], outfile: 'dist/worker/index.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, external: ['@aws-sdk/*'], banner: { js: "import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);" } });
cpSync('node_modules/@cedar-policy/cedar-wasm', 'dist/lambda/node_modules/@cedar-policy/cedar-wasm', { recursive: true });
cpSync('dist/web', 'dist/lambda/web', { recursive: true });
writeFileSync('dist/lambda/run.sh', '#!/bin/sh\nexec node index.mjs\n');
chmodSync('dist/lambda/run.sh', 0o755);
console.log('lambda bundle ready');
