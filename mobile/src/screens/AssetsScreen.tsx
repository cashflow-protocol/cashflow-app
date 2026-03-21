import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { useAssets } from '../hooks/useAssets';
import { LifetimeEarnedIcon, Last7DIcon } from '../assets/stat-icons';
import AssetRow from '../components/AssetRow';
import { logScreenView } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

function formatUsd(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AssetsScreen() {
  const { colors } = useTheme();
  const { assets, totalUsdValue, loading, refreshing, refresh } = useAssets();

  React.useEffect(() => { logScreenView('AssetsScreen'); }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <LinearGradient
        colors={colors.assetsGradient as unknown as string[]}
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
        <View style={[styles.statCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
          <View style={styles.statRow}>
            <View style={[styles.statIconCircle, { backgroundColor: colors.accentBlue }]}>
              <LifetimeEarnedIcon size={20} />
            </View>
            <View>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Balance</Text>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>{formatUsd(totalUsdValue)}</Text>
            </View>
          </View>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
          <View style={styles.statRow}>
            <View style={[styles.statIconCircle, { backgroundColor: colors.accentBlue }]}>
              <Last7DIcon size={20} />
            </View>
            <View>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>24h change</Text>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>--</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accentBlue} />
        </View>
      ) : assets.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No assets found</Text>
        </View>
      ) : (
        <FlatList
          data={assets}
          keyExtractor={(item) => item.mint}
          renderItem={({ item }) => <AssetRow item={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accentBlue} />
          }
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 100,
  },
});
