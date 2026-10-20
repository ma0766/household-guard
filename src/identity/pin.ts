import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// scrypt: memory-hard, so a stolen table of 4-digit PINs still costs real time per guess. Stored as scrypt$salt$hash.
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, 32).toString('hex')}`;
}

export function verifyPin(pin: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'hex');
  const got = scryptSync(pin, Buffer.from(salt, 'hex'), 32);
  return got.length === want.length && timingSafeEqual(got, want);
}
