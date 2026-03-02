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
import Svg, { Path } from 'react-native-svg';
import { LifetimeEarnedIcon, Last7DIcon } from '../assets/stat-icons';
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
          resizeMode="cover"
        />
        <View>
          <View style={styles.symbolRow}>
            <Text style={styles.assetSymbol}>{item.symbol}</Text>
            {item.isVerified && (
              <Svg width={16} height={16} viewBox="0 0 32 32" fill="none">
                <Path fillRule="evenodd" clipRule="evenodd" d="M13.9876 3.06079C15.0912 1.93067 16.9087 1.93066 18.0122 3.06079L19.5211 4.60602C20.0584 5.15634 20.7977 5.46257 21.5668 5.45341L23.7264 5.42769C25.3058 5.40888 26.591 6.69407 26.5722 8.27349L26.5465 10.4331C26.5373 11.2022 26.8436 11.9415 27.3939 12.4788L28.9391 13.9877C30.0692 15.0912 30.0692 16.9088 28.9391 18.0123L27.3939 19.5211C26.8436 20.0585 26.5373 20.7978 26.5465 21.5669L26.5722 23.7265C26.591 25.3059 25.3058 26.5911 23.7264 26.5723L21.5668 26.5466C20.7977 26.5374 20.0584 26.8436 19.5211 27.3939L18.0122 28.9392C16.9087 30.0693 15.0912 30.0693 13.9876 28.9392L12.4788 27.3939C11.9414 26.8436 11.2021 26.5374 10.433 26.5466L8.27343 26.5723C6.69401 26.5911 5.40881 25.3059 5.42763 23.7265L5.45335 21.5669C5.46251 20.7978 5.15628 20.0585 4.60596 19.5211L3.06073 18.0123C1.93061 16.9088 1.9306 15.0912 3.06072 13.9877L4.60596 12.4788C5.15628 11.9415 5.46251 11.2022 5.45335 10.4331L5.42763 8.27349C5.40881 6.69407 6.69401 5.40888 8.27343 5.42769L10.433 5.45341C11.2021 5.46257 11.9414 5.15634 12.4788 4.60602L13.9876 3.06079ZM16.5813 4.45805L18.0901 6.00329C19.0096 6.94495 20.2746 7.46895 21.5907 7.45327L23.7502 7.42755C24.2065 7.42211 24.5778 7.79339 24.5724 8.24967L24.5466 10.4092C24.531 11.7253 25.055 12.9903 25.9966 13.9098L27.5419 15.4187C27.8683 15.7375 27.8683 16.2625 27.5419 16.5813L25.9966 18.0902C25.055 19.0097 24.531 20.2747 24.5466 21.5907L24.5724 23.7503C24.5778 24.2066 24.2065 24.5779 23.7502 24.5724L21.5907 24.5467C20.2746 24.531 19.0096 25.055 18.0901 25.9967L16.5813 27.5419C16.2625 27.8684 15.7374 27.8684 15.4186 27.5419L13.9097 25.9967C12.9902 25.055 11.7252 24.531 10.4092 24.5467L8.2496 24.5724C7.79333 24.5779 7.42205 24.2066 7.42749 23.7503L7.45321 21.5907C7.46889 20.2747 6.94489 19.0097 6.00323 18.0902L4.458 16.5813C4.13151 16.2625 4.13152 15.7374 4.45799 15.4187L6.00323 13.9098C6.94489 12.9903 7.46889 11.7253 7.45321 10.4092L7.42749 8.24966C7.42205 7.79339 7.79333 7.42211 8.24961 7.42755L10.4092 7.45327C11.7252 7.46895 12.9902 6.94495 13.9097 6.00329L15.4186 4.45806C15.7374 4.13157 16.2625 4.13158 16.5813 4.45805Z" fill="#3985D8" />
                <Path d="M20.7893 13.6139C21.1284 13.178 21.0498 12.5497 20.6139 12.2106C20.1779 11.8716 19.5497 11.9501 19.2106 12.386L15.2359 17.4964L12.7035 14.9893C12.311 14.6008 11.6779 14.604 11.2893 14.9964C10.9007 15.3889 10.9039 16.0221 11.2964 16.4106L14.6297 19.7106C14.833 19.9118 15.1126 20.0164 15.3979 19.9979C15.6833 19.9794 15.9471 19.8396 16.1226 19.6139L20.7893 13.6139Z" fill="#3985D8" />
              </Svg>
            )}
          </View>
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
        colors={['#104982', '#3985D8']}
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
          <ActivityIndicator size="large" color="#3985D8" />
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
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#3985D8" />
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
    backgroundColor: '#3985D8',
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
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
