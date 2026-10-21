import { defaultStore } from '../../src/core/store.js';
import { resetDemoHousehold } from '../../src/core/household.js';
// Makes (or resets) a SEPARATE demo household in the cloud table for the recorded prod run. It touches only this one house.
const hh = process.argv[2] ?? 'demoaudit';
console.log(JSON.stringify(await resetDemoHousehold(defaultStore(), hh)));
