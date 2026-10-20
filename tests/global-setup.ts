import { ensureLocalDynamo } from '../src/core/local-dynamo.js';

// DynamoDB Local in Docker — real conditional writes, so the cap race is proven, not faked
export default async function setup() {
  await ensureLocalDynamo();
}
