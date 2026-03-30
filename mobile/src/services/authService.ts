import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { API_CONFIG } from '../config/api';
import { APP_VERSION, BUILD_NUMBER } from '../config/version';
import { getCloudPublicKey, getDevicePublicKey, signWithCloud, signWithDevice } from './keypairStorage';
import { getVault } from './vaultStorage';
import { IS_SOLANA_MOBILE } from '../config/constants';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Re-authenticate 5 min before expiry

class AuthService {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private pendingInviteCode: string | null = null;

  /** Set an invite code to include in the next authentication request. */
  setInviteCode(code: string): void {
    this.pendingInviteCode = code;
  }

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
    const vault = await getVault();
    const seekerMode = IS_SOLANA_MOBILE;

    // Seeker: use device key for auth. Standard: use cloud key.
    const publicKey = seekerMode
      ? await getDevicePublicKey()
      : await getCloudPublicKey();
    if (!publicKey) {
      throw new Error(seekerMode
        ? 'No device key available — cannot authenticate'
        : 'No cloud key available — cannot authenticate');
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

    // Step 2: Sign the challenge (Seeker: device key, Standard: cloud key)
    const challengeBase64 = Buffer.from(challenge, 'utf-8').toString('base64');
    const signatureBase64 = seekerMode
      ? await signWithDevice(challengeBase64)
      : await signWithCloud(challengeBase64);

    // Step 3: Verify signature and get JWT (include device info for auth logging)
    const verifyRes = await fetch(`${API_CONFIG.baseUrl}/auth/v2/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey,
        challenge,
        signature: signatureBase64,
        vaultAddress: vault?.vaultAddress,
        ...(this.pendingInviteCode ? { inviteCode: this.pendingInviteCode } : {}),
        appVersion: APP_VERSION,
        buildNumber: BUILD_NUMBER,
        platform: Platform.OS,
        osVersion: DeviceInfo.getSystemVersion() || String(Platform.Version),
        device: `${DeviceInfo.getBrand() || Platform.OS} ${DeviceInfo.getModel() || ''}`.trim(),
      }),
    });

    if (!verifyRes.ok) {
      const errorBody = await verifyRes.json().catch(() => ({}));
      throw new Error(errorBody.error || `Verify request failed: ${verifyRes.status}`);
    }

    const { accessToken, expiresIn } = await verifyRes.json();

    this.accessToken = accessToken;
    this.tokenExpiresAt = Date.now() + expiresIn * 1000;
    this.pendingInviteCode = null;

    return accessToken;
  }
}

export default new AuthService();
