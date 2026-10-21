import { execFileSync } from 'node:child_process';

// Which deployment are we talking about? The submitted entry is stage "prod" and only main may change it.
// Everything else goes to the separate "roadmap" stage (its own stack, table and URL).
export function currentStage(): { stage: string; stack: string; envFile: string } {
  const branch = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  })();
  const stage = process.env.STAGE ?? (branch === 'main' ? 'prod' : 'roadmap');
  if (stage === 'prod' && branch !== 'main') throw new Error(`Refusing: stage prod (the submitted entry) can only be deployed from main, not from ${branch}.`);
  return { stage, stack: stage === 'prod' ? 'HouseholdGuard' : `HouseholdGuard-${stage}`, envFile: stage === 'prod' ? '.env.deploy' : `.env.deploy.${stage}` };
}
