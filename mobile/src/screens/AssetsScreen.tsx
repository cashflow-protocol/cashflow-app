import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  StatusBar,
  Image,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { useAssets } from '../hooks/useAssets';
import { getTokenIcon } from '../assets/token-icons';
import { LifetimeEarnedIcon, Last7DIcon, AvgApyIcon } from '../assets/stat-icons';
import type { WalletAsset } from '../types/earn';

function formatUsd(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAmount(value: number): string {
  if (value >= 1) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 0.001) return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return value.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

function AssetRow({ item }: { item: WalletAsset }) {
  const localIcon = getTokenIcon(item.mint);
  return (
    <View style={styles.assetRow}>
      <View style={styles.assetLeft}>
        <Image
          source={localIcon ?? { uri: item.logoUrl }}
          style={styles.tokenIcon}
          resizeMode="contain"
        />
        <View>
          <Text style={styles.assetSymbol}>{item.symbol}</Text>
          <Text style={styles.assetName}>{item.name}</Text>
        </View>
      </View>
      <View style={styles.assetRight}>
        <Text style={styles.assetUsd}>{formatUsd(item.usdValue)}</Text>
        <Text style={styles.assetAmount}>{formatAmount(item.uiAmount)} {item.symbol}</Text>
      </View>
    </View>
  );
}

export default function AssetsScreen() {
  const { assets, totalUsdValue, loading, refreshing, refresh } = useAssets();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <LinearGradient
        colors={['#1E8260', '#19C394']}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.title}>Assets</Text>
        <Text style={styles.totalAmount}>{formatUsd(totalUsdValue)}</Text>
      </SafeAreaView>

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
              <Text style={styles.statLabel}>Balance</Text>
              <Text style={styles.statValue}>{formatUsd(totalUsdValue)}</Text>
            </View>
          </View>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <Last7DIcon size={20} />
            </View>
            <View>
              <Text style={styles.statLabel}>24h change</Text>
              <Text style={styles.statValue}>--</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#19C394" />
        </View>
      ) : assets.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No assets found</Text>
        </View>
      ) : (
        <FlatList
          data={assets}
          keyExtractor={(item) => item.mint}
          renderItem={({ item }) => <AssetRow item={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#19C394" />
          }
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
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minWidth: 150,
    shadowColor: '#000',
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
    color: '#6B7B8D',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6B7B8D',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 100,
  },
  assetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  assetLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  assetSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  assetName: {
    fontSize: 13,
    color: '#6B7B8D',
    marginTop: 2,
  },
  assetRight: {
    alignItems: 'flex-end',
  },
  assetUsd: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  assetAmount: {
    fontSize: 13,
    color: '#6B7B8D',
    marginTop: 2,
  },
});
