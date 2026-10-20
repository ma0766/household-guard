import { writeFileSync } from 'node:fs';
import { defaultRules, generatePolicies } from '../src/policy/rules.js';

// Writes the default rule files so they can be read (and diffed in review) without running code.
const render = (set: Record<string, string>) => Object.entries(set).map(([id, t]) => `@id(${JSON.stringify(id)})\n${t}`).join('\n\n') + '\n';
const sets = generatePolicies(defaultRules());
writeFileSync('src/policy/auto.cedar', render(sets.auto));
writeFileSync('src/policy/approvable.cedar', render(sets.approvable));
console.log('wrote src/policy/auto.cedar and approvable.cedar');
