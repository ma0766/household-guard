import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

// The first deploy shipped a worker that crashed on start (a library needed a file the bundle did not carry).
// This builds both Lambda bundles and loads each one the way Lambda does.
describe('S3 the worker bundle starts', () => {
  it('web and worker bundles both load and export what Lambda calls', () => {
    execFileSync('npx', ['tsx', 'scripts/build-lambda.ts'], { stdio: 'pipe' });
    const worker = execFileSync('node', ['-e', "import('./index.mjs').then(m=>console.log(typeof m.handler))"], { cwd: 'dist/worker' }).toString().trim();
    expect(worker).toBe('function');
  }, 180000);
});
