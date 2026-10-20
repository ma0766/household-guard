import { execFileSync } from 'node:child_process';
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

export const LOCAL_DDB_ENDPOINT = process.env.DDB_ENDPOINT ?? 'http://127.0.0.1:8018';
export const TABLE = process.env.HG_TABLE ?? 'household-guard';

function sh(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function localClient(): DynamoDBClient {
  return new DynamoDBClient({
    endpoint: LOCAL_DDB_ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
}

// idempotent: start the container if missing, then create the single table if missing
export async function ensureLocalDynamo(): Promise<void> {
  const running = sh(['ps', '--filter', 'name=^hg-ddb$', '--format', '{{.Status}}']);
  if (!running) {
    const exists = sh(['ps', '-a', '--filter', 'name=^hg-ddb$', '--format', '{{.Status}}']);
    if (exists) sh(['start', 'hg-ddb']);
    else sh(['run', '-d', '--name', 'hg-ddb', '-p', '127.0.0.1:8018:8000', 'amazon/dynamodb-local:latest', '-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb']);
  }
  const c = localClient();
  for (let i = 0; i < 60; i++) {
    try {
      await c.send(new DescribeTableCommand({ TableName: TABLE }));
      return;
    } catch (e: any) {
      if (e?.name === 'ResourceNotFoundException') {
        await c.send(
          new CreateTableCommand({
            TableName: TABLE,
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [
              { AttributeName: 'pk', AttributeType: 'S' },
              { AttributeName: 'sk', AttributeType: 'S' },
            ],
            KeySchema: [
              { AttributeName: 'pk', KeyType: 'HASH' },
              { AttributeName: 'sk', KeyType: 'RANGE' },
            ],
          }),
        ).catch(() => undefined);
        continue;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('DynamoDB Local did not come up');
}
