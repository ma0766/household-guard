import { ensureLocalDynamo } from '../src/core/local-dynamo.js';
import { createApp } from '../src/server.js';

await ensureLocalDynamo();
createApp().listen(8016, '127.0.0.1', () => console.log('Household Guard on :8016'));
