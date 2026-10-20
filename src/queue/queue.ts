import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// Slow work never runs in the reply path (500 ms rule). Same interface, two backends:
// SQS + worker Lambda in AWS, an in-process queue locally and in tests.
export interface JobMessage {
  hh: string;
  jobId: string;
}
export interface JobQueue {
  send(m: JobMessage): Promise<void>;
}

export class LocalQueue implements JobQueue {
  private running = new Set<Promise<unknown>>();
  constructor(private runner: (m: JobMessage) => Promise<unknown>) {}
  async send(m: JobMessage): Promise<void> {
    const p = Promise.resolve()
      .then(() => this.runner(m))
      .catch(() => undefined)
      .finally(() => this.running.delete(p));
    this.running.add(p);
  }
  // tests and the local server await this to know the worker finished
  async drain(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }
}

export class SqsQueue implements JobQueue {
  private client = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  constructor(private url: string) {}
  async send(m: JobMessage): Promise<void> {
    await this.client.send(new SendMessageCommand({ QueueUrl: this.url, MessageBody: JSON.stringify(m) }));
  }
}
