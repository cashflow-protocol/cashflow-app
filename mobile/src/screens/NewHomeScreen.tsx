import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { useWallet } from '../hooks/useWallet';
import { useAssets } from '../hooks/useAssets';
import { useEarnTokens } from '../hooks/useEarnTokens';
import { useSolPrice } from '../hooks/useSolPrice';
import ActionButton from '../components/ActionButton';
import AssetRow from '../components/AssetRow';
import EarnTokenItem from '../components/EarnTokenItem';
import SectionCard from '../components/SectionCard';
import StatBox from '../components/StatBox';
import type { TabName } from '../components/TabBar';
import { ReceiveIcon, SendIcon, ConvertIcon, RewardsIcon, ProfileIcon } from '../assets/home-icons';
import ComingSoonModal from '../components/ComingSoonModal';
import ReceiveModal from '../components/ReceiveModal';
import SendModal from '../components/SendModal';

// Bottom padding to account for floating tab bar
const TAB_BAR_PADDING = 120;

function formatUsd(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface NewHomeScreenProps {
  onNavigateToTab?: (tab: TabName) => void;
}

export default function NewHomeScreen({ onNavigateToTab }: NewHomeScreenProps) {
  const { wallet, balance, connect } = useWallet();
  const { assets, totalUsdValue: assetsTotalUsd, loading: assetsLoading, refresh: refreshAssets } = useAssets();
  const { tokens, loading: earnLoading } = useEarnTokens();
  const { price: solPrice, loading: solPriceLoading } = useSolPrice();
  const [rewardsModalVisible, setRewardsModalVisible] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [convertModalVisible, setConvertModalVisible] = useState(false);
  const [receiveModalVisible, setReceiveModalVisible] = useState(false);
  const [sendModalVisible, setSendModalVisible] = useState(false);

  // Top 3 assets sorted by USD value descending
  const topAssets = useMemo(() => {
    return [...assets]
      .sort((a, b) => b.usdValue - a.usdValue)
      .slice(0, 3);
  }, [assets]);

  // Earn calculations (same pattern as EarnScreen)
  const earnStats = useMemo(() => {
    const totalDeposited = tokens.reduce(
      (sum, t) => sum + (t.position?.balance.usdValue ?? 0), 0,
    );

    const withPositions = tokens.filter(
      (t) => t.position && t.position.balance.usdValue > 0,
    );

    let avgApy = 0;
    if (withPositions.length > 0) {
      const totalUsd = withPositions.reduce(
        (sum, t) => sum + t.position!.balance.usdValue, 0,
      );
      const weightedSum = withPositions.reduce(
        (sum, t) => sum + (t.rewardsRate / 100) * t.position!.balance.usdValue, 0,
      );
      avgApy = weightedSum / totalUsd;
    }

    const annualizedIncome = totalDeposited * avgApy / 100;

    return { totalDeposited, avgApy, annualizedIncome };
  }, [tokens]);

  // Top 3 earn positions sorted by position USD value descending
  const topEarnPositions = useMemo(() => {
    return tokens
      .filter((t) => t.position && t.position.balance.usdValue > 0)
      .sort((a, b) => b.position!.balance.usdValue - a.position!.balance.usdValue)
      .slice(0, 3);
  }, [tokens]);

  // Combined total balance
  const totalBalance = assetsTotalUsd + earnStats.totalDeposited;
  const isLoading = assetsLoading || earnLoading;


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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Status Bar Area */}
        <SafeAreaView edges={['top']} style={styles.statusBar}>
          <View style={styles.statusBarContent}>
            <TouchableOpacity
              onPress={() => setProfileModalVisible(true)}
            >
              <ProfileIcon size={44} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.rewardsIcon}
              onPress={() => setRewardsModalVisible(true)}
            >
              <RewardsIcon size={36} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Balance Display */}
        <View style={styles.balanceSection}>
          <Text style={styles.balanceAmount}>
            {isLoading ? '...' : formatUsd(totalBalance)}
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <ActionButton
            icon={<ReceiveIcon size={32} />}
            label="Receive"
            onPress={() => setReceiveModalVisible(true)}
            backgroundColor="#171D26"
          />
          <ActionButton
            icon={<SendIcon size={32} />}
            label="Send"
            onPress={() => setSendModalVisible(true)}
            backgroundColor="#171D26"
          />
          <ActionButton
            icon={<ConvertIcon size={32} />}
            label="Convert"
            onPress={() => setConvertModalVisible(true)}
            backgroundColor="#171D26"
          />
        </View>

        <View style={styles.sections}>
        {/* Assets Section */}
        <SectionCard
          title="Assets"
          onMorePress={() => onNavigateToTab?.('assets')}
        >
          {assetsLoading ? (
            <ActivityIndicator size="small" color="#175DA3" />
          ) : topAssets.length === 0 ? (
            <Text style={styles.emptyText}>No assets</Text>
          ) : (
            topAssets.map((asset) => (
              <AssetRow key={asset.mint} item={asset} compact />
            ))
          )}
        </SectionCard>

        {/* Earn Section */}
        <SectionCard
          title="Earn"
          onMorePress={() => onNavigateToTab?.('earn')}
        >
          {earnLoading ? (
            <ActivityIndicator size="small" color="#19C394" />
          ) : (
            <>
              <View style={styles.statsRow}>
                <StatBox
                  label="Balance"
                  value={formatUsd(earnStats.totalDeposited)}
                />
                <StatBox
                  label="APY"
                  value={earnStats.avgApy > 0 ? `${earnStats.avgApy.toFixed(2)}%` : '--'}
                />
                <StatBox
                  label="Annualized"
                  value={earnStats.annualizedIncome > 0 ? formatUsd(earnStats.annualizedIncome) : '--'}
                />
              </View>
              {topEarnPositions.length === 0 ? (
                <Text style={styles.emptyText}>No active positions</Text>
              ) : (
                topEarnPositions.map((token) => (
                  <EarnTokenItem
                    key={`${token.type}:${token.mint}:${token.vaultAddress}`}
                    type={token.type}
                    mint={token.mint}
                    symbol={token.symbol}
                    vaultTitle={token.vaultTitle}
                    logoUrl={token.logoUrl}
                    rewardsRate={token.rewardsRate}
                    positionAmount={token.position?.balance.uiAmount}
                    positionUsdValue={token.position?.balance.usdValue}
                    compact
                  />
                ))
              )}
            </>
          )}
        </SectionCard>


        {/* Notification */}
        <View style={styles.notification}>
          <View style={styles.notificationIcon}>
            <Text style={styles.notificationIconText}>🔔</Text>
          </View>
          <View>
            <Text style={styles.notificationTitle}>Some notification</Text>
            <Text style={styles.notificationSubtitle}>Notification</Text>
          </View>
        </View>

        {/* Useful Section */}
        <SectionCard title="Useful">
          <View style={styles.solPrice}>
            <View style={styles.solPriceIcon}>
              <Text style={styles.solPriceIconText}>◎</Text>
            </View>
            <View>
              <Text style={styles.solPriceLabel}>SOL</Text>
              <Text style={styles.solPriceValue}>
                {solPriceLoading ? '...' : solPrice != null ? formatUsd(solPrice) : '--'}
              </Text>
            </View>
          </View>
          <View style={styles.helpButtons}>
            <TouchableOpacity style={styles.helpButton}>
              <Text style={styles.helpButtonIcon}>💬</Text>
              <Text style={styles.helpButtonText}>Support</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.helpButton}>
              <Text style={styles.helpButtonIcon}>❓</Text>
              <Text style={styles.helpButtonText}>Questions</Text>
            </TouchableOpacity>
          </View>
        </SectionCard>

        <View style={{ height: TAB_BAR_PADDING }} />
        </View>
      </ScrollView>

      {/* Tab bar is rendered by App.tsx */}

      <ComingSoonModal
        visible={rewardsModalVisible}
        onClose={() => setRewardsModalVisible(false)}
        icon={<RewardsIcon size={48} color="#175DA3" />}
        title="Rewards"
        subtitle="Rewards are under development. You'll be able to get rewards for current Cashflow usage, so check it out and earn some yield."
      />
      <ComingSoonModal
        visible={profileModalVisible}
        onClose={() => setProfileModalVisible(false)}
        icon={<ProfileIcon size={48} />}
        title="Profile"
        subtitle="Custom NFT profile pictures, social interactions, and much more. Coming soon."
      />
      <ReceiveModal
        visible={receiveModalVisible}
        onClose={() => setReceiveModalVisible(false)}
      />
      <SendModal
        visible={sendModalVisible}
        onClose={() => setSendModalVisible(false)}
        onSuccess={refreshAssets}
      />
      <ComingSoonModal
        visible={convertModalVisible}
        onClose={() => setConvertModalVisible(false)}
        icon={<ConvertIcon size={48} color="#175DA3" />}
        title="Convert"
        subtitle="Token swaps powered by Jupiter. Coming soon."
      />
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
    height: 463,
  },
  statusBar: {
    paddingTop: 0,
  },
  statusBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  rewardsIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceSection: {
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 0
  },
  balanceAmount: {
    fontSize: 48,
    fontWeight: '500',
    color: '#fff',
    textAlign: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingHorizontal: 20,
    marginTop: 0,
    marginBottom: 20,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    // No horizontal padding here — header/balance/buttons handle their own
  },
  sections: {
    paddingHorizontal: 14,
    gap: 14,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#808080',
    textAlign: 'center',
    paddingVertical: 8,
  },
  notification: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#9C42FF',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notificationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#14F195',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationIconText: {
    fontSize: 20,
  },
  notificationTitle: {
    fontSize: 14,
    color: '#000',
  },
  notificationSubtitle: {
    fontSize: 14,
    color: '#808080',
  },
  solPrice: {
    backgroundColor: '#F4F4F4',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  solPriceIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#14F195',
    justifyContent: 'center',
    alignItems: 'center',
  },
  solPriceIconText: {
    fontSize: 20,
    color: '#fff',
  },
  solPriceLabel: {
    fontSize: 14,
    color: '#808080',
  },
  solPriceValue: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  helpButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  helpButton: {
    flex: 1,
    backgroundColor: '#F4F4F4',
    borderRadius: 12,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  helpButtonIcon: {
    fontSize: 16,
  },
  helpButtonText: {
    fontSize: 14,
    color: '#000',
  },
});
