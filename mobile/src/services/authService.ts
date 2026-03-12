import { API_CONFIG } from '../config/api';
import { getCloudPublicKey, signWithCloud } from './keypairStorage';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Re-authenticate 5 min before expiry

class AuthService {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  /** Get a valid access token, silently authenticating if needed. */
  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.accessToken;
    }
    return this.authenticate();
  }

  /** Clear the cached token (call on 401 to force re-auth). */
  clearToken(): void {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  private async authenticate(): Promise<string> {
    const publicKey = await getCloudPublicKey();
    if (!publicKey) {
      throw new Error('No cloud key available — cannot authenticate');
    }

    // Step 1: Get challenge from server
    const challengeRes = await fetch(`${API_CONFIG.baseUrl}/auth/v2/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey }),
    });

    if (!challengeRes.ok) {
      throw new Error(`Challenge request failed: ${challengeRes.status}`);
    }

    const { challenge } = await challengeRes.json();

    // Step 2: Sign the challenge with the cloud keypair (native module)
    const challengeBase64 = Buffer.from(challenge, 'utf-8').toString('base64');
    const signatureBase64 = await signWithCloud(challengeBase64);

    // Step 3: Verify signature and get JWT
    const verifyRes = await fetch(`${API_CONFIG.baseUrl}/auth/v2/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey, challenge, signature: signatureBase64 }),
    });

    if (!verifyRes.ok) {
      const errorBody = await verifyRes.json().catch(() => ({}));
      throw new Error(errorBody.error || `Verify request failed: ${verifyRes.status}`);
    }

    const { accessToken, expiresIn } = await verifyRes.json();

    this.accessToken = accessToken;
    this.tokenExpiresAt = Date.now() + expiresIn * 1000;

    return accessToken;
  }
}

export default new AuthService();
