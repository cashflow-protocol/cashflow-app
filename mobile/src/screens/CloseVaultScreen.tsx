import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { ArrowLeft, Cloud, Smartphone, TrendingUp, Wallet, Recycle, Trash2, Check } from 'lucide-react-native';
import { address } from '@solana/kit';
import Clipboard from '@react-native-clipboard/clipboard';
import BottomSheet from '../components/BottomSheet';
import { getVault, clearVault, type VaultData } from '../services/vaultStorage';
import { getCloudPublicKey, getDevicePublicKey, deleteAllKeypairs, clearCachedPin } from '../services/keypairStorage';
import walletService from '../services/walletService';
import { reclaimRent, executeVaultTransaction } from '../services/squadsService';
import apiService from '../services/apiService';
import { useEarnTokens } from '../hooks/useEarnTokens';
import { useAssets, invalidateAssets } from '../hooks/useAssets';
import { useDomainResolution } from '../hooks/useDomainResolution';
import { IS_SOLANA_MOBILE } from '../config/constants';
import type { WalletAsset } from '../types/earn';
import { logScreenView, logCloseVaultView, logCloseVaultPress, logCloseVaultConfirm, logReclaimRentPress, logReclaimRentSuccess, logReclaimRentError } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';
import type { ColorPalette } from '../theme/colors';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

function isNativeMint(mint: string): boolean {
  return mint === 'native' || mint === SOL_MINT;
}

interface CloseVaultScreenProps {
  onNavigate: (screen: string) => void;
  onBack: () => void;
}

const SOL_DUST_THRESHOLD = 0.000001;
const USD_DUST_THRESHOLD = 0.01;

function isSolDone(sol: number | null): boolean {
  return sol !== null && sol < SOL_DUST_THRESHOLD;
}

function isUsdDone(usd: number): boolean {
  return usd < USD_DUST_THRESHOLD;
}

function formatSol(sol: number | null): string {
  if (sol === null) return '—';
  if (sol < SOL_DUST_THRESHOLD) return '0 SOL';
  return `${sol.toFixed(6).replace(/\.?0+$/, '')} SOL`;
}

function formatUsd(usd: number): string {
  if (usd < USD_DUST_THRESHOLD) return '$0.00';
  return `$${usd.toFixed(2)}`;
}

export default function CloseVaultScreen({ onNavigate, onBack }: CloseVaultScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [vault, setVault] = useState<VaultData | null>(null);
  const [cloudPubkey, setCloudPubkey] = useState<string | null>(null);
  const [devicePubkey, setDevicePubkey] = useState<string | null>(null);

  const [cloudSol, setCloudSol] = useState<number | null>(null);
  const [deviceSol, setDeviceSol] = useState<number | null>(null);
  const [emptyAtaCount, setEmptyAtaCount] = useState<number | null>(null);

  const [reclaimStatus, setReclaimStatus] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const [sweepSheetVisible, setSweepSheetVisible] = useState(false);
  const [sweepDestination, setSweepDestination] = useState('');
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepProgress, setSweepProgress] = useState<string | null>(null);
  const [sweepError, setSweepError] = useState<string | null>(null);

  const { tokens: earnTokens, loading: earnLoading } = useEarnTokens();
  const { assets, loading: assetsLoading } = useAssets();

  useEffect(() => {
    logScreenView('CloseVaultScreen');
    logCloseVaultView();
  }, []);

  useEffect(() => {
    (async () => {
      const [v, cloud, device] = await Promise.all([
        getVault(),
        getCloudPublicKey(),
        getDevicePublicKey(),
      ]);
      setVault(v);
      setCloudPubkey(cloud);
      setDevicePubkey(device);
    })();
  }, []);

  const loadCloudSol = useCallback(async () => {
    if (!cloudPubkey) return;
    try {
      const sol = await walletService.getBalance(address(cloudPubkey));
      setCloudSol(sol);
    } catch {
      setCloudSol(0);
    }
  }, [cloudPubkey]);

  const loadDeviceSol = useCallback(async () => {
    if (!devicePubkey) return;
    try {
      const sol = await walletService.getBalance(address(devicePubkey));
      setDeviceSol(sol);
    } catch {
      setDeviceSol(0);
    }
  }, [devicePubkey]);

  const loadEmptyAtas = useCallback(async () => {
    if (!vault?.vaultAddress) return;
    try {
      const result = await apiService.getEmptyTokenAccounts(vault.vaultAddress);
      setEmptyAtaCount(result.empty);
    } catch {
      setEmptyAtaCount(0);
    }
  }, [vault]);

  useEffect(() => { loadCloudSol(); }, [loadCloudSol]);
  useEffect(() => { loadDeviceSol(); }, [loadDeviceSol]);
  useEffect(() => { loadEmptyAtas(); }, [loadEmptyAtas]);

  const earnUsd = useMemo(
    () => earnTokens.reduce((sum, t) => sum + (t.position?.balance.usdValue ?? 0), 0),
    [earnTokens],
  );

  // Native SOL is excluded from the Assets check — the vault keeps it for fee/rent on
  // subsequent close-vault operations and the user can't drain it from this screen.
  const sweepableAssets = useMemo<WalletAsset[]>(
    () => assets.filter((a) => !isNativeMint(a.mint) && a.uiAmount > 0),
    [assets],
  );
  const assetsUsd = useMemo(
    () => sweepableAssets.reduce((sum, a) => sum + (a.usdValue ?? 0), 0),
    [sweepableAssets],
  );

  const cloudDone = cloudPubkey === null || isSolDone(cloudSol);
  const deviceDone = devicePubkey === null || isSolDone(deviceSol);
  const earnDone = !earnLoading && isUsdDone(earnUsd);
  const assetsDone = !assetsLoading && isUsdDone(assetsUsd);
  const ataDone = emptyAtaCount !== null && emptyAtaCount === 0;

  const allLoaded =
    (cloudPubkey === null || cloudSol !== null) &&
    (devicePubkey === null || deviceSol !== null) &&
    !earnLoading &&
    !assetsLoading &&
    emptyAtaCount !== null;

  const allDone = allLoaded && cloudDone && deviceDone && earnDone && assetsDone && ataDone;

  const handleReclaimRent = useCallback(async () => {
    if (!vault || reclaimStatus !== null) return;
    logReclaimRentPress();
    setReclaimStatus('Starting...');
    try {
      const result = await reclaimRent(vault.multisigAddress, (msg) => setReclaimStatus(msg));
      logReclaimRentSuccess(result.closed, result.skipped, result.failed);
      setReclaimStatus(null);
      await loadEmptyAtas();
    } catch (err: any) {
      logReclaimRentError(err.message ?? 'unknown');
      setReclaimStatus(null);
      Alert.alert('Could not close accounts', err.message ?? 'Unknown error');
    }
  }, [vault, reclaimStatus, loadEmptyAtas]);

  const handleCloseVault = useCallback(() => {
    if (!allDone || closing) return;
    logCloseVaultPress();
    Alert.alert(
      'Close Vault',
      "This will delete the local vault data and signing keys from this device. The on-chain multisig will still exist but you'll lose signing access from this device. Continue?",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Vault',
          style: 'destructive',
          onPress: async () => {
            logCloseVaultConfirm();
            setClosing(true);
            try {
              await Promise.all([clearVault(), deleteAllKeypairs()]);
              await clearCachedPin();
              onNavigate('onboarding');
            } catch (err: any) {
              setClosing(false);
              Alert.alert('Error', err.message ?? 'Failed to close vault');
            }
          },
        },
      ],
    );
  }, [allDone, closing, onNavigate]);

  const handleEarnTap = useCallback(() => {
    onNavigate('earn-tab');
  }, [onNavigate]);

  const openSweepSheet = useCallback(() => {
    setSweepDestination('');
    setSweepError(null);
    setSweepProgress(null);
    setSweepSheetVisible(true);
  }, []);

  const closeSweepSheet = useCallback(() => {
    if (sweepRunning) return;
    setSweepSheetVisible(false);
  }, [sweepRunning]);

  const handlePasteDestination = useCallback(async () => {
    const text = await Clipboard.getString();
    if (text) setSweepDestination(text.trim());
  }, []);

  const recipientTrimmed = sweepDestination.trim();
  const { isDomain: isRecipientDomain, resolving: resolvingDomain, resolvedAddress, error: domainError } =
    useDomainResolution(sweepDestination);
  const isRecipientAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipientTrimmed);
  const isValidRecipient =
    isRecipientAddress || (isRecipientDomain && !!resolvedAddress && !resolvingDomain && !domainError);

  const handleSweepSubmit = useCallback(async () => {
    if (!vault || !isValidRecipient || sweepRunning || sweepableAssets.length === 0) return;
    const destinationAddress = isRecipientDomain && resolvedAddress ? resolvedAddress : recipientTrimmed;

    setSweepRunning(true);
    setSweepError(null);

    let i = 0;
    try {
      for (const asset of sweepableAssets) {
        i += 1;
        setSweepProgress(`Sending ${asset.symbol} (${i}/${sweepableAssets.length})...`);
        const res = await apiService.transferInstructions({
          mint: asset.mint,
          amount: asset.amount,
          ownerAddress: vault.vaultAddress,
          destinationAddress,
          walletAddress: vault.vaultAddress,
          decimals: asset.decimals,
        });
        await executeVaultTransaction(
          vault.multisigAddress,
          res.instructions,
          undefined,
          res.transactionId,
          undefined,
          IS_SOLANA_MOBILE,
        );
      }
      setSweepProgress(null);
      setSweepSheetVisible(false);
      invalidateAssets();
    } catch (err: any) {
      setSweepError(err.message ?? 'Transfer failed');
      setSweepProgress(null);
      // Refresh so the user sees what made it through
      invalidateAssets();
    } finally {
      setSweepRunning(false);
    }
  }, [vault, isValidRecipient, sweepRunning, sweepableAssets, isRecipientDomain, resolvedAddress, recipientTrimmed]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={colors.moreGradient as [string, string]}
        style={[styles.headerGradient, Platform.OS === 'android' && { paddingBottom: 16 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <TouchableOpacity onPress={onBack} style={[styles.backButton, { top: insets.top + 8 }]} activeOpacity={0.7}>
          <ArrowLeft size={24} color="#fff" />
        </TouchableOpacity>
        <SafeAreaView edges={['top']} style={styles.header}>
          <View style={[styles.headerContent, Platform.OS === 'android' && { paddingTop: 4, paddingBottom: 4 }]}>
            <Text style={styles.title}>Close Vault</Text>
            <Text style={styles.subtitle}>Empty everything before wiping this device</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          {cloudPubkey && (
            <Block
              colors={colors}
              icon={<Cloud size={22} color="#fff" />}
              iconBg="#3985D8"
              title="Cloud Wallet"
              subtitle={cloudDone ? 'Cleared' : 'Drain this address before closing'}
              loading={cloudSol === null}
              done={cloudDone}
              valueText={formatSol(cloudSol)}
            />
          )}

          {devicePubkey && (
            <Block
              colors={colors}
              icon={<Smartphone size={22} color="#fff" />}
              iconBg="#6B7B8D"
              title="Device Wallet"
              subtitle={deviceDone ? 'Cleared' : 'Drain this address before closing'}
              loading={deviceSol === null}
              done={deviceDone}
              valueText={formatSol(deviceSol)}
            />
          )}

          <Block
            colors={colors}
            icon={<TrendingUp size={22} color="#fff" />}
            iconBg="#19C394"
            title="Earn"
            subtitle={earnDone ? 'No active positions' : 'Withdraw earn positions first'}
            loading={earnLoading}
            done={earnDone}
            valueText={formatUsd(earnUsd)}
            onPress={!earnDone && !earnLoading ? handleEarnTap : undefined}
          />

          <Block
            colors={colors}
            icon={<Wallet size={22} color="#fff" />}
            iconBg="#175DA3"
            title="Assets"
            subtitle={assetsDone ? 'No assets in vault' : 'Tap to send all tokens to a wallet'}
            loading={assetsLoading}
            done={assetsDone}
            valueText={formatUsd(assetsUsd)}
            onPress={!assetsDone && !assetsLoading ? openSweepSheet : undefined}
          />

          <Block
            colors={colors}
            icon={<Recycle size={22} color="#fff" />}
            iconBg="#F5A623"
            title="Close token accounts"
            subtitle={
              reclaimStatus
                ? reclaimStatus
                : ataDone
                  ? 'No empty accounts'
                  : 'Tap to reclaim rent from empty accounts'
            }
            loading={emptyAtaCount === null}
            done={ataDone}
            valueText={`${emptyAtaCount ?? 0} ${(emptyAtaCount ?? 0) === 1 ? 'account' : 'accounts'}`}
            onPress={!ataDone && reclaimStatus === null && emptyAtaCount !== null ? handleReclaimRent : undefined}
            busy={reclaimStatus !== null}
          />
        </View>

        <View style={styles.ctaSection}>
          <TouchableOpacity
            style={[
              styles.closeButton,
              {
                backgroundColor: colors.card,
                borderColor: allDone ? colors.accentRed : colors.border,
                opacity: allDone && !closing ? 1 : 0.5,
              },
            ]}
            onPress={handleCloseVault}
            activeOpacity={0.7}
            disabled={!allDone || closing}
          >
            {closing ? (
              <ActivityIndicator size="small" color={colors.accentRed} />
            ) : (
              <>
                <Trash2 size={18} color={allDone ? colors.accentRed : colors.textTertiary} style={{ marginRight: 8 }} />
                <Text style={[styles.closeButtonText, { color: allDone ? colors.accentRed : colors.textTertiary }]}>
                  Close Vault
                </Text>
              </>
            )}
          </TouchableOpacity>

          {!allDone && allLoaded && (
            <Text style={[styles.helpText, { color: colors.textTertiary }]}>
              Empty every block above to enable Close Vault.
            </Text>
          )}
        </View>
      </ScrollView>

      <BottomSheet visible={sweepSheetVisible} onClose={closeSweepSheet} avoidKeyboard>
        <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Send all assets</Text>
        <Text style={[styles.sheetDesc, { color: colors.textSecondary }]}>
          Transfers every token from this vault to the address below. Native SOL stays in the vault to cover rent on subsequent close steps.
        </Text>

        <View style={[styles.sheetInputRow, { backgroundColor: colors.inputBackground }]}>
          <TextInput
            style={[styles.sheetInput, { color: colors.textPrimary }]}
            value={sweepDestination}
            onChangeText={setSweepDestination}
            placeholder="Recipient address or .sol domain"
            placeholderTextColor={colors.placeholderColor}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!sweepRunning}
          />
          <TouchableOpacity
            style={[styles.sheetPasteButton, { backgroundColor: colors.pillButton }]}
            onPress={handlePasteDestination}
            disabled={sweepRunning}
          >
            <Text style={[styles.sheetPasteText, { color: colors.pillButtonText }]}>Paste</Text>
          </TouchableOpacity>
        </View>

        {isRecipientDomain && resolvingDomain && (
          <Text style={[styles.sheetHelperText, { color: colors.textSecondary }]}>Resolving {recipientTrimmed}...</Text>
        )}
        {isRecipientDomain && resolvedAddress && !resolvingDomain && (
          <Text style={[styles.sheetHelperText, { color: colors.textSecondary }]}>→ {resolvedAddress.slice(0, 6)}...{resolvedAddress.slice(-4)}</Text>
        )}
        {isRecipientDomain && domainError && !resolvingDomain && (
          <Text style={[styles.sheetHelperText, { color: colors.errorText }]}>{domainError}</Text>
        )}
        {recipientTrimmed.length > 0 && !isValidRecipient && !isRecipientDomain && (
          <Text style={[styles.sheetHelperText, { color: colors.errorText }]}>Invalid Solana address</Text>
        )}

        <View style={[styles.sheetSummary, { backgroundColor: colors.cardSecondary }]}>
          <Text style={[styles.sheetSummaryLabel, { color: colors.textSecondary }]}>To send</Text>
          <Text style={[styles.sheetSummaryValue, { color: colors.textPrimary }]}>
            {sweepableAssets.length} {sweepableAssets.length === 1 ? 'token' : 'tokens'} · {formatUsd(assetsUsd)}
          </Text>
        </View>

        {sweepProgress && (
          <Text style={[styles.sheetHelperText, { color: colors.textSecondary }]}>{sweepProgress}</Text>
        )}
        {sweepError && (
          <View style={[styles.sheetErrorBanner, { backgroundColor: colors.errorBackground }]}>
            <Text style={[styles.sheetErrorText, { color: colors.errorText }]}>{sweepError}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.sheetSubmit,
            {
              backgroundColor:
                isValidRecipient && sweepableAssets.length > 0 && !sweepRunning
                  ? colors.primaryButton
                  : colors.disabledButton,
            },
          ]}
          onPress={handleSweepSubmit}
          disabled={!isValidRecipient || sweepableAssets.length === 0 || sweepRunning}
          activeOpacity={0.7}
        >
          {sweepRunning ? (
            <ActivityIndicator size="small" color={colors.primaryButtonText} />
          ) : (
            <Text style={[styles.sheetSubmitText, { color: colors.primaryButtonText }]}>
              Send all assets
            </Text>
          )}
        </TouchableOpacity>
      </BottomSheet>
    </View>
  );
}

interface BlockProps {
  colors: ColorPalette;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  loading: boolean;
  done: boolean;
  valueText: string;
  onPress?: () => void;
  busy?: boolean;
}

function Block({ colors, icon, iconBg, title, subtitle, loading, done, valueText, onPress, busy }: BlockProps) {
  const Container: any = onPress ? TouchableOpacity : View;
  const containerProps = onPress ? { onPress, activeOpacity: 0.7, disabled: busy } : {};

  return (
    <Container
      style={[styles.menuCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
      {...containerProps}
    >
      <View style={[styles.menuIconCircle, { backgroundColor: iconBg }]}>{icon}</View>
      <View style={styles.menuInfo}>
        <Text style={[styles.menuTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.rightSlot}>
        {loading || busy ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : done ? (
          <View style={[styles.donePill, { backgroundColor: colors.successBackground }]}>
            <Check size={12} color={colors.successText} style={{ marginRight: 3 }} />
            <Text style={[styles.donePillText, { color: colors.successText }]}>Done</Text>
          </View>
        ) : (
          <Text style={[styles.valueText, { color: colors.textPrimary }]}>{valueText}</Text>
        )}
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerGradient: {
    paddingBottom: 40,
  },
  header: {},
  backButton: {
    position: 'absolute',
    top: 8,
    left: 16,
    zIndex: 1,
    padding: 4,
  },
  headerContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    lineHeight: 18,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 10,
  },
  menuCard: {
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  menuIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuInfo: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 13,
  },
  rightSlot: {
    marginLeft: 10,
    alignItems: 'flex-end',
    minWidth: 60,
  },
  valueText: {
    fontSize: 14,
    fontWeight: '600',
  },
  donePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  donePillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  ctaSection: {
    paddingHorizontal: 14,
    paddingTop: 24,
    gap: 10,
  },
  closeButton: {
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  helpText: {
    fontSize: 12,
    textAlign: 'center',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  sheetDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  sheetInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  sheetInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 14,
  },
  sheetPasteButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sheetPasteText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sheetHelperText: {
    fontSize: 13,
    marginTop: 6,
  },
  sheetSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  sheetSummaryLabel: {
    fontSize: 13,
  },
  sheetSummaryValue: {
    fontSize: 15,
    fontWeight: '600',
  },
  sheetErrorBanner: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
  },
  sheetErrorText: {
    fontSize: 14,
    fontWeight: '500',
  },
  sheetSubmit: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  sheetSubmitText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
