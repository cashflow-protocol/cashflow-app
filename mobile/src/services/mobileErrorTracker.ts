/**
 * Captures non-backend errors on mobile (JS runtime errors, unhandled promise
 * rejections, React render errors, manual logs from critical flows) and ships
 * them to the backend ErrorLog collection. Errors that originated from a backend
 * HTTP response are skipped — they're already tracked server-side.
 */

import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import DeviceInfo from 'react-native-device-info';
import { API_CONFIG } from '../config/api';
import { APP_VERSION, BUILD_NUMBER } from '../config/version';

export type MobileErrorSeverity = 'expected' | 'unexpected' | 'critical';

export interface MobileErrorEvent {
  id: string;
  errorMessage: string;
  errorName?: string;
  errorCode?: string;
  stack?: string;
  severity?: MobileErrorSeverity;
  screen?: string;
  action?: string;
  context?: Record<string, unknown>;
  occurredAt: string;
}

const QUEUE_SERVICE = 'fun.cashflow.errorQueue';
const MAX_QUEUE_SIZE = 50;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FLUSH_BATCH_SIZE = 20;
const DEDUPE_WINDOW_MS = 60 * 1000;
const MAX_STACK_BYTES = 4096;
const MAX_MESSAGE_BYTES = 2048;

const SENSITIVE_KEY_PATTERNS = [
  'password', 'passcode', 'pin', 'pwd',
  'token', 'jwt', 'authorization', 'auth', 'bearer',
  'apikey', 'api_key', 'secret', 'clientsecret', 'client_secret',
  'mnemonic', 'seed', 'seedphrase', 'recoveryphrase',
  'privatekey', 'private_key', 'secretkey', 'secret_key',
  'signature', 'signatures', 'signedmessage',
  'transaction', 'transactions', 'signedtransaction', 'signedtransactions',
  'serializedtransaction', 'serializedtransactions', 'serializedtx', 'serializedtxs',
  'txbase64', 'txsbase64', 'keypair',
  'email', 'phone', 'ssn',
];

// Mark errors that came from a backend response so the global handler skips them
// — backend errors are already tracked server-side via the errorCapture middleware.
export const SKIP_TRACKER_FLAG = '__skipMobileTracker';

let initialized = false;
let currentScreen: string | undefined = undefined;
let currentAction: string | undefined = undefined;
let memoryQueue: MobileErrorEvent[] = [];
let flushScheduled = false;
const dedupeMap = new Map<string, number>();

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((p) => lower === p.replace(/[_-]/g, ''));
}

function sanitizeContext(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TOO_DEEP]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 1024 ? `${value.slice(0, 1024)}…[TRUNCATED]` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => sanitizeContext(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? '[REDACTED]' : sanitizeContext(v, depth + 1);
  }
  return out;
}

function shouldSkip(err: unknown): boolean {
  if (err && typeof err === 'object' && (err as Record<string, unknown>)[SKIP_TRACKER_FLAG] === true) {
    return true;
  }
  return false;
}

function dedupeKey(name: string | undefined, message: string): string {
  return `${name ?? ''}::${message.slice(0, 200)}`;
}

function shouldDedupe(key: string): boolean {
  const now = Date.now();
  const last = dedupeMap.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
  dedupeMap.set(key, now);
  // Cap the dedupe map size to prevent unbounded growth
  if (dedupeMap.size > 200) {
    const firstKey = dedupeMap.keys().next().value;
    if (firstKey !== undefined) dedupeMap.delete(firstKey);
  }
  return false;
}

function clamp(s: string | undefined, max: number): string | undefined {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) : s;
}

async function loadQueue(): Promise<MobileErrorEvent[]> {
  try {
    const result = await Keychain.getGenericPassword({ service: QUEUE_SERVICE });
    if (!result) return [];
    const parsed = JSON.parse(result.password) as MobileErrorEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: MobileErrorEvent[]): Promise<void> {
  try {
    if (queue.length === 0) {
      await Keychain.resetGenericPassword({ service: QUEUE_SERVICE });
      return;
    }
    await Keychain.setGenericPassword('errorQueue', JSON.stringify(queue), {
      service: QUEUE_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch (e) {
    console.warn('[errorTracker] saveQueue failed:', e);
  }
}

function clientHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-app-version': APP_VERSION,
    'x-build-number': BUILD_NUMBER,
    'x-platform': Platform.OS,
    'x-os-version': DeviceInfo.getSystemVersion() || String(Platform.Version),
    'x-device': `${DeviceInfo.getBrand() || Platform.OS} ${DeviceInfo.getModel() || ''}`.trim(),
  };
}

async function sendBatch(events: MobileErrorEvent[]): Promise<boolean> {
  try {
    const r = await fetch(`${API_CONFIG.baseUrl}/errors/v1/log`, {
      method: 'POST',
      headers: clientHeaders(),
      body: JSON.stringify({ events }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    void flush();
  }, 250);
}

async function flush(): Promise<void> {
  if (memoryQueue.length === 0) return;

  const cutoff = Date.now() - MAX_AGE_MS;
  memoryQueue = memoryQueue.filter((e) => new Date(e.occurredAt).getTime() >= cutoff);
  if (memoryQueue.length === 0) {
    await saveQueue([]);
    return;
  }

  const batch = memoryQueue.slice(0, FLUSH_BATCH_SIZE);
  const ok = await sendBatch(batch);

  if (ok) {
    memoryQueue = memoryQueue.slice(batch.length);
    await saveQueue(memoryQueue);
    if (memoryQueue.length > 0) scheduleFlush();
  } else {
    await saveQueue(memoryQueue);
  }
}

function buildEvent(err: unknown, opts: {
  severity?: MobileErrorSeverity;
  screen?: string;
  action?: string;
  context?: Record<string, unknown>;
  errorCode?: string;
}): MobileErrorEvent | null {
  let errorMessage: string;
  let errorName: string | undefined;
  let stack: string | undefined;

  if (err instanceof Error) {
    errorMessage = err.message || err.toString();
    errorName = err.constructor.name;
    stack = err.stack;
  } else if (typeof err === 'string') {
    errorMessage = err;
  } else if (err && typeof err === 'object' && 'message' in err) {
    errorMessage = String((err as { message: unknown }).message);
    errorName = (err as { name?: string }).name;
  } else {
    try {
      errorMessage = JSON.stringify(err);
    } catch {
      errorMessage = String(err);
    }
  }

  if (!errorMessage) return null;

  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    errorMessage: clamp(errorMessage, MAX_MESSAGE_BYTES) ?? '',
    errorName: clamp(errorName, 200),
    errorCode: clamp(opts.errorCode, 200),
    stack: clamp(stack, MAX_STACK_BYTES),
    severity: opts.severity,
    screen: clamp(opts.screen ?? currentScreen, 200),
    action: clamp(opts.action ?? currentAction, 200),
    context: opts.context ? (sanitizeContext(opts.context) as Record<string, unknown>) : undefined,
    occurredAt: new Date().toISOString(),
  };
}

class MobileErrorTracker {
  /** Set the current screen — used as default `screen` field on events */
  setCurrentScreen(screen: string | undefined): void {
    currentScreen = screen;
  }

  /** Set the current user action (e.g. 'tap_deposit_button') — auto-cleared after each log */
  setCurrentAction(action: string | undefined): void {
    currentAction = action;
  }

  /**
   * Log an error event. Fire-and-forget. Skips errors flagged with __skipMobileTracker.
   */
  log(err: unknown, opts: {
    severity?: MobileErrorSeverity;
    screen?: string;
    action?: string;
    context?: Record<string, unknown>;
    errorCode?: string;
  } = {}): void {
    if (shouldSkip(err)) return;

    const event = buildEvent(err, opts);
    if (!event) return;

    const dedupeId = dedupeKey(event.errorName, event.errorMessage);
    if (shouldDedupe(dedupeId)) return;

    memoryQueue.push(event);
    if (memoryQueue.length > MAX_QUEUE_SIZE) {
      memoryQueue = memoryQueue.slice(-MAX_QUEUE_SIZE);
    }

    void saveQueue(memoryQueue);
    scheduleFlush();
    currentAction = undefined;
  }

  /** Initialize global handlers + flush any persisted events. Idempotent. */
  async init(): Promise<void> {
    if (initialized) return;
    initialized = true;

    try {
      const persisted = await loadQueue();
      const cutoff = Date.now() - MAX_AGE_MS;
      memoryQueue = persisted.filter((e) => new Date(e.occurredAt).getTime() >= cutoff);
      if (memoryQueue.length !== persisted.length) await saveQueue(memoryQueue);
    } catch {
      memoryQueue = [];
    }

    const ErrorUtilsRef = (globalThis as unknown as { ErrorUtils?: { setGlobalHandler: (fn: (e: Error, isFatal?: boolean) => void) => void; getGlobalHandler: () => (e: Error, isFatal?: boolean) => void } }).ErrorUtils;
    if (ErrorUtilsRef) {
      const previousHandler = ErrorUtilsRef.getGlobalHandler();
      ErrorUtilsRef.setGlobalHandler((error, isFatal) => {
        try {
          this.log(error, { severity: isFatal ? 'critical' : 'unexpected', action: 'global_error_handler' });
        } catch {
          // never let logging crash the handler
        }
        if (previousHandler) {
          try { previousHandler(error, isFatal); } catch { /* ignore */ }
        }
      });
    }

    const HermesInternal = (globalThis as unknown as { HermesInternal?: { enablePromiseRejectionTracker?: (opts: { allRejections: boolean; onUnhandled: (id: number, rejection: unknown) => void }) => void } }).HermesInternal;
    if (HermesInternal?.enablePromiseRejectionTracker) {
      HermesInternal.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (_id, rejection) => {
          try {
            this.log(rejection, { severity: 'unexpected', action: 'unhandled_promise_rejection' });
          } catch {
            // ignore
          }
        },
      });
    }

    if (memoryQueue.length > 0) scheduleFlush();
  }

  /** Force a flush attempt (e.g. when network connectivity returns) */
  flushNow(): void {
    scheduleFlush();
  }
}

const mobileErrorTracker = new MobileErrorTracker();
export default mobileErrorTracker;
