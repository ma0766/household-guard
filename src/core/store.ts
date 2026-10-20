import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE, localClient } from './local-dynamo.js';

export type Item = Record<string, any> & { pk: string; sk: string };

// Single-table access: pk = H#<household>, sk = <KIND>#<id>. Thin on purpose — every error propagates,
// and callers turn errors into "hold", never "allow".
export class Store {
  readonly doc: DynamoDBDocumentClient;
  constructor(readonly client: DynamoDBClient, readonly table = TABLE) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }
  static hk = (hh: string) => `H#${hh}`;

  async get(pk: string, sk: string): Promise<Item | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk, sk }, ConsistentRead: true }));
    return r.Item as Item | undefined;
  }
  async put(item: Item, opts: { ifNotExists?: boolean; ifVersion?: number } = {}): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: item,
        ...(opts.ifNotExists ? { ConditionExpression: 'attribute_not_exists(pk)' } : {}),
        ...(opts.ifVersion !== undefined ? { ConditionExpression: 'v = :v', ExpressionAttributeValues: { ':v': opts.ifVersion } } : {}),
      }),
    );
  }
  async delete(pk: string, sk: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { pk, sk } }));
  }
  async query(pk: string, skPrefix: string, opts: { reverse?: boolean; limit?: number } = {}): Promise<Item[]> {
    const out: Item[] = [];
    let key: Record<string, any> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
          ExpressionAttributeValues: { ':p': pk, ':s': skPrefix },
          ConsistentRead: true,
          ScanIndexForward: !opts.reverse,
          Limit: opts.limit,
          ExclusiveStartKey: key,
        }),
      );
      out.push(...(r.Items as Item[]));
      key = r.LastEvaluatedKey;
      if (opts.limit && out.length >= opts.limit) return out.slice(0, opts.limit);
    } while (key);
    return out;
  }
  update(params: Omit<ConstructorParameters<typeof UpdateCommand>[0], 'TableName'>) {
    return this.doc.send(new UpdateCommand({ TableName: this.table, ...params }));
  }
  transact(items: any[], clientRequestToken?: string) {
    return this.doc.send(new TransactWriteCommand({ TransactItems: items, ClientRequestToken: clientRequestToken }));
  }
}

export function defaultStore(): Store {
  if (process.env.HG_LOCAL === '1' || process.env.DDB_ENDPOINT) return new Store(localClient());
  return new Store(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' }));
}
