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

const ALL_FILTER = 'All';
const STABLES_FILTER = 'Stables';
const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT', 'JupUSD', 'USDG', 'USDS', 'PYUSD']);
const PINNED_FILTERS = [ALL_FILTER, STABLES_FILTER, 'SOL', 'USDC'];

export default function EarnScreen() {
  const { tokens, loading, refreshing, error, refresh } = useEarnTokens();
  const [activeFilter, setActiveFilter] = useState(ALL_FILTER);

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
        colors={['#175DA3', '#347AC0', '#8EB2D8', '#E8EAF1']}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.title}>Earn</Text>
        <Text style={styles.totalAmount}>${formatTotal(totalDeposited)}</Text>

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
      </SafeAreaView>

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
                onPress={() => console.log('Token pressed:', item.vaultTitle)}
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
    height: 280,
  },
  header: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 12,
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
    marginBottom: 16,
  },
  filtersScroll: {
    maxHeight: 36,
  },
  filtersContainer: {
    paddingHorizontal: 14,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  filterChipActive: {
    backgroundColor: '#fff',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  filterTextActive: {
    color: '#175DA3',
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
