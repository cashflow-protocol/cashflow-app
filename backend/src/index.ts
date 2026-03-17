import 'dotenv/config';
import express, { Application } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import configRouter from './routes/config';
import earnRouter from './routes/earn';
import solanaRouter from './routes/solana';
import suggestionsRouter from './routes/suggestions';
import proxyRouter from './routes/proxy';
import waitlistRouter from './routes/waitlist';
import authRouter from './routes/auth';
import onboardingRouter from './routes/onboarding';
import adminRouter from './routes/admin';
import { requireAuth } from './middleware/auth';
import { signResponseMiddleware } from './middleware/signResponse';
import { initializeScheduler } from './services';
import { DBManager } from './managers';
import { initialiseLookupManager } from './managers/LookupManager';
import notificationsRouter from './routes/notifications';
import { initializeFirebase } from './services/firebaseManager';
import { initializeHeliusListener } from './services/heliusListener';

const app: Application = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(cors({ origin: ['https://cashflow.fun', 'https://www.cashflow.fun', 'https://admin.cashflow.fun', 'http://localhost:3000', 'http://localhost:5173'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// v1 routes (deprecated — do not modify, use v2 instead)
app.use('/config/v1', configRouter);
app.use('/earn/v1', earnRouter);
app.use('/solana/v1', solanaRouter);
app.use('/suggestions/v1', suggestionsRouter);
app.use('/waitlist/v1', waitlistRouter);

// Auth routes (no auth required)
app.use('/auth/v2', authRouter);

// Onboarding routes (no auth required — pre-wallet users)
app.use('/onboarding/v1', onboardingRouter);

// Admin routes (password-protected)
app.use('/admin/v1', adminRouter);

// v2 routes (JWT auth required, response signing for transaction routes)
app.use('/earn/v2', requireAuth, signResponseMiddleware, earnRouter);
app.use('/solana/v2', requireAuth, signResponseMiddleware, solanaRouter);
app.use('/suggestions/v2', requireAuth, signResponseMiddleware, suggestionsRouter);
app.use('/notifications/v2', requireAuth, notificationsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/ipfs', proxyRouter);

// Debug log relay — mobile client POSTs logs here so they appear in the server console
app.post('/debug/log', (req, res) => {
  const { tag, lines } = req.body;
  for (const line of lines ?? []) {
    console.log(`[mobile:${tag}]`, line);
  }
  res.json({ ok: true });
});

// Validate required env vars
if (!MONGODB_URI){
  throw new Error('MONGODB_URI is required');
}
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}
if (!process.env.RESPONSE_SIGNING_KEY) {
  throw new Error('RESPONSE_SIGNING_KEY is required');
}
mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');

    // Sync indexes to match current model definitions
    await new DBManager().syncIndexes();
    console.log('✅ MongoDB indexes synced');

    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });

    // Initialize services after server starts
    initializeFirebase();
    await initializeScheduler();
    await initialiseLookupManager();
    await initializeHeliusListener();
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

export default app;
