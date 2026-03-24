import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Animated,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { ArrowLeft, Wallet, CheckCircle2, ChevronRight, SearchX } from 'lucide-react-native';
import { useWallet } from '../hooks/useWallet';
import { getCloudPublicKey } from '../services/keypairStorage';
import apiService from '../services/apiService';
import Toast from '../components/Toast';
import { useTheme } from '../theme/ThemeContext';
import BottomSheet from '../components/BottomSheet';
import VaultRecoveryExecutionScreen from './VaultRecoveryExecutionScreen';

interface VaultRecoveryScreenProps {
  onComplete: () => void;
  onBack: () => void;
}

type RecoveryStep = 'connect' | 'searching' | 'no-results' | 'select' | 'confirm' | 'executing';

interface MultisigResult {
  multisigAddress: string;
  vaultAddress: string;
  threshold: number;
  memberCount: number;
  members: Array<{ address: string; permissions: { initiate: boolean; vote: boolean; execute: boolean } }>;
  matchesCloudKey?: boolean;
}

function truncateAddress(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export default function VaultRecoveryScreen({ onComplete, onBack }: VaultRecoveryScreenProps) {
  const { colors } = useTheme();
  const { connect: connectWallet } = useWallet();
  const [step, setStep] = useState<RecoveryStep>('connect');
  const [walletAddress, setWalletAddress] = useState('');
  const [vaults, setVaults] = useState<MultisigResult[]>([]);
  const [selectedVault, setSelectedVault] = useState<MultisigResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  // Animations
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 1, duration: 500, delay: 200, useNativeDriver: true }),
      Animated.timing(contentTranslateY, { toValue: 0, duration: 500, delay: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setToastVisible(true);
  }, []);

  const handleConnect = useCallback(async () => {

    setLoading(true);
    try {

      const account = await connectWallet();

      if (!account) {
        showToast('Failed to connect wallet');
        setLoading(false);
        return;
      }
      const address = account.publicKey as string;
      setWalletAddress(address);
      setStep('searching');

      // Fetch cloud key for cross-referencing
      const cloudKey = await getCloudPublicKey();

      // Search for vaults
      const result = await apiService.findVaultsByMember(address, cloudKey || undefined);
      const multisigs = result.multisigs;

      if (multisigs.length === 0) {
        setStep('no-results');
      } else if (multisigs.length === 1) {
        // Single match — auto-select
        setSelectedVault(multisigs[0]);
        setStep('confirm');
      } else if (cloudKey) {
        // Multiple matches — check if only one matches cloud key
        const cloudMatches = multisigs.filter((m) => m.matchesCloudKey);
        if (cloudMatches.length === 1) {
          setSelectedVault(cloudMatches[0]);
          setStep('confirm');
        } else {
          setVaults(multisigs);
          setStep('select');
        }
      } else {
        setVaults(multisigs);
        setStep('select');
      }
    } catch (err: any) {
      console.error('Recovery search error:', err);
      showToast(err.message || 'Failed to search for vaults');
      setStep('connect');
    } finally {
      setLoading(false);
    }
  }, [connectWallet, showToast]);

  const handleSelectVault = useCallback((vault: MultisigResult) => {
    setSelectedVault(vault);
    setStep('confirm');
  }, []);

  const handleRecover = useCallback(async () => {
    if (!selectedVault) return;

    // If wallet not connected, connect first then proceed
    let addr = walletAddress;
    if (!addr) {
      setManualModalVisible(false);
      await new Promise(r => setTimeout(r, 300));

      setLoading(true);
      try {
        const account = await connectWallet();
        if (!account) {
          showToast('Failed to connect wallet');
          setLoading(false);
          return;
        }
        addr = account.publicKey as string;
        setWalletAddress(addr);
      } catch (err: any) {
        const msg = err?.message || '';
        if (!msg.includes('CancellationException')) {
          showToast(msg || 'Failed to connect wallet');
        }
        setLoading(false);
        return;
      }
      setLoading(false);
    }

    setStep('executing');
  }, [selectedVault, walletAddress, connectWallet, showToast]);

  const handleManualLookup = useCallback(async () => {
    const trimmed = manualAddress.trim();
    if (!trimmed) return;
    setManualLoading(true);
    try {

      const result = await apiService.findVaultByAddress(trimmed);

      if (!result) {
        showToast('No vault found for this address');
        return;
      }
      setManualModalVisible(false);
      setManualAddress('');
      setSelectedVault(result);

      setStep('confirm');
    } catch (err: any) {
      showToast(err.message || 'Failed to look up vault');
    } finally {
      setManualLoading(false);
    }
  }, [manualAddress, showToast]);

  const handleTryDifferent = useCallback(() => {
    setWalletAddress('');
    setVaults([]);
    setSelectedVault(null);
    setStep('connect');
  }, []);

  const renderConnect = () => (
    <Animated.View style={[styles.centerContent, { opacity: contentOpacity, transform: [{ translateY: contentTranslateY }] }]}>
      <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
        <Wallet size={40} color="#fff" />
      </View>
      <Text style={[styles.title, { color: colors.onboardingText }]}>Recover Your Vault</Text>
      <Text style={[styles.description, { color: colors.onboardingTextMuted }]}>
        Connect the wallet you used when creating your Cashflow vault to find and recover it.
      </Text>
    </Animated.View>
  );

  const renderSearching = () => (
    <View style={styles.centerContent}>
      <ActivityIndicator size="large" color="#fff" />
      <Text style={[styles.title, { color: colors.onboardingText, marginTop: 24 }]}>Searching...</Text>
      <Text style={[styles.description, { color: colors.onboardingTextMuted }]}>
        Looking for vaults associated with{'\n'}{truncateAddress(walletAddress)}
      </Text>
    </View>
  );

  const renderNoResults = () => (
    <View style={styles.centerContent}>
      <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
        <SearchX size={40} color="#fff" />
      </View>
      <Text style={[styles.title, { color: colors.onboardingText }]}>No Vaults Found</Text>
      <Text style={[styles.description, { color: colors.onboardingTextMuted }]}>
        No Cashflow vaults were found for wallet{'\n'}{truncateAddress(walletAddress)}.{'\n\n'}Make sure you're connecting the same wallet you used when creating your vault.
      </Text>
      <TouchableOpacity
        onPress={() => setManualModalVisible(true)}
        activeOpacity={0.7}
        style={styles.manualEntryButton}
      >
        <Text style={styles.manualEntryText}>Enter vault address manually</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSelect = () => (
    <View style={styles.listContent}>
      <Text style={[styles.title, { color: colors.onboardingText, textAlign: 'left', marginBottom: 8 }]}>
        Select Your Vault
      </Text>
      <Text style={[styles.description, { color: colors.onboardingTextMuted, textAlign: 'left', marginBottom: 24 }]}>
        Multiple vaults found for this wallet. Select the one you want to recover.
      </Text>
      <FlatList
        data={vaults}
        keyExtractor={(item) => item.multisigAddress}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.vaultCard, { backgroundColor: 'rgba(255,255,255,0.12)' }]}
            onPress={() => handleSelectVault(item)}
            activeOpacity={0.7}
          >
            <View style={styles.vaultCardContent}>
              <View style={{ flex: 1 }}>
                <View style={styles.vaultCardHeader}>
                  <Text style={styles.vaultCardTitle}>{truncateAddress(item.vaultAddress)}</Text>
                  {item.matchesCloudKey && (
                    <CheckCircle2 size={18} color="#4ade80" />
                  )}
                </View>
                <Text style={styles.vaultCardSub}>
                  {item.threshold} of {item.memberCount} multisig
                </Text>
                <View style={styles.vaultCardMembers}>
                  {item.members.map((m) => (
                    <Text key={m.address} style={styles.vaultCardMember}>
                      {truncateAddress(m.address)}
                      {m.address === walletAddress ? ' (you)' : ''}
                    </Text>
                  ))}
                </View>
              </View>
              <ChevronRight size={20} color="rgba(255,255,255,0.5)" />
            </View>
          </TouchableOpacity>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );

  const renderConfirm = () => (
    <View style={styles.centerContent}>
      <View style={[styles.iconCircle, { backgroundColor: 'rgba(74, 222, 128, 0.2)' }]}>
        <CheckCircle2 size={40} color="#4ade80" />
      </View>
      <Text style={[styles.title, { color: colors.onboardingText }]}>Vault Found</Text>
      <Text style={[styles.description, { color: colors.onboardingTextMuted }]}>
        {truncateAddress(selectedVault?.vaultAddress || '')}
      </Text>
      <View style={[styles.detailCard, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Threshold</Text>
          <Text style={styles.detailValue}>{selectedVault?.threshold} of {selectedVault?.memberCount}</Text>
        </View>
        {selectedVault?.matchesCloudKey && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Cloud Key</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={14} color="#4ade80" />
              <Text style={[styles.detailValue, { color: '#4ade80' }]}>Matched</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );

  const renderStepContent = () => {

    switch (step) {
      case 'connect': return renderConnect();
      case 'searching': return renderSearching();
      case 'no-results': return renderNoResults();
      case 'select': return renderSelect();
      case 'confirm': return renderConfirm();
      case 'executing': return null; // Handled by full-screen execution component
    }
  };

  const renderBottomButton = () => {
    switch (step) {
      case 'connect':
        return (
          <>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.onboardingButton }]}
              onPress={handleConnect}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading ? (
                <ActivityIndicator color="#6d28d9" />
              ) : (
                <Text style={[styles.primaryButtonText, { color: colors.onboardingButtonText }]}>Connect Wallet</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setManualModalVisible(true)}
              activeOpacity={0.7}
              style={{ alignItems: 'center', marginTop: 16 }}
            >
              <Text style={{ color: colors.onboardingTextMuted, fontSize: 14 }}>Enter vault address manually</Text>
            </TouchableOpacity>
          </>
        );
      case 'no-results':
        return (
          <>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.onboardingButton }]}
              onPress={handleTryDifferent}
              activeOpacity={0.7}
            >
              <Text style={[styles.primaryButtonText, { color: colors.onboardingButtonText }]}>Try Different Wallet</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={{ alignItems: 'center', marginTop: 16 }}>
              <Text style={{ color: colors.onboardingTextMuted, fontSize: 14 }}>Go Back</Text>
            </TouchableOpacity>
          </>
        );
      case 'confirm':
        return (
          <>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.onboardingButton }]}
              onPress={handleRecover}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading ? (
                <ActivityIndicator color="#6d28d9" />
              ) : (
                <Text style={[styles.primaryButtonText, { color: colors.onboardingButtonText }]}>
                  {walletAddress ? 'Recover Vault' : 'Connect Wallet & Recover'}
                </Text>
              )}
            </TouchableOpacity>
            {vaults.length > 1 && (
              <TouchableOpacity onPress={() => setStep('select')} activeOpacity={0.7} style={{ alignItems: 'center', marginTop: 16 }}>
                <Text style={{ color: colors.onboardingTextMuted, fontSize: 14 }}>Choose Different Vault</Text>
              </TouchableOpacity>
            )}
          </>
        );
      default:
        return null;
    }
  };

  // Render execution screen when recovering
  if (step === 'executing' && selectedVault) {
    return (
      <VaultRecoveryExecutionScreen
        vault={selectedVault}
        walletAddress={walletAddress}
        onComplete={onComplete}
        onBack={() => setStep('confirm')}
      />
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={colors.onboardingGradient}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <Toast
        visible={toastVisible}
        message={toastMessage}
        type="warning"
        onDismiss={() => setToastVisible(false)}
      />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7} disabled={loading}>
          <ArrowLeft size={24} color={colors.onboardingText} />
        </TouchableOpacity>

        <View style={styles.content}>
          {renderStepContent()}
        </View>

        <View style={styles.bottomSection}>
          {renderBottomButton()}
        </View>
      </SafeAreaView>

      {/* Manual vault address bottom sheet */}
      <BottomSheet
        visible={manualModalVisible}
        onClose={() => { setManualModalVisible(false); setManualAddress(''); }}
        avoidKeyboard
      >
        <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Enter Vault Address</Text>
        <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
          Enter the multisig address, vault address, or any member's wallet address.
        </Text>
        <TextInput
          style={[styles.sheetInput, { backgroundColor: colors.inputBackground, color: colors.textPrimary }]}
          value={manualAddress}
          onChangeText={setManualAddress}
          placeholder="Multisig address..."
          placeholderTextColor={colors.placeholderColor}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleManualLookup}
        />
        <TouchableOpacity
          style={[styles.sheetButton, { backgroundColor: colors.accentBlue }, (manualLoading || manualAddress.trim().length === 0) && styles.sheetButtonDisabled]}
          onPress={handleManualLookup}
          disabled={manualLoading || manualAddress.trim().length === 0}
          activeOpacity={0.7}
        >
          {manualLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sheetButtonText}>Look Up</Text>
          )}
        </TouchableOpacity>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignSelf: 'flex-start',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centerContent: {
    alignItems: 'center',
  },
  listContent: {
    flex: 1,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  vaultCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  vaultCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vaultCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vaultCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  vaultCardSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  vaultCardMembers: {
    marginTop: 8,
    gap: 2,
  },
  vaultCardMember: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
  },
  manualEntryButton: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  manualEntryText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '500',
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  sheetSubtitle: {
    fontSize: 14,
  },
  sheetInput: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  sheetButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetButtonDisabled: {
    opacity: 0.5,
  },
  sheetButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  detailCard: {
    borderRadius: 16,
    padding: 16,
    marginTop: 24,
    width: '100%',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  bottomSection: {
    paddingHorizontal: 32,
    paddingBottom: 16,
  },
  primaryButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
