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

- `GET /earn/v1/tokens` - Get earn tokens from Jupiter Lend API
  - Returns tokens with lending/earn opportunities and their APYs across different platforms
  - Example: `/earn/v1/tokens`

## Tech Stack

- **Express** - Web framework
- **TypeScript** - Type safety
- **MongoDB** - Database
- **Typegoose** - TypeScript models for MongoDB
- **Nodemon** - Development auto-reload
