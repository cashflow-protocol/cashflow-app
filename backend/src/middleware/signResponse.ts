import { Request, Response, NextFunction } from 'express';
import { signResponseBytes } from '../services/responseSigner';

/**
 * Middleware that intercepts res.json() to add an Ed25519 signature
 * over the response body. The signature is sent in the X-Response-Signature
 * header so the mobile app can verify the raw JSON bytes without re-serializing.
 */
export function signResponseMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    if (body && typeof body === 'object') {
      const jsonStr = JSON.stringify(body);
      const jsonBytes = Buffer.from(jsonStr, 'utf-8');
      signResponseBytes(jsonBytes)
        .then((signature) => {
          res.setHeader('X-Response-Signature', signature);
          res.setHeader('Content-Type', 'application/json');
          res.send(jsonStr);
        })
        .catch((err) => {
          console.error('Response signing error:', err);
          originalJson(body);
        });
    } else {
      originalJson(body);
    }
    return res;
  } as any;

  next();
}
