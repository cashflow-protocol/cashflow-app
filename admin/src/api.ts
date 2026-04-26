const API_URLS = {
  dev: 'https://api-dev.cashflow.fun',
  prod: 'https://api.cashflow.fun',
};

export type Env = 'dev' | 'prod';

export function getEnv(): Env {
  return (localStorage.getItem('admin_env') as Env) || 'dev';
}

export function setEnv(env: Env) {
  localStorage.setItem('admin_env', env);
}

function getApiBase() {
  return API_URLS[getEnv()];
}

function getToken(): string | null {
  return sessionStorage.getItem('admin_token');
}

function setToken(token: string) {
  sessionStorage.setItem('admin_token', token);
}

export function clearPassword() {
  sessionStorage.removeItem('admin_token');
}

export function isLoggedIn(): boolean {
  const token = getToken();
  if (!token) return false;
  // Check if token is expired (JWT payload is base64url-encoded)
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/**
 * Log in with admin password, receive a JWT session token.
 */
export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${getApiBase()}/admin/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (data.success && data.token) {
    setToken(data.token);
    return { success: true };
  }
  return { success: false, error: data.error || 'Login failed' };
}

// Keep old name for backwards compat in App.tsx
export function setPassword(_pw: string) {
  // No-op: use login() instead
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${getApiBase()}/admin/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    clearPassword();
    window.location.reload();
    throw new Error('Unauthorized');
  }

  return res.json();
}

// Invite codes
export async function getInviteCodes(page = 1, search = '') {
  const params = new URLSearchParams({ page: String(page), limit: '50' });
  if (search) params.set('search', search);
  return apiFetch(`/invite-codes?${params}`);
}

export async function generateCodes(count: number) {
  return apiFetch('/invite-codes/generate', {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
}

export async function createCustomCode(code: string, maxUses: number) {
  return apiFetch('/invite-codes/custom', {
    method: 'POST',
    body: JSON.stringify({ code, maxUses }),
  });
}

export async function deleteInviteCode(id: string) {
  return apiFetch(`/invite-codes/${id}`, { method: 'DELETE' });
}

// Waitlist tasks
export async function getWaitlistTasks() {
  return apiFetch('/waitlist-tasks');
}

export async function createWaitlistTask(task: {
  title: string;
  description?: string;
  xpReward: number;
  active?: boolean;
  sortOrder?: number;
  requiresTask?: string;
  category: string;
  metadata?: Record<string, any>;
}) {
  return apiFetch('/waitlist-tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  });
}

export async function updateWaitlistTask(id: string, updates: Record<string, any>) {
  return apiFetch(`/waitlist-tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteWaitlistTask(id: string) {
  return apiFetch(`/waitlist-tasks/${id}`, { method: 'DELETE' });
}

export async function exportWaitlistTasks() {
  return apiFetch('/waitlist-tasks/export');
}

export async function importWaitlistTasks(tasks: Record<string, any>[]) {
  return apiFetch('/waitlist-tasks/import', {
    method: 'POST',
    body: JSON.stringify({ tasks }),
  });
}

// Waitlist user actions
export async function getUserScreenshots(id: string) {
  return apiFetch(`/waitlist-users/${id}/screenshots`);
}

export async function revokeUserTask(id: string, taskId: string) {
  return apiFetch(`/waitlist-users/${id}/revoke-task`, {
    method: 'POST',
    body: JSON.stringify({ taskId }),
  });
}

// Waitlist users
export async function getWaitlistUsers(page = 1, search = '', sortBy = 'xp', sortDir = 'desc') {
  const params = new URLSearchParams({ page: String(page), limit: '50', sortBy, sortDir });
  if (search) params.set('search', search);
  return apiFetch(`/waitlist-users?${params}`);
}

// App users
export async function getAppUsers(page = 1, search = '') {
  const params = new URLSearchParams({ page: String(page), limit: '50' });
  if (search) params.set('search', search);
  return apiFetch(`/users?${params}`);
}

export async function sendUserNotification(userId: string, title: string, body?: string) {
  return apiFetch(`/users/${userId}/send-notification`, {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
}

export async function broadcastNotification(title: string, body?: string) {
  return apiFetch('/users/broadcast-notification', {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
}

// Earn tokens (vaults)
export interface EarnTokenFilters {
  types?: string[];
  coins?: string[];
  status?: string;
  minPoolSizeUsd?: string;
  maxPoolSizeUsd?: string;
}

export async function getEarnTokens(page = 1, search = '', filters: EarnTokenFilters = {}) {
  const params = new URLSearchParams({ page: String(page), limit: '50' });
  if (search) params.set('search', search);
  if (filters.types?.length) params.set('type', filters.types.join(','));
  if (filters.coins?.length) params.set('coin', filters.coins.join(','));
  if (filters.status) params.set('status', filters.status);
  if (filters.minPoolSizeUsd) params.set('minPoolSizeUsd', filters.minPoolSizeUsd);
  if (filters.maxPoolSizeUsd) params.set('maxPoolSizeUsd', filters.maxPoolSizeUsd);
  return apiFetch(`/earn-tokens?${params}`);
}

export async function updateEarnTokenStatus(id: string, status: 'active' | 'inactive') {
  return apiFetch(`/earn-tokens/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateEarnTokenConfig(id: string, config: { minDepositAmount?: string; minWithdrawAmount?: string }) {
  return apiFetch(`/earn-tokens/${id}/config`, {
    method: 'PATCH',
    body: JSON.stringify(config),
  });
}

// Stats
export async function getStats() {
  return apiFetch('/stats');
}

// Rewards
export type RewardVerifierType =
  | 'onchain_deposit'
  | 'onchain_swap_volume'
  | 'onchain_transfer_out'
  | 'device_seeker'
  | 'social_twitter_follow'
  | 'social_twitter_retweet'
  | 'manual';

export interface RewardTask {
  _id: string;
  slug: string;
  title: string;
  description: string;
  imageUrl: string;
  metadataUri: string;
  active: boolean;
  sortOrder: number;
  availableFrom?: string;
  availableUntil?: string;
  requiresTaskSlug?: string;
  mintFeeLamports: string;
  maxSupply?: number;
  mintedCount: number;
  verifierType: RewardVerifierType;
  verifierConfig?: Record<string, any>;
  createdAt?: string;
}

export interface RewardSettings {
  rewardsCollectionAddress: string | null;
  envDefaultCollectionAddress: string | null;
  treasuryWallet: string | null;
  cdnBaseUrl: string | null;
  storageConfigured: boolean;
}

export async function getRewardSettings(): Promise<{ success: boolean; settings: RewardSettings; error?: string }> {
  return apiFetch('/rewards/settings');
}

export async function updateRewardSettings(updates: { rewardsCollectionAddress?: string }) {
  return apiFetch('/rewards/settings', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function getRewardTasks(): Promise<{ success: boolean; tasks: RewardTask[]; error?: string }> {
  return apiFetch('/rewards/tasks');
}

export async function createRewardTask(task: Partial<RewardTask>) {
  return apiFetch('/rewards/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  });
}

export async function updateRewardTask(slug: string, updates: Partial<RewardTask>) {
  return apiFetch(`/rewards/tasks/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function diagnoseReward(vaultAddress: string, taskSlug: string) {
  const params = new URLSearchParams({ vaultAddress, taskSlug });
  return apiFetch(`/rewards/diagnose?${params.toString()}`);
}

export async function uploadRewardImage(file: File, slug?: string): Promise<{ success: boolean; url: string; key: string; error?: string }> {
  const token = sessionStorage.getItem('admin_token');
  const form = new FormData();
  form.append('image', file);
  if (slug) form.append('slug', slug);
  const res = await fetch(`${getApiBase()}/admin/v1/rewards/upload-image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (res.status === 401) {
    clearPassword();
    window.location.reload();
    throw new Error('Unauthorized');
  }
  return res.json();
}

export async function uploadRewardMetadata(slug: string, metadata: Record<string, any>) {
  return apiFetch('/rewards/upload-metadata', {
    method: 'POST',
    body: JSON.stringify({ slug, metadata }),
  });
}

export async function createRewardsCollection(input: {
  name: string;
  description?: string;
  imageUrl?: string;
  externalUrl?: string;
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; address?: string; metadataUri?: string; signature?: string; error?: string }> {
  return apiFetch('/rewards/create-collection', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
