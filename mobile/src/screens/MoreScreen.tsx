import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Clipboard,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { LifetimeEarnedIcon, Last7DIcon } from '../assets/stat-icons';
import { getVault, clearVault, type VaultData } from '../services/vaultStorage';
import { getCloudPublicKey, getDevicePublicKey, getCloudPrivateKey, getDevicePrivateKey, deleteAllKeypairs, deleteDeviceKeypair } from '../services/keypairStorage';
import { reclaimRent } from '../services/squadsService';
import apiService from '../services/apiService';
import { APP_VERSION, BUILD_NUMBER } from '../config/version';
import {
  logScreenView,
  logMoreNavigate,
  logCopyAddress,
  logCopyPrivateKey,
  logReclaimRentPress,
  logReclaimRentSuccess,
  logReclaimRentError,
  logRemoveVaultPress,
  logRemoveVaultConfirm,
} from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

const squadAvatar = require('../assets/squad-avatar.webp');

interface MoreScreenProps {
  onNavigate?: (screen: string) => void;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatSol(amount: number | null): string {
  if (amount === null) return '';
  if (amount === 0) return '0 SOL';
  if (amount < 0.001) return '<0.001 SOL';
  return `${amount.toFixed(4)} SOL`;
}

export default function MoreScreen({ onNavigate }: MoreScreenProps) {
  const { colors } = useTheme();
  const [gradientHeight, setGradientHeight] = useState(220);
  const [vault, setVault] = useState<VaultData | null>(null);
  const [cloudPubkey, setCloudPubkey] = useState<string | null>(null);
  const [devicePubkey, setDevicePubkey] = useState<string | null>(null);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [vaultBalance, setVaultBalance] = useState<number | null>(null);
  const [cloudBalance, setCloudBalance] = useState<number | null>(null);
  const [deviceBalance, setDeviceBalance] = useState<number | null>(null);
  const [reclaimStatus, setReclaimStatus] = useState<string | null>(null);
  const [emptyAccounts, setEmptyAccounts] = useState<{ total: number; empty: number } | null>(null);

  useEffect(() => { logScreenView('MoreScreen'); }, []);

  useEffect(() => {
    (async () => {
      const v = await getVault();
      setVault(v);

      const [cloudPub, devicePub] = await Promise.all([
        getCloudPublicKey(),
        getDevicePublicKey(),
      ]);
      setCloudPubkey(cloudPub);
      setDevicePubkey(devicePub);
      setKeysLoaded(true);

      // Fetch SOL balances for all addresses
      const balanceAddresses = [
        v?.vaultAddress,
        cloudPub,
        devicePub,
      ];
      const balanceResults = await Promise.all(
        balanceAddresses.map(addr =>
          addr
            ? apiService.getWalletBalance(addr, SOL_MINT).then(r => r.uiAmount).catch(() => null)
            : Promise.resolve(null),
        ),
      );
      setVaultBalance(balanceResults[0]);
      setCloudBalance(balanceResults[1]);
      setDeviceBalance(balanceResults[2]);

      // Fetch empty token accounts for vault
      if (v?.vaultAddress) {
        apiService.getEmptyTokenAccounts(v.vaultAddress).then(setEmptyAccounts).catch(() => {});
      }
    })();
  }, []);

  const copyAddress = useCallback((addr: string, field: string) => {
    logCopyAddress(field);
    Clipboard.setString(addr);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const copyPrivateKey = useCallback((keyType: 'cloud' | 'device') => {
    logCopyPrivateKey(keyType);
    const label = keyType === 'cloud' ? 'Cloud' : 'Device';
    Alert.alert(
      `Export ${label} Private Key`,
      'This will copy the full private key to your clipboard. Anyone with this key can sign transactions. Make sure no one is watching your screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          style: 'destructive',
          onPress: async () => {
            const key = keyType === 'cloud'
              ? await getCloudPrivateKey()
              : await getDevicePrivateKey();
            if (key) {
              Clipboard.setString(key);
              setCopiedField(`${keyType}-private`);
              setTimeout(() => setCopiedField(null), 2000);
            }
          },
        },
      ],
    );
  }, []);

  const handleReclaimRent = useCallback(async () => {
    if (!vault) return;
    logReclaimRentPress();
    setReclaimStatus('Starting...');
    try {
      const result = await reclaimRent(vault.multisigAddress, (msg) => {
        setReclaimStatus(msg);
      });
      logReclaimRentSuccess(result.closed, result.skipped, result.failed);
      setReclaimStatus(`Done! Cancelled: ${result.cancelled}, Closed: ${result.closed}, Skipped: ${result.skipped}, Failed: ${result.failed}`);
      setTimeout(() => setReclaimStatus(null), 5000);
    } catch (err: any) {
      logReclaimRentError(err.message);
      setReclaimStatus(`Error: ${err.message}`);
      setTimeout(() => setReclaimStatus(null), 5000);
    }
  }, [vault]);

  const handleRemoveDeviceKey = useCallback(() => {
    Alert.alert(
      'Remove Device Key',
      'This will delete the device signing key from this device. The cloud key and vault will not be affected.\n\nYou can generate a new device key later, but you will need to re-add it to your multisig.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteDeviceKeypair();
            setDevicePubkey(null);
            setDeviceBalance(null);
          },
        },
      ],
    );
  }, []);

  const handleRemoveVaultData = useCallback(() => {
    Alert.alert(
      'Remove Vault Data',
      'This will delete the local vault data only. Your signing keys will not be removed.\n\nThe app will return to onboarding. You can re-link your vault or create a new one.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await clearVault();
            onNavigate?.('onboarding');
          },
        },
      ],
    );
  }, []);

  const handleRemoveVault = useCallback(() => {
    logRemoveVaultPress();
    Alert.alert(
      'Remove Vault',
      'This will delete the local vault data and signing keypairs. The onchain multisig will still exist but you will lose signing access from this device.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            logRemoveVaultConfirm();
            await Promise.all([clearVault(), deleteAllKeypairs()]);
            onNavigate?.('onboarding');
          },
        },
      ],
    );
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <LinearGradient
        colors={colors.earnGradient as unknown as string[]}
        style={[styles.headerGradient, { height: gradientHeight }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.title}>More</Text>
      </SafeAreaView>

      {/* Stats row */}
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
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Transactions</Text>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>0</Text>
            </View>
          </View>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <Last7DIcon size={20} />
            </View>
            <View>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Active since</Text>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>Today</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Squads Section */}
        <View style={styles.content}>
          <Text style={styles.sectionLabel}>Squads</Text>

          {vault ? (
            <>
            <TouchableOpacity
              style={[styles.vaultCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
              onPress={() => { logMoreNavigate('squads'); onNavigate?.('squads'); }}
              activeOpacity={0.7}
            >
              <View style={styles.vaultHeader}>
                <Image source={squadAvatar} style={styles.vaultAvatar} />
                <View style={styles.vaultHeaderInfo}>
                  <Text style={[styles.vaultName, { color: colors.textPrimary }]}>{vault.label}</Text>
                  <TouchableOpacity
                    onPress={() => copyAddress(vault.vaultAddress, 'vault')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.vaultAddress}>
                      {truncateAddress(vault.vaultAddress)}
                      {copiedField === 'vault' ? '  Copied!' : ''}
                    </Text>
                  </TouchableOpacity>
                  {vaultBalance !== null && (
                    <Text style={[styles.balanceText, { color: colors.textPrimary }]}>{formatSol(vaultBalance)}</Text>
                  )}
                  {emptyAccounts !== null && emptyAccounts.empty > 0 && (
                    <Text style={styles.emptyAccountsText}>
                      {emptyAccounts.empty} empty token account{emptyAccounts.empty !== 1 ? 's' : ''}
                    </Text>
                  )}
                </View>
                <Text style={[styles.menuArrow, { color: colors.textTertiary }]}>{'>'}</Text>
              </View>

              {/* Keypairs */}
              {keysLoaded && (
                <View style={[styles.keypairSection, { borderTopColor: colors.border }]}>
                  {!vault?.seekerMode && (
                    <>
                      <TouchableOpacity
                        style={styles.keypairRow}
                        onPress={() => cloudPubkey && copyAddress(cloudPubkey, 'cloud')}
                        activeOpacity={cloudPubkey ? 0.6 : 1}
                      >
                        <Text style={[styles.keypairLabel, { color: colors.textSecondary }]}>Cloud Key</Text>
                        {cloudPubkey ? (
                          <View style={styles.keypairRight}>
                            <Text style={[styles.keypairValue, { color: colors.textPrimary }]}>
                              {truncateAddress(cloudPubkey)}
                              {copiedField === 'cloud' ? '  Copied!' : ''}
                            </Text>
                            {cloudBalance !== null && (
                              <Text style={[styles.keypairBalance, { color: colors.textSecondary }]}>{formatSol(cloudBalance)}</Text>
                            )}
                          </View>
                        ) : (
                          <Text style={styles.keypairMissing}>Not found</Text>
                        )}
                      </TouchableOpacity>
                      {cloudPubkey && (
                        <TouchableOpacity
                          onPress={() => copyPrivateKey('cloud')}
                          activeOpacity={0.6}
                          hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
                        >
                          <Text style={styles.exportKeyText}>
                            {copiedField === 'cloud-private' ? 'Copied!' : 'Copy Private Key'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                  <TouchableOpacity
                    style={styles.keypairRow}
                    onPress={() => devicePubkey && copyAddress(devicePubkey, 'device')}
                    activeOpacity={devicePubkey ? 0.6 : 1}
                  >
                    <Text style={[styles.keypairLabel, { color: colors.textSecondary }]}>Device Key</Text>
                    {devicePubkey ? (
                      <View style={styles.keypairRight}>
                        <Text style={[styles.keypairValue, { color: colors.textPrimary }]}>
                          {truncateAddress(devicePubkey)}
                          {copiedField === 'device' ? '  Copied!' : ''}
                        </Text>
                        {deviceBalance !== null && (
                          <Text style={[styles.keypairBalance, { color: colors.textSecondary }]}>{formatSol(deviceBalance)}</Text>
                        )}
                      </View>
                    ) : (
                      <Text style={styles.keypairMissing}>Not found</Text>
                    )}
                  </TouchableOpacity>
                  {devicePubkey && (
                    <TouchableOpacity
                      onPress={() => copyPrivateKey('device')}
                      activeOpacity={0.6}
                      hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
                    >
                      <Text style={styles.exportKeyText}>
                        {copiedField === 'device-private' ? 'Copied!' : 'Copy Private Key'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.keysRecoveryButton}
              onPress={() => { logMoreNavigate('keys-recovery'); onNavigate?.('keys-recovery'); }}
              activeOpacity={0.7}
            >
              <Text style={styles.keysRecoveryButtonText}>Keys & Recovery</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.reclaimButton, { backgroundColor: colors.card }]}
              onPress={handleReclaimRent}
              activeOpacity={0.7}
              disabled={reclaimStatus !== null}
            >
              <Text style={styles.reclaimButtonText}>
                {reclaimStatus ?? 'Reclaim Rent'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.changePinButton, { backgroundColor: colors.card, borderColor: colors.textSecondary }]}
              onPress={() => { logMoreNavigate('change-pin'); onNavigate?.('change-pin'); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.changePinButtonText, { color: colors.textSecondary }]}>Change PIN</Text>
            </TouchableOpacity>

            {devicePubkey && (
              <TouchableOpacity
                style={[styles.removeButton, { backgroundColor: colors.card, borderColor: '#F5A623' }]}
                onPress={handleRemoveDeviceKey}
                activeOpacity={0.7}
              >
                <Text style={[styles.removeButtonText, { color: '#F5A623' }]}>Remove Device Key</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.removeButton, { backgroundColor: colors.card, borderColor: '#F5A623' }]}
              onPress={handleRemoveVaultData}
              activeOpacity={0.7}
            >
              <Text style={[styles.removeButtonText, { color: '#F5A623' }]}>Remove Vault Data</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.removeButton, { backgroundColor: colors.card, borderColor: colors.accentRed }]}
              onPress={handleRemoveVault}
              activeOpacity={0.7}
            >
              <Text style={[styles.removeButtonText, { color: colors.accentRed }]}>Remove Vault</Text>
            </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.menuCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
              onPress={() => { logMoreNavigate('squads'); onNavigate?.('squads'); }}
              activeOpacity={0.7}
            >
              <View style={styles.menuIconCircle}>
                <Text style={styles.menuIcon}>+</Text>
              </View>
              <View style={styles.menuInfo}>
                <Text style={[styles.menuTitle, { color: colors.textPrimary }]}>Create Vault</Text>
                <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>Set up a multisig self-custody vault</Text>
              </View>
              <Text style={[styles.menuArrow, { color: colors.textTertiary }]}>{'>'}</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={[styles.devNotice, { color: colors.textTertiary }]}>
          This screen is only for testing during development. It will be changed before launch in dApp Store.
        </Text>
        <Text style={[styles.versionText, { color: colors.textTertiary }]}>App version: {APP_VERSION} ({BUILD_NUMBER})</Text>
      </ScrollView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
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
  content: {
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7B8D',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  vaultCard: {
    borderRadius: 14,
    padding: 16,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  vaultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vaultAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 14,
  },
  vaultHeaderInfo: {
    flex: 1,
  },
  vaultName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  vaultAddress: {
    fontSize: 13,
    color: '#19C394',
    fontWeight: '500',
  },
  keypairSection: {
    marginTop: 14,
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 10,
  },
  keypairRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  keypairLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  keypairRight: {
    alignItems: 'flex-end' as const,
  },
  keypairValue: {
    fontSize: 13,
    fontWeight: '500',
  },
  keypairBalance: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  balanceText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  emptyAccountsText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#F5A623',
    marginTop: 2,
  },
  exportKeyText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#F95357',
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  keypairMissing: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F95357',
  },
  keysRecoveryButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#19C394',
  },
  keysRecoveryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  reclaimButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#19C394',
  },
  reclaimButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#19C394',
  },
  changePinButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  changePinButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  removeButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  removeButtonText: {
    fontSize: 15,
    fontWeight: '600',
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
    backgroundColor: '#19C394',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
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
  menuArrow: {
    fontSize: 18,
    fontWeight: '600',
  },
  devNotice: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
    marginHorizontal: 32,
    fontStyle: 'italic',
  },
  versionText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
