import 'dotenv/config';
import express, { Application } from 'express';
import mongoose from 'mongoose';
import earnRouter from './routes/earn';
import solanaRouter from './routes/solana';
import { initializeScheduler } from './services';
import { DBManager } from './managers';

const app: Application = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cashflow';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/earn/v1', earnRouter);
app.use('/solana/v1', solanaRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database connection
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
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

export default app;
