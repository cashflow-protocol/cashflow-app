import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { useEarnTokens } from '../hooks/useEarnTokens';
import EarnTokenItem from '../components/EarnTokenItem';
import VaultModal from '../components/VaultModal';
import { LifetimeEarnedIcon, Last7DIcon, AvgApyIcon } from '../assets/stat-icons';
import type { EarnTokenWithPosition } from '../hooks/useEarnTokens';
import { logScreenView, logEarnFilterSelect, logEarnVaultPress, logEarnRetry, logEarnRefresh } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

const ALL_FILTER = 'All';
const STABLES_FILTER = 'Stables';
const YIELD_STABLES_FILTER = 'Yield Stables';
const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT', 'JupUSD', 'USDG', 'USDS', 'PYUSD', 'USD*', 'sUSDv', 'ONyc']);
const YIELD_STABLECOIN_MINTS = new Set([
  'star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM', // USD*
  'pTA4St7D5WshfLUPBXoaxn5m8e3k2ort2DVt3gUTa17', // sUSDv
  '5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5', // ONyc
]);
const PINNED_FILTERS = [ALL_FILTER, STABLES_FILTER, YIELD_STABLES_FILTER, 'SOL', 'USDC'];

export default function EarnScreen() {
  const { colors } = useTheme();
  const { tokens, earnings, loading, refreshing, error, refresh } = useEarnTokens();
  const [activeFilter, setActiveFilter] = useState(ALL_FILTER);
  const [selectedToken, setSelectedToken] = useState<EarnTokenWithPosition | null>(null);
  const [gradientHeight, setGradientHeight] = useState(220);

  React.useEffect(() => { logScreenView('EarnScreen'); }, []);

  // Build filter list: All, Stables, USDC, then remaining symbols
  const filters = useMemo(() => {
    const allSymbols = [...new Set(tokens.map((t) => t.symbol))];
    const remaining = allSymbols.filter((s) => !PINNED_FILTERS.includes(s));
    return [...PINNED_FILTERS, ...remaining];
  }, [tokens]);

  // Total deposited (sum of all position uiAmounts)
  const totalDeposited = useMemo(() => {
    return tokens.reduce((sum, t) => sum + (t.position?.balance.usdValue ?? 0), 0);
  }, [tokens]);

  // Weighted average APY across positions
  const avgApy = useMemo(() => {
    const withPositions = tokens.filter((t) => t.position && t.position.balance.usdValue > 0);
    if (withPositions.length === 0) return null;
    const totalUsd = withPositions.reduce((sum, t) => sum + t.position!.balance.usdValue, 0);
    const weightedSum = withPositions.reduce(
      (sum, t) => sum + (t.rewardsRate / 100) * t.position!.balance.usdValue,
      0,
    );
    return weightedSum / totalUsd;
  }, [tokens]);

  // Filtered tokens
  const filteredTokens = useMemo(() => {
    if (activeFilter === ALL_FILTER) return tokens;
    if (activeFilter === STABLES_FILTER) return tokens.filter((t) => STABLECOIN_SYMBOLS.has(t.symbol));
    if (activeFilter === YIELD_STABLES_FILTER) return tokens.filter((t) => YIELD_STABLECOIN_MINTS.has(t.mint));
    return tokens.filter((t) => t.symbol === activeFilter);
  }, [tokens, activeFilter]);

  const formatTotal = (amount: number) => {
    return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      {/* Header Gradient */}
      <LinearGradient
        colors={colors.earnGradient as unknown as string[]}
        style={[styles.headerGradient, { height: gradientHeight }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.title}>Earn</Text>
        {!loading && <Text style={styles.totalAmount}>${formatTotal(totalDeposited)}</Text>}
      </SafeAreaView>

      {/* Loading state — only header + spinner */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#19C394" />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading vaults...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorEmoji, { color: colors.errorText, backgroundColor: colors.errorBackground }]}>!</Text>
          <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>Something went wrong</Text>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
          <TouchableOpacity style={[styles.retryButton, { backgroundColor: colors.primaryButton }]} onPress={() => { logEarnRetry(); refresh(); }}>
            <Text style={[styles.retryText, { color: colors.primaryButtonText }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Stat cards */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statsContainer}
            style={styles.statsScroll}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              setGradientHeight(y + height / 2);
            }}
          >
            <View style={[styles.statCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
              <View style={styles.statRow}>
                <View style={styles.statIconCircle}>
                  <LifetimeEarnedIcon size={20} />
                </View>
                <View>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Lifetime earned</Text>
                  <Text style={[styles.statValue, { color: colors.textPrimary }]}>
                    {earnings ? `$${formatTotal(earnings.lifetimeEarnedUsd)}` : '--'}
                  </Text>
                </View>
              </View>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
              <View style={styles.statRow}>
                <View style={styles.statIconCircle}>
                  <Last7DIcon size={20} />
                </View>
                <View>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Last 7D</Text>
                  <Text style={[styles.statValue, { color: colors.textPrimary }]}>--</Text>
                  {/* TODO: requires daily position snapshots to calculate 7-day delta */}
                </View>
              </View>
            </View>
            {avgApy !== null && (
              <View style={[styles.statCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
                <View style={styles.statRow}>
                  <View style={styles.statIconCircle}>
                    <AvgApyIcon size={20} />
                  </View>
                  <View>
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Your avg APY</Text>
                    <Text style={[styles.statValue, { color: colors.textPrimary }]}>{avgApy.toFixed(2)}%</Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersContainer}
            style={styles.filtersScroll}
            keyboardShouldPersistTaps="handled"
          >
            {filters.map((filter) => (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.filterChip,
                  { backgroundColor: colors.cardSecondary },
                  activeFilter === filter && styles.filterChipActive,
                ]}
                onPress={() => { logEarnFilterSelect(filter); setActiveFilter(filter); }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterText,
                    { color: colors.textSecondary },
                    activeFilter === filter && styles.filterTextActive,
                  ]}
                >
                  {filter}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Vault list */}
          <View style={styles.content}>
            <FlatList
              data={filteredTokens}
              keyExtractor={(item) => `${item.type}:${item.mint}${item.vaultAddress ? `:${item.vaultAddress}` : ''}`}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => { logEarnRefresh(); refresh(); }} tintColor="#fff" colors={['#fff']} />
              }
              renderItem={({ item }) => (
                <EarnTokenItem
                  type={item.type}
                  mint={item.mint}
                  symbol={item.symbol}
                  vaultTitle={item.vaultTitle}
                  logoUrl={item.logoUrl}
                  rewardsRate={item.rewardsRate}
                  positionAmount={item.position?.balance.uiAmount}
                  protocolName={item.protocolName}
                  protocolIconUrl={item.protocolIconUrl}
                  onPress={() => { logEarnVaultPress(item.symbol, item.vaultAddress, item.type); setSelectedToken(item); }}
                />
              )}
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No earn opportunities available</Text>
                </View>
              }
            />
          </View>
        </>
      )}

      {/* Deposit/Withdraw Modal */}
      {selectedToken && (
        <VaultModal
          visible={selectedToken !== null}
          onClose={() => setSelectedToken(null)}
          onSuccess={() => {
            refresh();
            setSelectedToken(null);
          }}
          type={selectedToken.type}
          mint={selectedToken.mint}
          vaultAddress={selectedToken.vaultAddress}
          vaultTitle={selectedToken.vaultTitle}
          symbol={selectedToken.symbol}
          decimals={selectedToken.decimals}
          logoUrl={selectedToken.logoUrl}
          rewardsRate={selectedToken.rewardsRate}
          position={selectedToken.position}
          minDepositAmount={selectedToken.minDepositAmount}
          minWithdrawAmount={selectedToken.minWithdrawAmount}
          protocolName={selectedToken.protocolName}
          protocolIconUrl={selectedToken.protocolIconUrl}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  header: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
  },
  totalAmount: {
    fontSize: 44,
    fontWeight: '700',
    color: '#fff',
  },
  statsScroll: {
    maxHeight: 70,
    marginTop: 16,
    marginBottom: 12,
  },
  statsContainer: {
    paddingHorizontal: 14,
    gap: 10,
  },
  statCard: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minWidth: 150,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#19C394',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  filtersScroll: {
    maxHeight: 36,
    marginTop: 4,
    marginBottom: 16,
  },
  filtersContainer: {
    paddingHorizontal: 14,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  filterChipActive: {
    backgroundColor: '#19C394',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 120,
    gap: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginTop: -60,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 8,
    marginTop: -40,
  },
  errorEmoji: {
    fontSize: 28,
    fontWeight: '700',
    width: 52,
    height: 52,
    lineHeight: 52,
    textAlign: 'center',
    borderRadius: 26,
    overflow: 'hidden',
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  retryButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: {
    fontWeight: '600',
    fontSize: 15,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 15,
  },
});
