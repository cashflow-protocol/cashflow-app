import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { useEarnTokens } from '../hooks/useEarnTokens';
import EarnTokenItem from '../components/EarnTokenItem';
import VaultModal from '../components/VaultModal';
import { LifetimeEarnedIcon, Last7DIcon, AvgApyIcon } from '../assets/stat-icons';
import type { EarnTokenWithPosition } from '../hooks/useEarnTokens';

const ALL_FILTER = 'All';
const STABLES_FILTER = 'Stables';
const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT', 'JupUSD', 'USDG', 'USDS', 'PYUSD']);
const PINNED_FILTERS = [ALL_FILTER, STABLES_FILTER, 'SOL', 'USDC'];

export default function EarnScreen() {
  const { tokens, loading, refreshing, error, refresh } = useEarnTokens();
  const [activeFilter, setActiveFilter] = useState(ALL_FILTER);
  const [selectedToken, setSelectedToken] = useState<EarnTokenWithPosition | null>(null);

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
    return tokens.filter((t) => t.symbol === activeFilter);
  }, [tokens, activeFilter]);

  const formatTotal = (amount: number) => {
    return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header Gradient */}
      <LinearGradient
        colors={['#1E8260', '#19C394']}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.title}>Earn</Text>
        <Text style={styles.totalAmount}>${formatTotal(totalDeposited)}</Text>
      </SafeAreaView>

      {/* Stat cards */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statsContainer}
        style={styles.statsScroll}
      >
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <LifetimeEarnedIcon size={20} />
            </View>
            <View>
              <Text style={styles.statLabel}>Lifetime earned</Text>
              <Text style={styles.statValue}>$0.00</Text>
            </View>
          </View>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <Last7DIcon size={20} />
            </View>
            <View>
              <Text style={styles.statLabel}>Last 7D</Text>
              <Text style={styles.statValue}>$0.00</Text>
            </View>
          </View>
        </View>
        {avgApy !== null && (
          <View style={styles.statCard}>
            <View style={styles.statRow}>
              <View style={styles.statIconCircle}>
                <AvgApyIcon size={20} />
              </View>
              <View>
                <Text style={styles.statLabel}>Your avg APY</Text>
                <Text style={styles.statValue}>{avgApy.toFixed(2)}%</Text>
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
      >
        {filters.map((filter) => (
          <TouchableOpacity
            key={filter}
            style={[
              styles.filterChip,
              activeFilter === filter && styles.filterChipActive,
            ]}
            onPress={() => setActiveFilter(filter)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterText,
                activeFilter === filter && styles.filterTextActive,
              ]}
            >
              {filter}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      <View style={styles.content}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#175DA3" />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={refresh}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filteredTokens}
            keyExtractor={(item) => `${item.type}:${item.mint}${item.vaultAddress ? `:${item.vaultAddress}` : ''}`}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onRefresh={refresh}
            refreshing={refreshing}
            renderItem={({ item }) => (
              <EarnTokenItem
                type={item.type}
                mint={item.mint}
                symbol={item.symbol}
                vaultTitle={item.vaultTitle}
                logoUrl={item.logoUrl}
                rewardsRate={item.rewardsRate}
                positionAmount={item.position?.balance.uiAmount}
                onPress={() => setSelectedToken(item)}
              />
            )}
            ListEmptyComponent={
              <View style={styles.centered}>
                <Text style={styles.emptyText}>No earn opportunities available</Text>
              </View>
            }
          />
        )}
      </View>

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
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8EAF1',
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
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
    marginBottom: 0,
  },
  statsScroll: {
    maxHeight: 70,
    marginTop: 8,
    marginBottom: 12,
  },
  statsContainer: {
    paddingHorizontal: 14,
    gap: 10,
  },
  statCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minWidth: 150,
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
    color: '#6B7B8D',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
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
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  filterChipActive: {
    backgroundColor: '#19C394',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7B8D',
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  errorText: {
    fontSize: 15,
    color: '#F95357',
    marginBottom: 12,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#175DA3',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  emptyText: {
    fontSize: 15,
    color: '#808080',
  },
});
