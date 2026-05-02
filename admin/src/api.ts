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

export async function backfillUserVault() {
  return apiFetch('/rewards/backfill-user-vault', { method: 'POST' });
}

export async function resetMintedProgress() {
  return apiFetch('/rewards/reset-minted-progress', { method: 'POST' });
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

// Maintenance
export interface BackfillUserVaultReport {
  dryRun: boolean;
  scanned: number;
  mapped: number;
  unmapped: number;
  unmappedSample: Array<{ address: string; count: number }>;
  mappingSourceCount: number;
}

export interface RebuildCostBasisReport {
  dryRun: boolean;
  aggregatedKeys: number;
  wouldCreate: number;
  wouldUpdate: number;
  unchanged: number;
  totalDepositsScanned: number;
  totalWithdrawalsScanned: number;
  ignoredMissingVault: number;
}

export async function backfillUserVaultAddress(
  dryRun: boolean,
): Promise<{ success: boolean; report: BackfillUserVaultReport; error?: string }> {
  return apiFetch('/maintenance/backfill-user-vault-address', {
    method: 'POST',
    body: JSON.stringify({ dryRun }),
  });
}

export async function rebuildUserCostBasis(
  dryRun: boolean,
): Promise<{ success: boolean; report: RebuildCostBasisReport; error?: string }> {
  return apiFetch('/maintenance/rebuild-user-cost-basis', {
    method: 'POST',
    body: JSON.stringify({ dryRun }),
  });
}

// Errors
export type ErrorSeverity = 'expected' | 'unexpected' | 'critical';
export type ErrorSourceValue = 'backend' | 'mobile';

export interface ErrorLogEntry {
  _id: string;
  source: ErrorSourceValue;
  route: string;
  fullPath: string;
  method: string;
  statusCode: number;
  severity: ErrorSeverity;
  errorMessage: string;
  errorCode?: string;
  errorName?: string;
  stack?: string;
  sentryEventId?: string;
  userId?: string;
  publicKey?: string;
  vaultAddress?: string;
  requestBody?: Record<string, unknown>;
  requestQuery?: Record<string, unknown>;
  requestParams?: Record<string, unknown>;
  responseBody?: Record<string, unknown>;
  userAgent?: string;
  ipAddress?: string;
  appVersion?: string;
  buildNumber?: string;
  platform?: string;
  osVersion?: string;
  device?: string;
  screen?: string;
  action?: string;
  createdAt: string;
}

export interface ErrorLogFilters {
  userId?: string;
  vaultAddress?: string;
  publicKey?: string;
  severity?: ErrorSeverity;
  source?: ErrorSourceValue;
  errorName?: string;
  statusCode?: string;
  route?: string;
  since?: string;
  cursor?: string;
  limit?: number;
}

export async function getErrorLogs(
  filters: ErrorLogFilters = {},
): Promise<{ success: boolean; errors: ErrorLogEntry[]; nextCursor: string | null; error?: string }> {
  const params = new URLSearchParams();
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.vaultAddress) params.set('vaultAddress', filters.vaultAddress);
  if (filters.publicKey) params.set('publicKey', filters.publicKey);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.source) params.set('source', filters.source);
  if (filters.errorName) params.set('errorName', filters.errorName);
  if (filters.statusCode) params.set('statusCode', filters.statusCode);
  if (filters.route) params.set('route', filters.route);
  if (filters.since) params.set('since', filters.since);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));
  return apiFetch(`/errors?${params}`);
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
