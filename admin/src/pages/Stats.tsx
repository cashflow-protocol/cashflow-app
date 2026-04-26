import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react';
import { getStats } from '../api';

interface CountGroup {
  total: number;
  today: number;
  yesterday: number;
}

interface TvlCoin {
  mint: string;
  symbol: string;
  tvlUi: number;
  tvlUsd: number;
}

interface RewardBadge {
  slug: string;
  title: string;
  imageUrl: string;
  maxSupply?: number;
  total: number;
  today: number;
}

interface StatsData {
  users: CountGroup;
  waitlist: {
    total: number;
    approved: number;
    notApproved: number;
    yesterday: { approved: number; notApproved: number };
    today: { approved: number; notApproved: number };
  };
  transactions: {
    total: number;
    today: number;
    yesterday: number;
    deposits: CountGroup;
    withdrawals: CountGroup;
    transfers: CountGroup;
  };
  tvl: {
    coins: TvlCoin[];
    totalUsd: number;
  };
  rewards: {
    total: number;
    today: number;
    badges: RewardBadge[];
  };
}

// ─── Formatters ───

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function formatUsdCompact(n: number): string {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
  return formatUsd(n);
}

function formatAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 2 });
}

function coinColor(symbol: string): string {
  const known: Record<string, string> = {
    USDC: '#2775ca',
    USDT: '#26a17b',
    SOL: '#9945FF',
    JupUSD: '#ff9900',
    USDG: '#14b8a6',
    USDS: '#627eea',
    PYUSD: '#0070E0',
    EURC: '#0052FF',
    'USD*': '#8B5CF6',
    sUSDv: '#EC4899',
    ONyc: '#F59E0B',
  };
  if (known[symbol]) return known[symbol];
  const palette = ['#3985D8', '#9945FF', '#26a17b', '#f0b90b', '#627eea', '#ec407a', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

// ─── Styles ───

const cardStyle: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: '20px 24px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const heroCardStyle: CSSProperties = {
  ...cardStyle,
  background: 'linear-gradient(135deg, #3985D8 0%, #5B9FE8 100%)',
  color: '#fff',
  boxShadow: '0 4px 16px rgba(57,133,216,0.25)',
  padding: '24px 28px',
  gridColumn: 'span 2',
};

const kpiValue: CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: '#1a1a1a',
  lineHeight: 1.1,
  letterSpacing: '-0.02em',
};

const kpiLabel: CSSProperties = {
  fontSize: 12,
  color: '#999',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: 8,
};

const sectionStyle: CSSProperties = {
  marginBottom: 28,
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#666',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: 12,
};

// ─── Delta indicator ───

function Delta({ today, yesterday }: { today: number; yesterday: number }) {
  if (today === yesterday) {
    return <span style={{ color: '#999', fontSize: 12, fontWeight: 600 }}>— no change</span>;
  }
  if (yesterday === 0) {
    return <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 600 }}>▲ new</span>;
  }
  const diff = today - yesterday;
  const pct = (diff / yesterday) * 100;
  const isUp = diff > 0;
  const color = isUp ? '#16a34a' : '#e53e3e';
  const arrow = isUp ? '▲' : '▼';
  return (
    <span style={{ color, fontSize: 12, fontWeight: 600 }}>
      {arrow} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

// ─── Hero TVL card ───

function HeroTvl({ totalUsd, coinCount }: { totalUsd: number; coinCount: number }) {
  return (
    <div style={heroCardStyle}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.85 }}>
        Total Value Locked
      </div>
      <div style={{ fontSize: 42, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em', marginTop: 8 }}>
        {formatUsd(totalUsd)}
      </div>
      <div style={{ fontSize: 13, marginTop: 8, opacity: 0.85 }}>
        Across {coinCount} {coinCount === 1 ? 'coin' : 'coins'} · Net of deposits − withdrawals (confirmed)
      </div>
    </div>
  );
}

// ─── KPI card with today/yesterday delta ───

function KpiCard({
  label,
  value,
  sub,
  today,
  yesterday,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  today?: number;
  yesterday?: number;
}) {
  return (
    <div style={cardStyle}>
      <div style={kpiLabel}>{label}</div>
      <div style={kpiValue}>{value}</div>
      {sub ? <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>{sub}</div> : null}
      {today !== undefined && yesterday !== undefined ? (
        <div style={{ fontSize: 13, color: '#666', marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>
            Today <strong style={{ color: '#1a1a1a' }}>{today.toLocaleString()}</strong>
          </span>
          <Delta today={today} yesterday={yesterday} />
        </div>
      ) : null}
    </div>
  );
}

// ─── TVL coin row with progress bar ───

function CoinRow({ coin, pctOfTotal, isFirst }: { coin: TvlCoin; pctOfTotal: number; isFirst: boolean }) {
  const color = coinColor(coin.symbol);
  const initials = coin.symbol.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || coin.symbol.slice(0, 3);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr auto',
        alignItems: 'center',
        gap: 16,
        padding: '14px 20px',
        borderTop: isFirst ? 'none' : '1px solid #f0f2f5',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: color,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.3px',
        }}
      >
        {initials}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{coin.symbol}</span>
          <span style={{ fontSize: 12, color: '#999' }}>{formatAmount(coin.tvlUi)}</span>
        </div>
        <div
          style={{
            position: 'relative',
            height: 6,
            background: '#f0f2f5',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '0 auto 0 0',
              width: `${Math.max(2, pctOfTotal)}%`,
              background: color,
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>{formatUsdCompact(coin.tvlUsd)}</div>
        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{pctOfTotal.toFixed(1)}%</div>
      </div>
    </div>
  );
}

// ─── Reward badge row ───

function BadgeRow({ badge, isFirst }: { badge: RewardBadge; isFirst: boolean }) {
  const supplyLabel = badge.maxSupply ? ` / ${badge.maxSupply.toLocaleString()}` : '';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr auto auto',
        alignItems: 'center',
        gap: 16,
        padding: '14px 20px',
        borderTop: isFirst ? 'none' : '1px solid #f0f2f5',
      }}
    >
      {badge.imageUrl ? (
        <img
          src={badge.imageUrl}
          alt={badge.title}
          style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', background: '#f0f2f5' }}
        />
      ) : (
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: '#f0f2f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            color: '#999',
          }}
        >
          {badge.title.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{badge.title}</div>
        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{badge.slug}</div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 80 }}>
        <div style={{ fontSize: 11, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Today
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginTop: 2 }}>
          {badge.today.toLocaleString()}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 100 }}>
        <div style={{ fontSize: 11, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Minted
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginTop: 2 }}>
          {badge.total.toLocaleString()}
          {supplyLabel ? <span style={{ fontSize: 12, color: '#999', fontWeight: 400 }}>{supplyLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}

// ─── Comparison table (rows × timeframes) ───

interface ComparisonRow {
  label: string;
  total: number;
  today: number;
  yesterday: number;
  emphasize?: boolean;
}

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const cellStyle: CSSProperties = { padding: '12px 20px', fontSize: 14, color: '#1a1a1a' };
  const headStyle: CSSProperties = {
    padding: '10px 20px',
    fontSize: 11,
    fontWeight: 600,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    textAlign: 'right',
    background: '#fafbfc',
  };
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...headStyle, textAlign: 'left' }}></th>
            <th style={headStyle}>Today</th>
            <th style={headStyle}>Yesterday</th>
            <th style={headStyle}>Change</th>
            <th style={headStyle}>All time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.label}
              style={{
                borderTop: i === 0 ? 'none' : '1px solid #f0f2f5',
                background: row.emphasize ? '#fafbfc' : 'transparent',
              }}
            >
              <td style={{ ...cellStyle, fontWeight: row.emphasize ? 700 : 500 }}>{row.label}</td>
              <td style={{ ...cellStyle, textAlign: 'right', fontWeight: row.emphasize ? 700 : 400 }}>
                {row.today.toLocaleString()}
              </td>
              <td style={{ ...cellStyle, textAlign: 'right', color: '#666', fontWeight: row.emphasize ? 700 : 400 }}>
                {row.yesterday.toLocaleString()}
              </td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>
                <Delta today={row.today} yesterday={row.yesterday} />
              </td>
              <td style={{ ...cellStyle, textAlign: 'right', fontWeight: row.emphasize ? 700 : 500 }}>
                {row.total.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ───

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getStats();
      setStats(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h2>Stats</h2>
        </div>
        <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>Loading...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div>
        <div className="page-header">
          <h2>Stats</h2>
          <button className="btn-primary" onClick={load}>
            Retry
          </button>
        </div>
        <p className="error-text" style={{ textAlign: 'center', padding: 40 }}>
          {error}
        </p>
      </div>
    );
  }

  const waitlistToday = stats.waitlist.today.approved + stats.waitlist.today.notApproved;
  const waitlistYesterday = stats.waitlist.yesterday.approved + stats.waitlist.yesterday.notApproved;

  const txRows: ComparisonRow[] = [
    {
      label: 'Deposits',
      total: stats.transactions.deposits.total,
      today: stats.transactions.deposits.today,
      yesterday: stats.transactions.deposits.yesterday,
    },
    {
      label: 'Withdrawals',
      total: stats.transactions.withdrawals.total,
      today: stats.transactions.withdrawals.today,
      yesterday: stats.transactions.withdrawals.yesterday,
    },
    {
      label: 'Transfers',
      total: stats.transactions.transfers.total,
      today: stats.transactions.transfers.today,
      yesterday: stats.transactions.transfers.yesterday,
    },
    {
      label: 'Total',
      total: stats.transactions.total,
      today: stats.transactions.today,
      yesterday: stats.transactions.yesterday,
      emphasize: true,
    },
  ];

  const waitlistRows: ComparisonRow[] = [
    {
      label: 'Approved',
      total: stats.waitlist.approved,
      today: stats.waitlist.today.approved,
      yesterday: stats.waitlist.yesterday.approved,
    },
    {
      label: 'Not approved',
      total: stats.waitlist.notApproved,
      today: stats.waitlist.today.notApproved,
      yesterday: stats.waitlist.yesterday.notApproved,
    },
    {
      label: 'Total',
      total: stats.waitlist.total,
      today: waitlistToday,
      yesterday: waitlistYesterday,
      emphasize: true,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Stats</h2>
        <button className="btn-secondary" onClick={load}>
          Refresh
        </button>
      </div>

      {/* Top KPI grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 16,
          marginBottom: 28,
        }}
      >
        <HeroTvl totalUsd={stats.tvl.totalUsd} coinCount={stats.tvl.coins.length} />
        <KpiCard
          label="Users"
          value={stats.users.total.toLocaleString()}
          today={stats.users.today}
          yesterday={stats.users.yesterday}
        />
        <KpiCard
          label="Transactions"
          value={stats.transactions.total.toLocaleString()}
          today={stats.transactions.today}
          yesterday={stats.transactions.yesterday}
        />
      </div>

      {/* TVL by coin */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>TVL by coin</div>
        {stats.tvl.coins.length === 0 ? (
          <div style={{ ...cardStyle, color: '#999', textAlign: 'center', padding: '32px 20px' }}>
            No deposits yet
          </div>
        ) : (
          <div style={{ ...cardStyle, padding: '6px 0', overflow: 'hidden' }}>
            {stats.tvl.coins.map((c, i) => (
              <CoinRow
                key={c.mint}
                coin={c}
                pctOfTotal={stats.tvl.totalUsd > 0 ? (c.tvlUsd / stats.tvl.totalUsd) * 100 : 0}
                isFirst={i === 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Transactions */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Transactions</div>
        <ComparisonTable rows={txRows} />
      </div>

      {/* Rewards */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>
          Rewards · {stats.rewards.total.toLocaleString()} minted
          {stats.rewards.today > 0 ? ` · ${stats.rewards.today.toLocaleString()} today` : ''}
        </div>
        {stats.rewards.badges.length === 0 ? (
          <div style={{ ...cardStyle, color: '#999', textAlign: 'center', padding: '32px 20px' }}>
            No reward tasks yet
          </div>
        ) : (
          <div style={{ ...cardStyle, padding: '6px 0', overflow: 'hidden' }}>
            {stats.rewards.badges.map((b, i) => (
              <BadgeRow key={b.slug} badge={b} isFirst={i === 0} />
            ))}
          </div>
        )}
      </div>

      {/* Waitlist */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Waitlist</div>
        <ComparisonTable rows={waitlistRows} />
      </div>
    </div>
  );
}
