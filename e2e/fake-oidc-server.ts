import { startFakeOidc } from '../tests/fake-oidc.js';

// A stand-in for the sign-in server, for the browser tests only (port 8019, claimed in ~/.claude/ports.md).
await startFakeOidc(8019);
console.log('fake sign-in server on :8019');
setInterval(() => undefined, 1 << 30);
