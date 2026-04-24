import { useState, useEffect, useCallback } from 'react';
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
}

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function formatAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 2 });
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: '20px 24px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  flex: 1,
  minWidth: 0,
};

const valueStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: '#1a1a1a',
  lineHeight: 1.2,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#666',
  marginTop: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 28,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#999',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: 10,
};

const subLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#999',
  marginBottom: 6,
  marginTop: 10,
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={cardStyle}>
      <div style={valueStyle}>{value.toLocaleString()}</div>
      <div style={labelStyle}>{label}</div>
    </div>
  );
}

function TvlCard({ label, usd, amount }: { label: string; usd: number; amount?: string }) {
  return (
    <div style={cardStyle}>
      <div style={valueStyle}>{formatUsd(usd)}</div>
      <div style={labelStyle}>{label}</div>
      {amount ? <div style={{ ...labelStyle, color: '#999', marginTop: 2 }}>{amount}</div> : null}
    </div>
  );
}

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

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div>
        <div className="page-header"><h2>Stats</h2></div>
        <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>Loading...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div>
        <div className="page-header">
          <h2>Stats</h2>
          <button className="btn-primary" onClick={load}>Retry</button>
        </div>
        <p className="error-text" style={{ textAlign: 'center', padding: 40 }}>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Stats</h2>
        <button className="btn-secondary" onClick={load}>Refresh</button>
      </div>

      {/* TVL */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>TVL</div>
        <div style={rowStyle}>
          <TvlCard label="Total TVL" usd={stats.tvl.totalUsd} />
        </div>
        {stats.tvl.coins.length > 0 ? (
          <>
            <div style={subLabelStyle}>By coin</div>
            <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
              {stats.tvl.coins.map((c) => (
                <TvlCard
                  key={c.mint}
                  label={c.symbol}
                  usd={c.tvlUsd}
                  amount={`${formatAmount(c.tvlUi)} ${c.symbol}`}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* Users */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Users</div>
        <div style={rowStyle}>
          <StatCard label="Total" value={stats.users.total} />
          <StatCard label="Today (UTC)" value={stats.users.today} />
          <StatCard label="Yesterday (UTC)" value={stats.users.yesterday} />
        </div>
      </div>

      {/* Waitlist */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Waitlist</div>
        <div style={rowStyle}>
          <StatCard label="Total" value={stats.waitlist.total} />
          <StatCard label="Approved" value={stats.waitlist.approved} />
          <StatCard label="Not Approved" value={stats.waitlist.notApproved} />
        </div>
        <div style={subLabelStyle}>Yesterday (UTC)</div>
        <div style={rowStyle}>
          <StatCard label="Approved" value={stats.waitlist.yesterday.approved} />
          <StatCard label="Not Approved" value={stats.waitlist.yesterday.notApproved} />
        </div>
        <div style={subLabelStyle}>Today (UTC)</div>
        <div style={rowStyle}>
          <StatCard label="Approved" value={stats.waitlist.today.approved} />
          <StatCard label="Not Approved" value={stats.waitlist.today.notApproved} />
        </div>
      </div>

      {/* Transactions */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Transactions</div>
        <div style={rowStyle}>
          <StatCard label="Total" value={stats.transactions.total} />
          <StatCard label="Today (UTC)" value={stats.transactions.today} />
          <StatCard label="Yesterday (UTC)" value={stats.transactions.yesterday} />
        </div>

        <div style={subLabelStyle}>Deposits</div>
        <div style={rowStyle}>
          <StatCard label="Total" value={stats.transactions.deposits.total} />
          <StatCard label="Today" value={stats.transactions.deposits.today} />
          <StatCard label="Yesterday" value={stats.transactions.deposits.yesterday} />
        </div>

        <div style={subLabelStyle}>Withdrawals</div>
        <div style={rowStyle}>
          <StatCard label="Total" value={stats.transactions.withdrawals.total} />
          <StatCard label="Today" value={stats.transactions.withdrawals.today} />
          <StatCard label="Yesterday" value={stats.transactions.withdrawals.yesterday} />
        </div>

        <div style={subLabelStyle}>Transfers</div>
        <div style={rowStyle}>
          <StatCard label="Total" value={stats.transactions.transfers.total} />
          <StatCard label="Today" value={stats.transactions.transfers.today} />
          <StatCard label="Yesterday" value={stats.transactions.transfers.yesterday} />
        </div>
      </div>
    </div>
  );
}
