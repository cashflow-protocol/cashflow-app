import { API_CONFIG } from '../config/api';

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
