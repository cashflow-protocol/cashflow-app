# Managers

Business logic managers for the Cashflow backend.

## JupiterManager

Manager class for interacting with Jupiter Lend Earn API.

### Usage

```typescript
import { JupiterManager } from './managers';

const jupiter = new JupiterManager();

// Get earn tokens with lending opportunities
const earnTokens = await jupiter.getEarnTokens();
```

### Features

- **Earn Tokens**: Get tokens with lending/earn opportunities from Jupiter Lend API
- **Auto-Save to MongoDB**: Automatically saves/updates tokens in database
- **Upsert Logic**: Updates existing tokens or creates new ones based on type+mint
- **Rewards Rate**: Stores the total rewards rate (APY) for each token
- **Full Data Storage**: Saves complete Jupiter response in `jupiterToken` field
- **Console Logging**: Logs token data and database operation results

### API Reference

#### Methods

- `getEarnTokens()` - Get tokens with lending/earn opportunities from Jupiter Lend API

#### Database Schema

```typescript
interface EarnToken {
  type: 'jupiter' | 'kamino' | 'drift';  // Platform type
  mint: string;                          // Token mint address (unique with type)
  decimals: number;                      // Token decimals
  symbol: string;                        // Token symbol
  name: string;                          // Token name
  rewardsRate: number;                   // Total rewards rate (APY)
  logoUrl: string;                       // Token logo URL
  jupiterToken?: object;                 // Full Jupiter API response (optional)
}
```

**Unique Index**: `type` + `mint` (ensures one record per token per platform)

### Jupiter API Documentation

- Lend Earn API: https://dev.jup.ag/api-reference/lend/earn/tokens
