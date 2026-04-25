import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { useWallet } from '../hooks/useWallet';
import { useAssets } from '../hooks/useAssets';
import { useEarnTokens } from '../hooks/useEarnTokens';
import { useRewards, invalidateRewards } from '../hooks/useRewards';
import { invalidateEarnTokens } from '../hooks/useEarnTokens';
import { attestSeekerIfNeeded } from '../services/rewardsService';
import { useToast } from '../contexts/ToastContext';
import { logBadgeMintAttempt, logBadgeMintSuccess, logBadgeMintError } from '../services/analyticsService';
import { useSolPrice } from '../hooks/useSolPrice';
import { useSuggestions } from '../hooks/useSuggestions';
import ActionButton from '../components/ActionButton';
import AssetRow from '../components/AssetRow';
import EarnTokenItem from '../components/EarnTokenItem';
import RewardsHomeSection from '../components/RewardsHomeSection';
import RewardBadgeSheet from '../components/RewardBadgeSheet';
import SectionCard from '../components/SectionCard';
import StatBox from '../components/StatBox';
import type { TaskWithProgress } from '../types/rewards';
import type { TabName } from '../components/TabBar';
import { ReceiveIcon, SendIcon, ConvertIcon, ProfileIcon, SupportIcon, QuestionsIcon } from '../assets/home-icons';
import { getTokenIcon } from '../assets/token-icons';
import SuggestionCard from '../components/SuggestionCard';
import ComingSoonModal from '../components/ComingSoonModal';
import ReceiveModal from '../components/ReceiveModal';
import SendModal from '../components/SendModal';
import SwapModal from '../components/SwapModal';
import FundWalletModal from '../components/FundWalletModal';
import { useNotifications } from '../hooks/useNotifications';
import Svg, { Path } from 'react-native-svg';
import {
  logScreenView,
  logHomeActionPress,
  logNotificationsBellPress,
  logSupportLinkPress,
  logQuestionsLinkPress,
  logComingSoonView,
  logReceiveModalOpen,
  logSendModalOpen,
  logSwapModalOpen,
  logReceiveFundFromSeeker,
  logSectionMorePress,
  logHomeRefresh,
} from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

// Bottom padding to account for floating tab bar
const TAB_BAR_PADDING = 120;

function formatUsd(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface HomeScreenProps {
  onNavigateToTab?: (tab: TabName) => void;
  onNavigate?: (screen: string) => void;
}

export default function HomeScreen({ onNavigateToTab, onNavigate }: HomeScreenProps) {
  const { colors } = useTheme();
  const { wallet, balance, connect } = useWallet();
  const { assets, totalUsdValue: assetsTotalUsd, loading: assetsLoading, refresh: refreshAssets } = useAssets();
  const { tokens, loading: earnLoading, refresh: refreshEarn } = useEarnTokens();
  const { price: solPrice, loading: solPriceLoading, refresh: refreshSolPrice } = useSolPrice();
  const { suggestions, refresh: refreshSuggestions } = useSuggestions();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRewardTask, setSelectedRewardTask] = useState<TaskWithProgress | null>(null);
  const [mintingTaskSlug, setMintingTaskSlug] = useState<string | null>(null);
  const [attestingSeeker, setAttestingSeeker] = useState(false);
  const { mint: mintReward } = useRewards();
  const { showToast } = useToast();
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [convertModalVisible, setConvertModalVisible] = useState(false);
  const [receiveModalVisible, setReceiveModalVisible] = useState(false);
  const [sendModalVisible, setSendModalVisible] = useState(false);
  const [fundWalletModalVisible, setFundWalletModalVisible] = useState(false);
  const { unreadCount } = useNotifications();

  React.useEffect(() => { logScreenView('HomeScreen'); }, []);

  const handleRefresh = useCallback(async () => {
    logHomeRefresh();
    setRefreshing(true);
    try {
      await Promise.all([
        refreshAssets(),
        refreshEarn(),
        refreshSolPrice(),
        refreshSuggestions(),
      ]);
      invalidateRewards();
    } finally {
      setRefreshing(false);
    }
  }, [refreshAssets, refreshEarn, refreshSolPrice, refreshSuggestions]);

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
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      {/* Header Gradient */}
      <LinearGradient
        colors={colors.homeGradient as unknown as string[]}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#fff"
            colors={['#fff']}
          />
        }
      >
        {/* Status Bar Area */}
        <SafeAreaView edges={['top']} style={styles.statusBar}>
          <View style={styles.statusBarContent}>
            <TouchableOpacity
              onPress={() => { logComingSoonView('profile'); setProfileModalVisible(true); }}
            >
              <ProfileIcon size={44} />
            </TouchableOpacity>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.bellButton}
                onPress={() => { logNotificationsBellPress(unreadCount); onNavigate?.('notifications'); }}
              >
                <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                {unreadCount > 0 && (
                  <View style={[styles.badge, { backgroundColor: colors.badge }]}>
                    <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>

        {/* Balance Display */}
        <View style={styles.balanceSection}>
          <Text style={[styles.balanceAmount, { color: colors.textPrimary }]}>
            {isLoading ? '...' : formatUsd(totalBalance)}
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <ActionButton
            icon={<ReceiveIcon size={32} />}
            label="Receive"
            onPress={() => { logHomeActionPress('receive'); logReceiveModalOpen(); setReceiveModalVisible(true); }}
            backgroundColor={colors.cardSecondary}
          />
          <ActionButton
            icon={<SendIcon size={32} />}
            label="Send"
            onPress={() => { logHomeActionPress('send'); logSendModalOpen(); setSendModalVisible(true); }}
            backgroundColor={colors.cardSecondary}
          />
          <ActionButton
            icon={<ConvertIcon size={32} />}
            label="Convert"
            onPress={() => { logHomeActionPress('convert'); logSwapModalOpen(); setConvertModalVisible(true); }}
            backgroundColor={colors.cardSecondary}
          />
        </View>

        <View style={styles.sections}>
        {/* Suggestions */}
        {suggestions.length === 1 && (
          <SuggestionCard
            suggestion={suggestions[0]}
            onFundWallet={() => setFundWalletModalVisible(true)}
            onTransferPosition={() => onNavigateToTab?.('earn')}
            onAddRecovery={() => onNavigate?.('keys-recovery')}
          />
        )}
        {suggestions.length > 1 && (
          <View style={styles.suggestionsWrapper}>
            <FlatList
              horizontal
              data={suggestions}
              keyExtractor={(s) => s.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestionsScroll}
              ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
              renderItem={({ item }) => (
                <SuggestionCard
                  suggestion={item}
                  compact
                  onFundWallet={() => setFundWalletModalVisible(true)}
                  onTransferPosition={() => onNavigateToTab?.('earn')}
                  onAddRecovery={() => onNavigate?.('keys-recovery')}
                />
              )}
            />
          </View>
        )}

        {/* Assets Section — hidden when empty */}
        {(assetsLoading || topAssets.length > 0) && (
        <SectionCard
          title="Assets"
          onMorePress={() => { logSectionMorePress('assets'); onNavigateToTab?.('assets'); }}
        >
          {assetsLoading ? (
            <ActivityIndicator size="small" color={colors.accentBlueDark} />
          ) : (
            topAssets.map((asset) => (
              <AssetRow key={asset.mint} item={asset} compact />
            ))
          )}
        </SectionCard>
        )}

        {/* Earn Section — hidden when no positions */}
        {(earnLoading || topEarnPositions.length > 0) && (
        <SectionCard
          title="Earn"
          onMorePress={() => { logSectionMorePress('earn'); onNavigateToTab?.('earn'); }}
        >
          {earnLoading ? (
            <ActivityIndicator size="small" color={colors.accentGreen} />
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
              {topEarnPositions.map((token) => (
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
                  protocolName={token.protocolName}
                  protocolIconUrl={token.protocolIconUrl}
                  compact
                />
              ))}
            </>
          )}
        </SectionCard>
        )}

        {/* Rewards Section */}
        <RewardsHomeSection onSelectTask={(task) => setSelectedRewardTask(task)} />

        {/* Useful Section */}
        <SectionCard title="Useful">
          <View style={[styles.solPrice, { backgroundColor: colors.cardSecondary }]}>
            <View style={[styles.solPriceIconContainer, { backgroundColor: colors.card }]}>
              <Image source={getTokenIcon('native')!} style={styles.solPriceIcon} />
            </View>
            <View>
              <Text style={[styles.solPriceLabel, { color: colors.textSecondary }]}>SOL</Text>
              <Text style={[styles.solPriceValue, { color: colors.textPrimary }]}>
                {solPriceLoading ? '...' : solPrice != null ? formatUsd(solPrice) : '--'}
              </Text>
            </View>
          </View>
          <View style={styles.helpButtons}>
            <TouchableOpacity style={[styles.helpButton, { backgroundColor: colors.cardSecondary }]} onPress={() => { logSupportLinkPress(); Linking.openURL('https://t.me/mike_cashflow'); }}>
              <SupportIcon size={20} />
              <Text style={[styles.helpButtonText, { color: colors.textPrimary }]}>Support</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.helpButton, { backgroundColor: colors.cardSecondary }]} onPress={() => { logQuestionsLinkPress(); Linking.openURL('https://t.me/mike_cashflow'); }}>
              <QuestionsIcon size={20} />
              <Text style={[styles.helpButtonText, { color: colors.textPrimary }]}>Questions</Text>
            </TouchableOpacity>
          </View>
        </SectionCard>

        <View style={{ height: TAB_BAR_PADDING }} />
        </View>
      </ScrollView>

      {/* Tab bar is rendered by App.tsx */}

      <RewardBadgeSheet
        task={selectedRewardTask}
        visible={selectedRewardTask !== null}
        onClose={() => setSelectedRewardTask(null)}
        minting={mintingTaskSlug !== null && mintingTaskSlug === selectedRewardTask?.slug}
        attesting={attestingSeeker}
        onAttestSeeker={async () => {
          if (attestingSeeker) return;
          setAttestingSeeker(true);
          try {
            await attestSeekerIfNeeded();
            invalidateRewards();
          } finally {
            setAttestingSeeker(false);
          }
        }}
        onMint={async (task) => {
          if (mintingTaskSlug) return; // already minting
          logBadgeMintAttempt(task.slug);
          setMintingTaskSlug(task.slug);
          try {
            await mintReward(task.slug);
            logBadgeMintSuccess(task.slug);
            showToast('Badge minted', task.title, 'success');
            setSelectedRewardTask(null);
          } catch (err: any) {
            const msg = err?.message ?? 'Mint failed';
            logBadgeMintError(task.slug, msg);
            showToast('Mint failed', msg, 'error');
          } finally {
            setMintingTaskSlug(null);
          }
        }}
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
        onFundFromSeeker={() => {
          logReceiveFundFromSeeker();
          setReceiveModalVisible(false);
          setFundWalletModalVisible(true);
        }}
      />
      <SendModal
        visible={sendModalVisible}
        onClose={() => setSendModalVisible(false)}
        onSuccess={refreshAssets}
      />
      <FundWalletModal
        visible={fundWalletModalVisible}
        onClose={() => setFundWalletModalVisible(false)}
        onSuccess={refreshAssets}
      />
      <SwapModal
        visible={convertModalVisible}
        onClose={() => setConvertModalVisible(false)}
        onSuccess={refreshAssets}
      />
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bellButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
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
  suggestionsWrapper: {
    marginHorizontal: -14,
  },
  suggestionsScroll: {
    paddingHorizontal: 14,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 8,
  },
  notification: {
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationIconText: {
    fontSize: 20,
  },
  notificationTitle: {
    fontSize: 14,
  },
  notificationSubtitle: {
    fontSize: 14,
  },
  solPrice: {
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  solPriceIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  solPriceIcon: {
    width: 24,
    height: 24,
  },
  solPriceLabel: {
    fontSize: 14,
  },
  solPriceValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  helpButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  helpButton: {
    flex: 1,
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
  },
});
