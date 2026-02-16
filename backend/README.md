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

3. Update `.env` with your MongoDB connection string

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
- `GET /earn/v1/tokens` - Returns list of tokens (currently empty)

## Tech Stack

- **Express** - Web framework
- **TypeScript** - Type safety
- **MongoDB** - Database
- **Typegoose** - TypeScript models for MongoDB
- **Nodemon** - Development auto-reload
