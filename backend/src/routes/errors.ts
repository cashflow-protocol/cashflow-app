import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ErrorManager } from '../services/errorManager';
import { ErrorSource, ErrorSeverity } from '../models';

const router = Router();

const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_BATCH_SIZE = 50;

interface MobileErrorEvent {
  errorMessage?: unknown;
  errorName?: unknown;
  errorCode?: unknown;
  stack?: unknown;
  severity?: unknown;
  screen?: unknown;
  action?: unknown;
  context?: unknown;
  occurredAt?: unknown;
}

function tryGetUserFromHeader(authHeader: string | undefined): { publicKey?: string; vaultAddress?: string; userId?: string } {
  if (!authHeader?.startsWith('Bearer ')) return {};
  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub?: string; vaultAddress?: string; userId?: string };
    return {
      publicKey: payload.sub,
      vaultAddress: payload.vaultAddress,
      userId: payload.userId,
    };
  } catch {
    return {};
  }
}

function extractIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.ip;
}

function getHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function coerceString(v: unknown, max = 4096): string | undefined {
  if (typeof v !== 'string') return undefined;
  return v.length > max ? v.slice(0, max) : v;
}

function coerceSeverity(v: unknown): ErrorSeverity | undefined {
  if (v === ErrorSeverity.EXPECTED || v === ErrorSeverity.UNEXPECTED || v === ErrorSeverity.CRITICAL) return v;
  return undefined;
}

router.post('/log', (req: Request, res: Response) => {
  try {
    const contentLength = Number.parseInt(getHeader(req, 'content-length') ?? '0', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
      res.status(413).json({ success: false, error: 'Payload too large' });
      return;
    }

    const body = req.body ?? {};
    const eventsArr: MobileErrorEvent[] = Array.isArray(body.events)
      ? body.events
      : (body.errorMessage ? [body as MobileErrorEvent] : []);

    if (eventsArr.length === 0) {
      res.status(400).json({ success: false, error: 'No events provided' });
      return;
    }
    if (eventsArr.length > MAX_BATCH_SIZE) {
      res.status(400).json({ success: false, error: `Batch size exceeds ${MAX_BATCH_SIZE}` });
      return;
    }

    const user = tryGetUserFromHeader(getHeader(req, 'authorization'));
    const userAgent = getHeader(req, 'user-agent');
    const appVersion = getHeader(req, 'x-app-version');
    const buildNumber = getHeader(req, 'x-build-number');
    const platform = getHeader(req, 'x-platform');
    const osVersion = getHeader(req, 'x-os-version');
    const device = getHeader(req, 'x-device');
    const ipAddress = extractIp(req);

    let accepted = 0;
    for (const event of eventsArr) {
      const errorMessage = coerceString(event.errorMessage, 2048);
      if (!errorMessage) continue;

      const severity = coerceSeverity(event.severity);
      const screen = coerceString(event.screen, 200);
      const route = screen ? `mobile:${screen}` : 'mobile:unknown';
      const stack = coerceString(event.stack, 4096);

      ErrorManager.log({
        source: ErrorSource.MOBILE,
        route,
        fullPath: route,
        method: 'CLIENT',
        statusCode: severity === ErrorSeverity.EXPECTED ? 400 : 500,
        errorMessage,
        errorCode: coerceString(event.errorCode, 200),
        errorName: coerceString(event.errorName, 200),
        stack,
        userId: user.userId,
        publicKey: user.publicKey,
        vaultAddress: user.vaultAddress,
        requestBody: typeof event.context === 'object' && event.context !== null
          ? (event.context as Record<string, unknown>)
          : undefined,
        userAgent,
        ipAddress,
        appVersion,
        buildNumber,
        platform,
        osVersion,
        device,
        screen,
        action: coerceString(event.action, 200),
      });
      accepted++;
    }

    res.json({ success: true, accepted });
  } catch (err) {
    console.error('POST /errors/v1/log failed:', err);
    res.status(500).json({ success: false, error: 'Failed to record errors' });
  }
});

export default router;
