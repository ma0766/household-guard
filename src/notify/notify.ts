import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

// How an adult hears about a held request without a text-message number (US texts need a registered number).
export interface Email { to: string; subject: string; text: string }
export interface Notifier { send(e: Email): Promise<void> }

// Tests and the local demo: keeps what would have been sent.
export class MemoryNotifier implements Notifier {
  sent: Email[] = [];
  async send(e: Email): Promise<void> {
    this.sent.push(e);
  }
}

// Amazon SES. The sender address must be verified in SES first (see docs/PROGRESS.md).
export class SesNotifier implements Notifier {
  constructor(
    private client: Pick<SESv2Client, 'send'> = new SESv2Client({ region: process.env.AWS_REGION ?? 'us-east-1' }),
    private from = process.env.HG_EMAIL_FROM ?? '',
  ) {}
  async send(e: Email): Promise<void> {
    await this.client.send(new SendEmailCommand({ FromEmailAddress: this.from, Destination: { ToAddresses: [e.to] }, Content: { Simple: { Subject: { Data: e.subject }, Body: { Text: { Data: e.text } } } } }));
  }
}

export class NoNotifier implements Notifier {
  async send(): Promise<void> {
    /* nothing is set up to send mail */
  }
}

export const localOutbox = new MemoryNotifier(); // what the local demo "sent" (read by /demo/outbox)

export function defaultNotifier(): Notifier {
  if (process.env.HG_EMAIL_FROM) return new SesNotifier();
  return process.env.HG_LOCAL === '1' ? localOutbox : new NoNotifier();
}
