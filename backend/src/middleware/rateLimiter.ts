import rateLimit from 'express-rate-limit';

/**
 * Strict rate limiter for auth-related endpoints.
 * 10 requests per minute per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
});

/**
 * Moderate rate limiter for general API endpoints.
 * 30 requests per 10 seconds per IP.
 */
export const apiLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
});

/**
 * Strict limiter for admin endpoints.
 * 30 requests per minute per IP.
 */
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
});

/**
 * Very strict limiter for onboarding/invite validation.
 * 5 requests per minute per IP.
 */
export const onboardingLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
});

/**
 * Limiter for the debug log endpoint to prevent log spam.
 * 10 requests per minute per IP.
 */
export const debugLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests' },
});
