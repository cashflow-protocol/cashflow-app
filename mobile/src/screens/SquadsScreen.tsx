import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Clipboard,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { getVault } from '../services/vaultStorage';
import {
  createMultisig,
  getMultisigInfo,
  getVaultBalance,
  type MultisigInfo,
} from '../services/squadsService';
import { useWallet } from '../hooks/useWallet';
import type { VaultData } from '../services/vaultStorage';
import { logScreenView, logSquadsCreateVaultPress, logSquadsCreateVaultSuccess, logSquadsCreateVaultError, logSquadsCopyAddress, logSquadsAddMemberPress } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

const squadAvatar = require('../assets/squad-avatar.webp');

interface SquadsScreenProps {
  onNavigate: (screen: string) => void;
  onBack: () => void;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function SquadsScreen({ onNavigate, onBack }: SquadsScreenProps) {
  const { colors } = useTheme();
  const { wallet } = useWallet();
  const walletAddress = wallet?.publicKey as string | undefined;
  const [vaultData, setVaultData] = useState<VaultData | null>(null);
  const [multisigInfo, setMultisigInfo] = useState<MultisigInfo | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { logScreenView('SquadsScreen'); }, []);

  const loadVault = useCallback(async () => {
    setLoading(true);
    try {
      const stored = await getVault();
      setVaultData(stored);

      if (stored) {
        try {
          const [info, bal] = await Promise.all([
            getMultisigInfo(stored.multisigAddress),
            getVaultBalance(stored.multisigAddress),
          ]);
          setMultisigInfo(info);
          setBalance(bal);
        } catch (onChainErr) {
          // onchain data may not be available yet (tx still confirming)
          console.warn('onchain fetch pending, will retry on next load:', onChainErr);
        }
      }
    } catch (err) {
      console.error('Failed to load vault:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVault();
  }, [loadVault]);

  const waitForOnChainData = useCallback(async (multisigAddress: string, maxAttempts = 10) => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const [info, bal] = await Promise.all([
          getMultisigInfo(multisigAddress),
          getVaultBalance(multisigAddress),
        ]);
        setMultisigInfo(info);
        setBalance(bal);
        return;
      } catch {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!walletAddress) return;
    logSquadsCreateVaultPress();
    setCreating(true);
    try {
      const result = await createMultisig(walletAddress);
      logSquadsCreateVaultSuccess();

      // Show the vault immediately with local data
      const stored = await getVault();
      setVaultData(stored);

      // Poll until onchain data is available
      await waitForOnChainData(result.multisigAddress);
    } catch (err: any) {
      logSquadsCreateVaultError(err?.message || 'unknown');
      console.error('Failed to create vault:', err);
      Alert.alert('Error', err?.message || 'Failed to create vault. Please try again.');
    } finally {
      setCreating(false);
    }
  }, [walletAddress, waitForOnChainData]);

  const copyAddress = (addr: string) => {
    logSquadsCopyAddress();
    Clipboard.setString(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const permissionBadges = (perms: MultisigInfo['members'][0]['permissions']) => {
    const badges: string[] = [];
    if (perms.initiate) badges.push('Initiate');
    if (perms.vote) badges.push('Vote');
    if (perms.execute) badges.push('Execute');
    return badges;
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>

        <LinearGradient
          colors={colors.earnGradient as [string, string]}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
        <SafeAreaView edges={['top']} style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Squads Vault</Text>
        </SafeAreaView>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accentGreen} />
        </View>
      </View>
    );
  }

  // No vault exists — show onboarding
  if (!vaultData) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>

        <LinearGradient
          colors={colors.earnGradient as [string, string]}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
        <SafeAreaView edges={['top']} style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Squads Vault</Text>
        </SafeAreaView>
        <View style={styles.onboardingContainer}>
          <View style={[styles.onboardingCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
            <Image source={squadAvatar} style={styles.avatar} />
            <Text style={[styles.onboardingTitle, { color: colors.textPrimary }]}>Cashflow Vault</Text>
            <Text style={[styles.onboardingDescription, { color: colors.textSecondary }]}>
              Create a Squads multisig vault for enhanced security.
              Add multiple signing wallets so no single device
              controls your funds.
            </Text>
            <TouchableOpacity
              style={[styles.createButton, { backgroundColor: colors.accentGreen }, creating && styles.createButtonDisabled]}
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.primaryButtonText} />
                  <Text style={[styles.createButtonText, { color: colors.primaryButtonText }]}>Creating Vault...</Text>
                </View>
              ) : (
                <Text style={[styles.createButtonText, { color: colors.primaryButtonText }]}>Create Vault</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Vault exists — show dashboard (or confirming state)
  const isConfirming = !multisigInfo && creating;
  const memberCount = multisigInfo?.members.length ?? 0;
  const threshold = multisigInfo?.threshold ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      <LinearGradient
        colors={colors.earnGradient as [string, string]}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Image source={squadAvatar} style={styles.headerAvatar} />
        <Text style={styles.title}>{vaultData.label}</Text>
        {isConfirming ? (
          <View style={styles.confirmingRow}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.confirmingText}>Confirming on chain...</Text>
          </View>
        ) : (
          <Text style={styles.balanceText}>{balance.toFixed(4)} SOL</Text>
        )}
      </SafeAreaView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Vault Address Card */}
        <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
          <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>Vault Address</Text>
          <TouchableOpacity onPress={() => copyAddress(vaultData.vaultAddress)}>
            <Text style={[styles.addressText, { color: colors.accentGreen }]}>
              {truncateAddress(vaultData.vaultAddress)}
              {copied ? '  Copied!' : '  Tap to copy'}
            </Text>
          </TouchableOpacity>
        </View>

        {isConfirming ? (
          <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
            <View style={styles.confirmingCard}>
              <ActivityIndicator size="large" color={colors.accentGreen} />
              <Text style={[styles.confirmingCardTitle, { color: colors.textPrimary }]}>Setting up your vault</Text>
              <Text style={[styles.confirmingCardText, { color: colors.textSecondary }]}>
                Waiting for the transaction to confirm on Solana...
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/* Threshold Card */}
            <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
              <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>Approval Threshold</Text>
              <Text style={[styles.thresholdText, { color: colors.textPrimary }]}>
                {threshold} of {memberCount}
              </Text>
              <Text style={[styles.thresholdHint, { color: colors.textSecondary }]}>
                {threshold === 1
                  ? 'Any single member can approve transactions'
                  : `${threshold} members must approve each transaction`}
              </Text>
            </View>

            {/* Members */}
            <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
              <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>
                Signing Wallets ({memberCount})
              </Text>
              {multisigInfo?.members.map((member, idx) => (
                <View key={member.address} style={[styles.memberRow, { borderTopColor: colors.border }]}>
                  <View style={styles.memberInfo}>
                    <Text style={[styles.memberAddress, { color: colors.textPrimary }]}>
                      {truncateAddress(member.address)}
                    </Text>
                    <View style={styles.badgeRow}>
                      {permissionBadges(member.permissions).map((badge) => (
                        <View key={badge} style={[styles.badge, { backgroundColor: colors.successBackground }]}>
                          <Text style={[styles.badgeText, { color: colors.accentGreen }]}>{badge}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  {idx === 0 && (
                    <View style={[styles.youBadge, { backgroundColor: colors.accentGreen }]}>
                      <Text style={[styles.youBadgeText, { color: colors.primaryButtonText }]}>You</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>

            {/* Add Member Button */}
            <TouchableOpacity
              style={[styles.addMemberButton, { backgroundColor: colors.primaryButton }]}
              onPress={() => { logSquadsAddMemberPress(); onNavigate('add-member'); }}
            >
              <Text style={[styles.addMemberButtonText, { color: colors.primaryButtonText }]}>Add Signing Wallet</Text>
            </TouchableOpacity>
          </>
        )}
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
    height: 220,
  },
  header: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 16,
  },
  backButton: {
    position: 'absolute',
    left: 16,
    top: 52,
    zIndex: 1,
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
  },
  balanceText: {
    fontSize: 36,
    fontWeight: '700',
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  onboardingContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginTop: -40,
  },
  onboardingCard: {
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  onboardingTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  onboardingDescription: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 16,
  },
  headerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 8,
  },
  confirmingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmingText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  confirmingCard: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  confirmingCardTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  confirmingCardText: {
    fontSize: 14,
    textAlign: 'center',
  },
  createButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  createButtonDisabled: {
    opacity: 0.7,
  },
  createButtonText: {
    fontWeight: '700',
    fontSize: 16,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 120,
    gap: 12,
  },
  card: {
    borderRadius: 14,
    padding: 16,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addressText: {
    fontSize: 15,
    fontWeight: '500',
  },
  thresholdText: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  thresholdHint: {
    fontSize: 13,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  memberInfo: {
    flex: 1,
  },
  memberAddress: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  youBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  youBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  addMemberButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  addMemberButtonText: {
    fontWeight: '700',
    fontSize: 16,
  },
});
