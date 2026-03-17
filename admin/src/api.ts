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

function getPassword(): string | null {
  return localStorage.getItem('admin_password');
}

export function setPassword(pw: string) {
  localStorage.setItem('admin_password', pw);
}

export function clearPassword() {
  localStorage.removeItem('admin_password');
}

export function isLoggedIn(): boolean {
  return !!getPassword();
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const pw = getPassword();
  const res = await fetch(`${getApiBase()}/admin/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pw}`,
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
  taskId: string;
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
