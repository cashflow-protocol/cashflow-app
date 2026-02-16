# Services

Background services and scheduled tasks for the Cashflow backend.

## Scheduler

The scheduler service manages all cron jobs and background tasks.

### Usage

The scheduler is automatically initialized when the server starts. No manual intervention needed.

### Scheduled Tasks

#### Jupiter Earn Tokens Update
- **Schedule**: Every minute (`* * * * *`)
- **Timezone**: UTC
- **Description**: Fetches the latest earn tokens from Jupiter Lend API and updates the database
- **Runs on startup**: Yes (executes immediately when server starts)

### Cron Schedule Syntax

```
* * * * *
│ │ │ │ │
│ │ │ │ └── Day of week (0-7, 0 and 7 are Sunday)
│ │ │ └──── Month (1-12)
│ │ └────── Day of month (1-31)
│ └──────── Hour (0-23)
└────────── Minute (0-59)
```

Examples:
- `* * * * *` - Every minute
- `*/5 * * * *` - Every 5 minutes
- `0 * * * *` - Every hour at minute 0
- `0 0 * * *` - Every day at midnight

### Logging

The scheduler logs all activities:
- `⏰` - Scheduler initialization
- `🔄` - Task starting
- `✅` - Task completed successfully
- `❌` - Task failed

### Adding New Scheduled Tasks

To add a new scheduled task, edit `src/services/scheduler.ts`:

```typescript
cron.schedule('*/5 * * * *', async () => {
  try {
    console.log('🔄 [Cron] Starting my task...');
    // Your task logic here
    console.log('✅ [Cron] My task completed');
  } catch (error) {
    console.error('❌ [Cron] My task failed:', error);
  }
});
```
