import crypto from 'crypto';
import axios from 'axios';

// ─── Environment ───

const TWITTER_CLIENT_ID = () => process.env.TWITTER_CLIENT_ID;
const TWITTER_CLIENT_SECRET = () => process.env.TWITTER_CLIENT_SECRET;
const TWITTER_BEARER_TOKEN = () => process.env.TWITTER_BEARER_TOKEN;
const DISCORD_CLIENT_ID = () => process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = () => process.env.DISCORD_CLIENT_SECRET;
const BACKEND_URL = process.env.BACKEND_URL || 'https://api.cashflow.fun';
const OAUTH_CALLBACK_BASE = BACKEND_URL + '/onboarding/v1';

// ─── Twitter OAuth 2.0 with PKCE ───

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function generateTwitterOAuthUrl(state: string, codeVerifier: string): string | null {
  const clientId = TWITTER_CLIENT_ID();
  if (!clientId) return null;

  const challenge = generateCodeChallenge(codeVerifier);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `${OAUTH_CALLBACK_BASE}/waitlist/connect-x/callback`,
    scope: 'tweet.read users.read follows.read offline.access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return `https://x.com/i/oauth2/authorize?${params.toString()}`;
}

export async function exchangeTwitterCode(
  code: string,
  codeVerifier: string,
): Promise<{ id: string; username: string; accessToken: string; refreshToken: string } | null> {
  const clientId = TWITTER_CLIENT_ID();
  const clientSecret = TWITTER_CLIENT_SECRET();
  if (!clientId || !clientSecret) return null;

  // Exchange code for token
  const tokenRes = await axios.post(
    'https://api.x.com/2/oauth2/token',
    new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: `${OAUTH_CALLBACK_BASE}/waitlist/connect-x/callback`,
      code_verifier: codeVerifier,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
    },
  );

  const accessToken = tokenRes.data.access_token;
  const refreshToken = tokenRes.data.refresh_token;

  // Get user info
  const userRes = await axios.get('https://api.x.com/2/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return {
    id: userRes.data.data.id,
    username: userRes.data.data.username,
    accessToken,
    refreshToken,
  };
}

export async function refreshTwitterToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const clientId = TWITTER_CLIENT_ID();
  const clientSecret = TWITTER_CLIENT_SECRET();
  if (!clientId || !clientSecret) return null;

  const tokenRes = await axios.post(
    'https://api.x.com/2/oauth2/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
    },
  );

  return {
    accessToken: tokenRes.data.access_token,
    refreshToken: tokenRes.data.refresh_token,
  };
}

export async function checkTwitterFollow(
  accessToken: string,
  sourceUserId: string,
  targetUsername: string,
): Promise<boolean> {
  // Get target user ID
  const targetRes = await axios.get(
    `https://api.x.com/2/users/by/username/${targetUsername}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const targetId = targetRes.data?.data?.id;
  if (!targetId) return false;

  // Check if source follows target
  const followRes = await axios.get(
    `https://api.x.com/2/users/${sourceUserId}/following`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { max_results: 1000 },
    },
  );

  const following = followRes.data?.data || [];
  return following.some((u: any) => u.id === targetId);
}

export async function checkTwitterRetweet(
  tweetId: string,
  userId: string,
): Promise<boolean> {
  const bearer = TWITTER_BEARER_TOKEN();
  if (!bearer) return false;

  const res = await axios.get(
    `https://api.x.com/2/tweets/${tweetId}/retweeted_by`,
    {
      headers: { Authorization: `Bearer ${bearer}` },
      params: { max_results: 100 },
    },
  );

  const users = res.data?.data || [];
  return users.some((u: any) => u.id === userId);
}

// ─── Discord OAuth2 ───

export function generateDiscordOAuthUrl(state: string): string | null {
  const clientId = DISCORD_CLIENT_ID();
  if (!clientId) return null;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `${OAUTH_CALLBACK_BASE}/waitlist/connect-discord/callback`,
    scope: 'identify',
    state,
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeDiscordCode(
  code: string,
): Promise<{ id: string; username: string } | null> {
  const clientId = DISCORD_CLIENT_ID();
  const clientSecret = DISCORD_CLIENT_SECRET();
  if (!clientId || !clientSecret) return null;

  const tokenRes = await axios.post(
    'https://discord.com/api/oauth2/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${OAUTH_CALLBACK_BASE}/waitlist/connect-discord/callback`,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  const accessToken = tokenRes.data.access_token;

  const userRes = await axios.get('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return {
    id: userRes.data.id,
    username: userRes.data.username,
  };
}

