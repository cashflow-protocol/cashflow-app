# Cashflow Backend

Express TypeScript server with MongoDB/Typegoose for the Cashflow app.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Update `.env` with your configuration:
   - `MONGODB_URI` - Your MongoDB connection string
   - `JUPITER_API_KEY` - Your Jupiter API key

## Development

Run the development server:
```bash
npm run dev
```

The server will start on `http://localhost:3000` (or your configured PORT).

## Build

Build for production:
```bash
npm run build
```

## Run Production

```bash
npm start
```

## API Endpoints

### Health Check
- `GET /health` - Returns server health status

### Earn Endpoints

- `GET /earn/v1/tokens` - Get earn tokens from database
  - Returns tokens with lending/earn opportunities and their APYs across different platforms
  - Data is automatically synced from Jupiter API every minute via background cron job
  - Query params:
    - `type` - Filter by platform type (optional): `jupiter`, `kamino`, or `drift`
  - Response fields:
    - `type` - Platform type (jupiter/kamino/drift)
    - `mint` - Token mint address
    - `decimals` - Token decimals
    - `symbol` - Token symbol
    - `name` - Token name
    - `logoUrl` - Token logo URL
    - `rewardsRate` - APY rate as a number
  - Examples:
    - `/earn/v1/tokens` - Get all tokens
    - `/earn/v1/tokens?type=jupiter` - Get only Jupiter tokens

## Background Tasks

The server runs scheduled tasks using `node-cron`:

### Jupiter Earn Tokens Sync
- **Frequency**: Every minute
- **Description**: Fetches latest earn tokens from Jupiter Lend API and updates MongoDB
- **Status**: Runs automatically on server startup and continues in background

You'll see log messages like:
```
🔄 [Cron] Starting Jupiter Earn tokens update...
✅ Saved X new tokens, updated Y existing tokens
✅ [Cron] Jupiter Earn tokens update completed
```

## Tech Stack

- **Express** - Web framework
- **TypeScript** - Type safety
- **MongoDB** - Database
- **Typegoose** - TypeScript models for MongoDB
- **node-cron** - Task scheduler for background jobs
- **Nodemon** - Development auto-reload
