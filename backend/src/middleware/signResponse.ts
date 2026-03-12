import { Request, Response, NextFunction } from 'express';
import { signResponseBody } from '../services/responseSigner';

/**
 * Middleware that intercepts res.json() to add an Ed25519 signature
 * over the response body. The mobile app uses this to detect MITM tampering.
 */
export function signResponseMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    if (body && typeof body === 'object') {
      signResponseBody(body)
        .then((signature) => {
          body.responseSignature = signature;
          originalJson(body);
        })
        .catch((err) => {
          console.error('Response signing error:', err);
          // Send unsigned response rather than failing
          originalJson(body);
        });
    } else {
      originalJson(body);
    }
    return res;
  } as any;

  next();
}
