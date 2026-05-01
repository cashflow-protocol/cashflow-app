import * as Sentry from '@sentry/node';
import { ErrorSeverity } from '../models';

let initialized = false;

export function initializeSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('ℹ️  SENTRY_DSN not set — Sentry disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,
  });

  initialized = true;
  console.log('✅ Sentry initialized');
}

export function isSentryEnabled(): boolean {
  return initialized;
}

export interface SentryCaptureContext {
  route: string;
  method: string;
  statusCode: number;
  severity: ErrorSeverity;
  errorName?: string;
  errorCode?: string;
  userId?: string;
  publicKey?: string;
  vaultAddress?: string;
  appVersion?: string;
  platform?: string;
}

export function captureError(err: unknown, context: SentryCaptureContext): string | undefined {
  if (!initialized) return undefined;

  try {
    return Sentry.withScope((scope) => {
      scope.setLevel(context.severity === ErrorSeverity.CRITICAL ? 'fatal' : 'error');
      scope.setTag('route', context.route);
      scope.setTag('method', context.method);
      scope.setTag('statusCode', String(context.statusCode));
      scope.setTag('severity', context.severity);
      if (context.errorName) scope.setTag('errorName', context.errorName);
      if (context.errorCode) scope.setTag('errorCode', context.errorCode);
      if (context.platform) scope.setTag('platform', context.platform);
      if (context.appVersion) scope.setTag('appVersion', context.appVersion);

      if (context.userId || context.publicKey || context.vaultAddress) {
        scope.setUser({
          id: context.userId,
          username: context.publicKey,
          vaultAddress: context.vaultAddress,
        });
      }

      const error = err instanceof Error ? err : new Error(String(err));
      return Sentry.captureException(error);
    });
  } catch (e) {
    console.error('Sentry captureError failed:', e);
    return undefined;
  }
}
