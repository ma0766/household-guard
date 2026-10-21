import { Store } from '../src/core/store.js';
import { localClient } from '../src/core/local-dynamo.js';
import { defaultStore } from '../src/core/store.js';
import { verifyAudit } from '../src/audit/audit.js';

// usage: npm run audit:verify -- <household> [--local]
// exits 1 and names the first bad entry if any row was edited, removed or the end was cut off
const hh = process.argv[2] ?? 'demo';
const store = process.argv.includes('--local') || process.env.HG_LOCAL === '1' ? new Store(localClient()) : defaultStore();
const r = await verifyAudit(store, hh);
if (r.ok) {
  console.log(`audit log OK: ${r.checked} entries${r.anchored ? '' : ' (oldest entry not anchored to a checkpoint)'}`);
} else {
  console.log(`audit log BROKEN at entry ${r.badSeq}: ${r.reason}`);
  // the fingerprints are keyed: with the wrong key a clean log also looks edited. Say so, so nobody raises a false alarm.
  if (!process.env.HG_AUDIT_KEY && !process.env.HG_TOKEN_SECRET) console.log('Note: no key is set (HG_AUDIT_KEY or HG_TOKEN_SECRET). If this log was made with a real key, a clean log also looks edited without it. Set the key the stack uses and run this again.');
  process.exit(1);
}
