let signingKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (signingKey) return signingKey;

  const base64 = process.env.RESPONSE_SIGNING_KEY;
  if (!base64) throw new Error('RESPONSE_SIGNING_KEY is required');

  const der = Buffer.from(base64, 'base64');
  signingKey = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  return signingKey;
}

/** Sign raw bytes with Ed25519. Returns base64 signature. */
export async function signResponseBytes(data: Uint8Array): Promise<string> {
  const key = await getSigningKey();
  const signature = await crypto.subtle.sign('Ed25519', key, data);
  return Buffer.from(signature).toString('base64');
}
