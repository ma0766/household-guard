// npm run demo:reset: put the demo house back to the same starting point (local table).
process.env.HG_RISK ??= 'mock';
process.env.HG_LOCAL = '1'; // never touches the cloud table
import { ensureLocalDynamo } from '../src/core/local-dynamo.js';
import { defaultStore } from '../src/core/store.js';
import { resetDemoHousehold } from '../src/core/household.js';

await ensureLocalDynamo();
const r = await resetDemoHousehold(defaultStore(), process.argv[2] ?? 'demo');
console.log(`Demo house reset (${r.removed} old rows removed). People: ${r.people.join(', ')}.`);
console.log("Leo's PIN is 4821. Start the app with: npm run dev");
