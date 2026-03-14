import { API_CONFIG } from '../config/api';

const BASE = `${API_CONFIG.baseUrl}/onboarding/v1`;

export async function validateInviteCode(code: string): Promise<boolean> {
  const res = await fetch(`${BASE}/validate-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  return data.success && data.valid;
}

export async function redeemInviteCode(code: string, publicKey: string): Promise<boolean> {
  const res = await fetch(`${BASE}/redeem-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, publicKey }),
  });
  const data = await res.json();
  return data.success;
}
