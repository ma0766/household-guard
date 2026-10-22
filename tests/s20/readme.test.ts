import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

describe('README: "Where the code is"', () => {
  const readme = readFileSync('README.md', 'utf8');
  const section = readme.split('## Where the code is')[1]?.split('\n## ')[0] ?? '';
  it('names the MCP server, the decision engine and the tests', () => {
    expect(section).toMatch(/src\/mcp\/server\.ts/);
    expect(section).toMatch(/src\/core\/request-action\.ts/);
    expect(section).toMatch(/src\/policy\/rules\.ts/);
    expect(section).toMatch(/tests\/s20/);
  });
  it('every file it links to exists', () => {
    const paths = [...section.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(20);
    for (const p of paths) expect(existsSync(p), p).toBe(true);
  });
});
