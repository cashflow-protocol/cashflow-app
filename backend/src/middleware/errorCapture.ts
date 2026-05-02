import { Request, Response, NextFunction, Send } from 'express';
import { ErrorManager } from '../services/errorManager';
import { ErrorSource } from '../models';

const SKIP_PATH_PREFIXES = ['/health', '/debug/log', '/helius/webhook'];

interface AuthedReq extends Request {
  user?: { publicKey?: string; vaultAddress?: string; userId?: string };
}

function shouldSkip(req: Request): boolean {
  return SKIP_PATH_PREFIXES.some((prefix) => req.originalUrl.startsWith(prefix));
}

function extractRoutePattern(req: Request): string {
  const baseUrl = req.baseUrl ?? '';
  const routePath = req.route?.path ?? '';
  if (baseUrl || routePath) return `${baseUrl}${routePath}` || req.originalUrl.split('?')[0];
  return req.originalUrl.split('?')[0];
}

function extractClientHeaders(req: Request) {
  const get = (name: string) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    userAgent: get('user-agent'),
    appVersion: get('x-app-version'),
    buildNumber: get('x-build-number'),
    platform: get('x-platform'),
  };
}

function extractIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.ip;
}

export function errorCaptureMiddleware(req: AuthedReq, res: Response, next: NextFunction): void {
  if (shouldSkip(req)) {
    next();
    return;
  }

  const originalJson = res.json.bind(res) as Send;

  res.json = ((body?: unknown): Response => {
    try {
      const statusCode = res.statusCode ?? 200;
      const isErrorResponse =
        statusCode >= 400 &&
        body != null &&
        typeof body === 'object' &&
        (body as { success?: unknown }).success === false;

      if (isErrorResponse) {
        const errorBody = body as Record<string, unknown>;
        const errorMessage = typeof errorBody.error === 'string' ? errorBody.error : 'Unknown error';
        const errorCode = typeof errorBody.errorCode === 'string' ? errorBody.errorCode : undefined;
        const headers = extractClientHeaders(req);

        const responseExtras: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(errorBody)) {
          if (key === 'success' || key === 'error' || key === 'errorCode') continue;
          responseExtras[key] = value;
        }
        const responseBody = Object.keys(responseExtras).length > 0 ? responseExtras : undefined;

        ErrorManager.log({
          source: ErrorSource.BACKEND,
          route: extractRoutePattern(req),
          fullPath: req.originalUrl.split('?')[0],
          method: req.method,
          statusCode,
          errorMessage,
          errorCode,
          userId: req.user?.userId,
          publicKey: req.user?.publicKey,
          vaultAddress: req.user?.vaultAddress,
          requestBody: req.body,
          requestQuery: req.query,
          requestParams: req.params,
          responseBody,
          userAgent: headers.userAgent,
          ipAddress: extractIp(req),
          appVersion: headers.appVersion,
          buildNumber: headers.buildNumber,
          platform: headers.platform,
        });
      }
    } catch (e) {
      console.error('errorCaptureMiddleware wrapper failed:', e);
    }

    return originalJson(body);
  }) as Send;

  next();
}

export function globalErrorHandler(err: unknown, req: AuthedReq, res: Response, _next: NextFunction): void {
  const statusCode = res.statusCode && res.statusCode >= 400 ? res.statusCode : 500;
  const errorMessage = err instanceof Error ? err.message : String(err);
  const headers = extractClientHeaders(req);

  ErrorManager.log({
    err,
    source: ErrorSource.BACKEND,
    route: extractRoutePattern(req),
    fullPath: req.originalUrl.split('?')[0],
    method: req.method,
    statusCode,
    errorMessage,
    userId: req.user?.userId,
    publicKey: req.user?.publicKey,
    vaultAddress: req.user?.vaultAddress,
    requestBody: req.body,
    requestQuery: req.query,
    requestParams: req.params,
    userAgent: headers.userAgent,
    ipAddress: extractIp(req),
    appVersion: headers.appVersion,
    buildNumber: headers.buildNumber,
    platform: headers.platform,
  });

  if (!res.headersSent) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
