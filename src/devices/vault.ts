import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { Store } from '../core/store.js';

// A device key is typed only on the adult's phone. It is stored encrypted (AES-256-GCM), never in the log, never in an answer.
const secret = () => process.env.HG_VAULT_KEY || process.env.HG_TOKEN_SECRET || 'local-dev-vault-key-not-for-prod';
const aesKey = () => scryptSync(secret(), 'household-guard-device-vault', 32);
const sk = (service: string) => `DEVKEY#${service}`;

export function seal(plain: string): { iv: string; tag: string; ct: string } {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', aesKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
export function open(b: { iv: string; tag: string; ct: string }): string {
  const d = createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(b.iv, 'base64'));
  d.setAuthTag(Buffer.from(b.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(b.ct, 'base64')), d.final()]).toString('utf8');
}

export async function storeDeviceKey(store: Store, hh: string, service: string, key: string, by: string): Promise<void> {
  await store.put({ pk: Store.hk(hh), sk: sk(service), by, ...seal(key) });
}
export async function removeDeviceKey(store: Store, hh: string, service: string): Promise<void> {
  await store.delete(Store.hk(hh), sk(service)).catch(() => undefined);
}
export async function deviceKey(store: Store, hh: string, service: string): Promise<string | undefined> {
  const r = await store.get(Store.hk(hh), sk(service));
  if (!r) return undefined;
  try {
    return open(r as unknown as { iv: string; tag: string; ct: string });
  } catch {
    return undefined; // a key that will not open is no key: the device is held
  }
}
