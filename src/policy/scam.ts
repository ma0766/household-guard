// The scam guard: some buys are what scammers ask for. They always need an adult's tap, whatever the limit.
// Gift cards, crypto, wire transfers, and money sent to someone this house has never paid before.
export type ScamKind = 'gift card' | 'crypto' | 'wire transfer' | 'new payee';

export function scamKindOf(item: string, payee?: string, payeeKnown = true): ScamKind | undefined {
  if (item === 'gift card') return 'gift card';
  if (item === 'crypto') return 'crypto';
  if (item === 'wire transfer') return 'wire transfer';
  if (payee && !payeeKnown) return 'new payee';
  return undefined;
}
