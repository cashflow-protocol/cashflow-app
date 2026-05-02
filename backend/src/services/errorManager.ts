import { ErrorLogModel, ErrorSeverity, ErrorSource } from '../models';
import { captureError } from './sentryManager';
import { notifyAdmin } from './telegramManager';

const SENSITIVE_KEY_PATTERNS = [
  // Auth
  'password', 'passcode', 'pin', 'pwd',
  'token', 'jwt', 'authorization', 'auth', 'bearer',
  'apikey', 'api_key', 'secret', 'clientsecret', 'client_secret',
  // Crypto wallet
  'mnemonic', 'seed', 'seedphrase', 'recoveryphrase',
  'privatekey', 'private_key', 'secretkey', 'secret_key',
  'signature', 'signatures', 'signedmessage',
  'transaction', 'transactions', 'signedtransaction', 'signedtransactions', 'signedtx', 'signedtxs',
  'serializedtransaction', 'serializedtransactions', 'serializedtx', 'serializedtxs',
  'txbase64', 'txsbase64', 'keypair',
  // PII
  'email', 'phone', 'ssn',
];

const REDACTED = '[REDACTED]';
const MAX_STRING_LENGTH = 2048;
const MAX_BODY_BYTES = 10240;
const MAX_STACK_BYTES = 4096;
const TELEGRAM_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const MONEY_ROUTE_REGEX = /^\/solana\/v[12]\/(deposit|withdraw|transfer|swap|send-bundle|submit-bundle-signatures)/i;

const telegramLastFireByErrorName = new Map<string, number>();

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower === pattern.replace(/[_-]/g, ''));
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TOO_DEEP]';
  if (value == null) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]` : value;
  }

  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = sanitizeValue(val, depth + 1);
    }
  }
  return out;
}

function capJsonSize(value: unknown): unknown {
  if (value == null) return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= MAX_BODY_BYTES) return value;
    return { _truncated: true, _originalBytes: json.length, preview: json.slice(0, MAX_BODY_BYTES) };
  } catch {
    return { _truncated: true, _reason: 'unserializable' };
  }
}

export interface ErrorLogInput {
  err?: unknown;
  source?: ErrorSource;
  route: string;
  fullPath: string;
  method: string;
  statusCode: number;
  errorMessage: string;
  errorCode?: string;
  errorName?: string;
  stack?: string;
  userId?: string;
  publicKey?: string;
  vaultAddress?: string;
  requestBody?: unknown;
  requestQuery?: unknown;
  requestParams?: unknown;
  responseBody?: unknown;
  userAgent?: string;
  ipAddress?: string;
  appVersion?: string;
  buildNumber?: string;
  platform?: string;
  osVersion?: string;
  device?: string;
  screen?: string;
  action?: string;
}

export class ErrorManager {
  static classify(err: unknown, statusCode: number): ErrorSeverity {
    if (err && typeof err === 'object' && 'severity' in err) {
      const explicit = (err as { severity?: unknown }).severity;
      if (explicit === ErrorSeverity.EXPECTED || explicit === ErrorSeverity.UNEXPECTED || explicit === ErrorSeverity.CRITICAL) {
        return explicit;
      }
    }

    if (statusCode >= 500) return ErrorSeverity.UNEXPECTED;

    if (err instanceof TypeError) return ErrorSeverity.UNEXPECTED;
    if (err instanceof ReferenceError) return ErrorSeverity.UNEXPECTED;
    if (err instanceof SyntaxError) return ErrorSeverity.UNEXPECTED;

    const errName = (err as { name?: string } | undefined)?.name;
    if (errName === 'MongoError' || errName === 'MongoServerError' || errName === 'CastError') {
      return ErrorSeverity.UNEXPECTED;
    }
    if (errName === 'ValidationError' && (err as { errors?: unknown }).errors) {
      return ErrorSeverity.UNEXPECTED;
    }

    if (statusCode >= 400 && statusCode < 500) return ErrorSeverity.EXPECTED;

    return ErrorSeverity.UNEXPECTED;
  }

  static escalateToCritical(severity: ErrorSeverity, err: unknown, route: string): ErrorSeverity {
    if (severity === ErrorSeverity.CRITICAL) return severity;
    if (err && typeof err === 'object' && (err as { critical?: boolean }).critical === true) {
      return ErrorSeverity.CRITICAL;
    }
    if (severity === ErrorSeverity.UNEXPECTED && MONEY_ROUTE_REGEX.test(route)) {
      return ErrorSeverity.CRITICAL;
    }
    return severity;
  }

  static log(input: ErrorLogInput): void {
    void this._logAsync(input).catch((e) => {
      console.error('ErrorManager.log failed:', e);
    });
  }

  private static async _logAsync(input: ErrorLogInput): Promise<void> {
    const baseSeverity = this.classify(input.err, input.statusCode);
    const severity = this.escalateToCritical(baseSeverity, input.err, input.route);
    const source = input.source ?? ErrorSource.BACKEND;

    const errorName = input.errorName
      ?? (input.err instanceof Error ? input.err.constructor.name : (input.err as { name?: string } | undefined)?.name);
    const stack = input.stack
      ? input.stack.slice(0, MAX_STACK_BYTES)
      : (severity !== ErrorSeverity.EXPECTED && input.err instanceof Error && input.err.stack
          ? input.err.stack.slice(0, MAX_STACK_BYTES)
          : undefined);

    let sentryEventId: string | undefined;
    if (severity !== ErrorSeverity.EXPECTED) {
      sentryEventId = captureError(input.err ?? new Error(input.errorMessage), {
        route: input.route,
        method: input.method,
        statusCode: input.statusCode,
        severity,
        errorName,
        errorCode: input.errorCode,
        userId: input.userId,
        publicKey: input.publicKey,
        vaultAddress: input.vaultAddress,
        appVersion: input.appVersion,
        platform: input.platform,
      });
    }

    const sanitizedBody = input.requestBody ? capJsonSize(sanitizeValue(input.requestBody)) : undefined;
    const sanitizedQuery = input.requestQuery ? sanitizeValue(input.requestQuery) : undefined;
    const sanitizedParams = input.requestParams ? sanitizeValue(input.requestParams) : undefined;
    const sanitizedResponse = input.responseBody ? capJsonSize(sanitizeValue(input.responseBody)) : undefined;

    try {
      await ErrorLogModel.create({
        source,
        route: input.route,
        fullPath: input.fullPath,
        method: input.method,
        statusCode: input.statusCode,
        severity,
        errorMessage: input.errorMessage.slice(0, MAX_STRING_LENGTH),
        errorCode: input.errorCode,
        errorName,
        stack,
        sentryEventId,
        userId: input.userId,
        publicKey: input.publicKey,
        vaultAddress: input.vaultAddress,
        requestBody: sanitizedBody as Record<string, unknown> | undefined,
        requestQuery: sanitizedQuery as Record<string, unknown> | undefined,
        requestParams: sanitizedParams as Record<string, unknown> | undefined,
        responseBody: sanitizedResponse as Record<string, unknown> | undefined,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        appVersion: input.appVersion,
        buildNumber: input.buildNumber,
        platform: input.platform,
        osVersion: input.osVersion,
        device: input.device,
        screen: input.screen,
        action: input.action,
      });
    } catch (e) {
      console.error('ErrorLog persist failed:', e);
    }

    if (severity === ErrorSeverity.CRITICAL) {
      this._maybeNotifyTelegram({
        severity,
        route: input.route,
        errorName: errorName ?? 'UnknownError',
        errorMessage: input.errorMessage,
        userId: input.userId,
        vaultAddress: input.vaultAddress,
      });
    }
  }

  private static _maybeNotifyTelegram(params: {
    severity: ErrorSeverity;
    route: string;
    errorName: string;
    errorMessage: string;
    userId?: string;
    vaultAddress?: string;
  }): void {
    const now = Date.now();
    const last = telegramLastFireByErrorName.get(params.errorName) ?? 0;
    if (now - last < TELEGRAM_DEDUPE_WINDOW_MS) return;

    telegramLastFireByErrorName.set(params.errorName, now);

    const userLine = params.userId ?? params.vaultAddress ?? '(none)';
    const message = `🚨 <b>${params.severity.toUpperCase()}</b>: ${escapeHtml(params.errorName)} on <code>${escapeHtml(params.route)}</code>\n${escapeHtml(params.errorMessage)}\nuser: ${escapeHtml(userLine)}`;

    notifyAdmin(message).catch((e) => {
      console.error('ErrorManager telegram notify failed:', e);
    });
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
