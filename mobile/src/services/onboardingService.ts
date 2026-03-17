import { API_CONFIG } from '../config/api';
import { logError } from './analyticsService';

const BASE = `${API_CONFIG.baseUrl}/onboarding/v1`;

// ─── Types ───

export interface WaitlistTaskItem {
  taskId: string;
  title: string;
  description?: string;
  xpReward: number;
  category: string;
  requiresTask?: string;
  metadata?: Record<string, any>;
  completed: boolean;
  locked: boolean;
}

export interface WaitlistTasksResponse {
  tasks: WaitlistTaskItem[];
  xp: number;
  rank: number;
}

export interface LeaderboardEntry {
  rank: number;
  xp: number;
  publicKey: string;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  userRank: number | null;
  userXp: number | null;
}

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

// ─── Waitlist ───

export async function registerWaitlist(publicKey: string): Promise<boolean> {
  const res = await fetch(`${BASE}/waitlist/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey }),
  });
  const data = await res.json();
  return data.success;
}

export async function getWaitlistTasks(publicKey: string): Promise<WaitlistTasksResponse> {
  const res = await fetch(`${BASE}/waitlist/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey }),
  });
  const data = await res.json();
  return { tasks: data.tasks, xp: data.xp, rank: data.rank };
}

export async function checkWaitlistStatus(publicKey: string): Promise<{ approved: boolean; inviteCode?: string }> {
  const res = await fetch(`${BASE}/waitlist/check-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey }),
  });
  const data = await res.json();
  return { approved: data.approved, inviteCode: data.inviteCode };
}

export async function getLeaderboard(publicKey?: string): Promise<LeaderboardResponse> {
  const url = publicKey ? `${BASE}/waitlist/leaderboard?publicKey=${publicKey}` : `${BASE}/waitlist/leaderboard`;
  const res = await fetch(url);
  const data = await res.json();
  return { leaderboard: data.leaderboard, userRank: data.userRank, userXp: data.userXp };
}

// ─── Email verification ───

export async function sendEmailCode(publicKey: string, email: string): Promise<boolean> {
  const res = await fetch(`${BASE}/waitlist/connect-email/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, email }),
  });
  const data = await res.json();
  return data.success;
}

export async function verifyEmailCode(publicKey: string, email: string, code: string): Promise<{ success: boolean; xpAwarded?: number }> {
  const res = await fetch(`${BASE}/waitlist/connect-email/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, email, code }),
  });
  const data = await res.json();
  return { success: data.success, xpAwarded: data.xpAwarded };
}

// ─── Wallet connect ───

export async function connectWallet(publicKey: string, walletAddress: string): Promise<{ success: boolean; xpAwarded?: number }> {
  try {
    const res = await fetch(`${BASE}/waitlist/connect-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey, walletAddress }),
    });
    if (!res.ok) return { success: false };
    const data = await res.json();
    return { success: data.success, xpAwarded: data.xpAwarded };
  } catch (err: any) {
    logError('onboarding_connect_wallet', err?.message || 'unknown');
    return { success: false };
  }
}

// ─── Social OAuth ───

export async function startConnectX(publicKey: string): Promise<{ authUrl: string } | null> {
  try {
    const res = await fetch(`${BASE}/waitlist/connect-x/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success) return null;
    return { authUrl: data.authUrl };
  } catch (err: any) {
    logError('onboarding_connect_x', err?.message || 'unknown');
    return null;
  }
}

export async function startConnectDiscord(publicKey: string): Promise<{ authUrl: string } | null> {
  try {
    const res = await fetch(`${BASE}/waitlist/connect-discord/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success) return null;
    return { authUrl: data.authUrl };
  } catch (err: any) {
    logError('onboarding_connect_discord', err?.message || 'unknown');
    return null;
  }
}

export async function startConnectTelegram(publicKey: string): Promise<{ code: string; botUrl: string } | null> {
  try {
    const res = await fetch(`${BASE}/waitlist/connect-telegram/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success) return null;
    return { code: data.code, botUrl: data.botUrl };
  } catch (err: any) {
    logError('onboarding_connect_telegram', err?.message || 'unknown');
    return null;
  }
}

// ─── Action verification ───

export async function verifyWaitlistAction(
  publicKey: string,
  taskId: string,
): Promise<{ verified: boolean; xpAwarded?: number; message?: string }> {
  const res = await fetch(`${BASE}/waitlist/verify-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, taskId }),
  });
  const data = await res.json();
  return { verified: data.verified ?? false, xpAwarded: data.xpAwarded, message: data.message };
}

// ─── Screenshot upload ───

export async function uploadScreenshot(
  publicKey: string,
  taskId: string,
  image: { uri: string; type: string; name: string },
): Promise<{ success: boolean; xpAwarded?: number }> {
  try {
    const formData = new FormData();
    formData.append('publicKey', publicKey);
    formData.append('taskId', taskId);
    formData.append('image', {
      uri: image.uri,
      type: image.type,
      name: image.name,
    } as any);

    const res = await fetch(`${BASE}/waitlist/upload-screenshot`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) return { success: false };
    const data = await res.json();
    return { success: data.success, xpAwarded: data.xpAwarded };
  } catch (err: any) {
    logError('onboarding_upload_screenshot', err?.message || 'unknown');
    return { success: false };
  }
}
