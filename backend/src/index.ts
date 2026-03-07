import 'dotenv/config';
import express, { Application } from 'express';
import mongoose from 'mongoose';
import configRouter from './routes/config';
import earnRouter from './routes/earn';
import solanaRouter from './routes/solana';
import suggestionsRouter from './routes/suggestions';
import proxyRouter from './routes/proxy';
import { initializeScheduler } from './services';
import { DBManager } from './managers';
import { initialiseLookupManager } from './managers/LookupManager';

const app: Application = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/config/v1', configRouter);
app.use('/earn/v1', earnRouter);
app.use('/solana/v1', solanaRouter);
app.use('/suggestions/v1', suggestionsRouter);

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

// Database connection
if (!MONGODB_URI){
  throw new Error('MONGODB_URI is required');
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

    // Initialize cron scheduler after server starts
    await initializeScheduler();
    await initialiseLookupManager();
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

export default app;
