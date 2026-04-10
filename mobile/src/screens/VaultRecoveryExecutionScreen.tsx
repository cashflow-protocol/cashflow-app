import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Mail,
  Wallet,
  Cloud,
  Send,
} from 'lucide-react-native';
import { saveVault, VaultData } from '../services/vaultStorage';
import { buildAndSubmitRecoveryProposal, executeRecoveryProposal } from '../services/recoveryService';
import { backupCloudKeyToBlockStore } from '../services/keypairStorage';
import { IS_SOLANA_MOBILE } from '../config/constants';
import apiService from '../services/apiService';
import walletService from '../services/walletService';
import BottomSheet from '../components/BottomSheet';
import { useToast } from '../contexts/ToastContext';
import { useLoginWithEmail, useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { VersionedTransaction } from '@solana/web3.js';

import { useTheme } from '../theme/ThemeContext';

interface MultisigResult {
  multisigAddress: string;
  vaultAddress: string;
  threshold: number;
  memberCount: number;
  members: Array<{ address: string; permissions: { initiate: boolean; vote: boolean; execute: boolean } }>;
  matchesCloudKey?: boolean;
}

interface VaultRecoveryExecutionScreenProps {
  vault: MultisigResult;
  walletAddress: string;
  pin?: string;
  onComplete: () => void;
  onBack: () => void;
}

type ExecutionStep = 'building' | 'error' | 'signing' | 'ready' | 'executing';

function truncateAddress(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

const OtpInput = React.forwardRef<{ focus: () => void }, {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  onComplete?: () => void;
}>(({ value, onChange, disabled, onComplete }, ref) => {
  const inputRef = useRef<TextInput>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const digits = value.split('');

  React.useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  return (
    <View style={styles.otpContainer}>
      <TextInput
        ref={inputRef}
        style={styles.otpHiddenInput}
        value={value}
        onChangeText={(t) => {
          const cleaned = t.replace(/[^0-9]/g, '').slice(0, 6);
          onChange(cleaned);
          if (cleaned.length === 6) {
            setTimeout(() => onCompleteRef.current?.(), 50);
          }
        }}
        keyboardType="number-pad"
        maxLength={6}
        editable={!disabled}
        caretHidden
      />
      <View style={styles.otpCells}>
        {Array.from({ length: 6 }).map((_, i) => {
          const isFocused = value.length === i;
          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.otpCell,
                { borderColor: isFocused ? '#a78bfa' : 'rgba(255,255,255,0.15)' },
              ]}
              activeOpacity={1}
              onPress={() => inputRef.current?.focus()}
            >
              <Text style={styles.otpDigit}>
                {digits[i] || ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
});

export default function VaultRecoveryExecutionScreen({
  vault,
  walletAddress,
  pin,
  onComplete,
  onBack,
}: VaultRecoveryExecutionScreenProps) {
  const { colors } = useTheme();
  const { showToast: showToastCtx } = useToast();
  const [step, setStep] = useState<ExecutionStep>('building');
  const [statusText, setStatusText] = useState('Preparing recovery...');
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [transactionIndex, setTransactionIndex] = useState<number | null>(null);
  const [externalSigningUrl, setExternalSigningUrl] = useState<string | null>(null);
  const [signers, setSigners] = useState<Array<{
    address: string;
    type: string;
    label?: string;
    email?: string;
    signed: boolean;
  }>>([]);
  const [signaturesCollected, setSignaturesCollected] = useState(0);
  const [threshold, setThreshold] = useState(0);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Privy email signing state
  const [privySheetVisible, setPrivySheetVisible] = useState(false);
  const [privyStep, setPrivyStep] = useState<'email' | 'otp' | 'signing'>('email');
  const [privyEmail, setPrivyEmail] = useState('');
  const [privyOtp, setPrivyOtp] = useState('');
  const [privySending, setPrivySending] = useState(false);
  const [privyError, setPrivyError] = useState<string | null>(null);
  const [privySignerAddress, setPrivySignerAddress] = useState('');

  const privyEmailRef = useRef<TextInput>(null);
  const privyOtpRef = useRef<{ focus: () => void }>(null);

  // Focus inputs after bottom sheet animation settles
  useEffect(() => {
    if (!privySheetVisible) return;
    const timer = setTimeout(() => {
      if (privyStep === 'email') privyEmailRef.current?.focus();
      else if (privyStep === 'otp') privyOtpRef.current?.focus();
    }, 400);
    return () => clearTimeout(timer);
  }, [privySheetVisible, privyStep]);

  // Privy hooks
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const embeddedWallet = useEmbeddedSolanaWallet();
  const walletRef = useRef(embeddedWallet);
  walletRef.current = embeddedWallet;
  const { logout: privyLogout } = usePrivy();

  const handleRefresh = useCallback(async () => {
    if (!proposalId) return;
    setRefreshing(true);
    try {
      const status = await apiService.getRecoveryProposalStatus(proposalId);
      setSigners(status.requiredSigners);
      setSignaturesCollected(status.signaturesCollected);
      if (status.transactionIndex != null) setTransactionIndex(status.transactionIndex);
      if (status.status === 'ready') {
        setStep('ready');
        if (pollRef.current) clearInterval(pollRef.current);
      }
    } catch {}
    setRefreshing(false);
  }, [proposalId]);

  const showToast = useCallback((msg: string, type: 'success' | 'warning' = 'warning') => {
    showToastCtx(type === 'success' ? 'Success' : 'Error', msg, type);
  }, [showToastCtx]);

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const status = await apiService.getRecoveryProposalStatus(id);
        setSigners(status.requiredSigners);
        setSignaturesCollected(status.signaturesCollected);

        if (status.status === 'ready') {
          setStep('ready');
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    }, 5000);
  }, []);

  const build = useCallback(async () => {
    setStep('building');
    setStatusText('Preparing recovery...');
    try {
      const result = await buildAndSubmitRecoveryProposal(
        vault.multisigAddress,
        vault.vaultAddress,
        walletAddress,
        vault.members,
        vault.threshold,
        (msg) => setStatusText(msg),
      );

      setProposalId(result.proposalId);
      setThreshold(result.signaturesRequired);
      setSignaturesCollected(result.signaturesCollected);
      setExternalSigningUrl(result.externalSigningUrl);

      if (result.status === 'ready') {
        setStep('ready');
      } else {
        setStep('signing');
        startPolling(result.proposalId);
      }

      // Load initial signer status
      const status = await apiService.getRecoveryProposalStatus(result.proposalId);
      setSigners(status.requiredSigners);
      setSignaturesCollected(status.signaturesCollected);
      if (status.transactionIndex != null) setTransactionIndex(status.transactionIndex);
      if (status.status === 'ready') {
        setStep('ready');
      }
    } catch (err: any) {
      console.error('Recovery build error:', err);
      setStatusText(err.message || 'Failed to build recovery proposal');
      setStep('error');
    }
  }, [vault, walletAddress, showToast, startPolling]);

  // Build on mount
  useEffect(() => {
    build();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handlePrivySign = useCallback((address: string, email?: string) => {
    setPrivySignerAddress(address);
    setPrivyEmail(email || '');
    setPrivyOtp('');
    setPrivyError(null);
    setPrivyStep('email');
    setPrivySheetVisible(true);
  }, []);

  const handlePrivySendCode = useCallback(async () => {
    const trimmed = privyEmail.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setPrivyError('Please enter a valid email address');
      return;
    }
    setPrivySending(true);
    setPrivyError(null);
    try {
      await privyLogout().catch(() => {});
      await sendCode({ email: trimmed });
      setPrivyStep('otp');
    } catch (err: any) {
      setPrivyError(err?.message || 'Failed to send code');
    } finally {
      setPrivySending(false);
    }
  }, [privyEmail, sendCode, privyLogout]);

  const handlePrivyVerifyAndSign = useCallback(async () => {
    if (privyOtp.length !== 6) return;
    if (!proposalId) {
      setPrivyError('Proposal not available. Try refreshing.');
      return;
    }

    setPrivySending(true);
    setPrivyError(null);
    setPrivyStep('signing');

    try {
      // Fetch transactionIndex if we don't have it yet
      let txIndex = transactionIndex;
      if (txIndex == null) {
        const status = await apiService.getRecoveryProposalStatus(proposalId);
        txIndex = status.transactionIndex;
        if (txIndex != null) setTransactionIndex(txIndex);
      }
      if (txIndex == null) {
        throw new Error('Could not get transaction index from proposal');
      }
      // Step 1: Verify OTP — authenticates user with Privy
      await loginWithCode({ code: privyOtp, email: privyEmail.trim() });

      // Step 2: Wait for embedded wallet to connect
      let walletReady = false;
      for (let i = 0; i < 30; i++) {
        const w = walletRef.current;
        if (w.status === 'connected' && w.wallets.length > 0) {
          walletReady = true;
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!walletReady) {
        throw new Error('Failed to connect to Privy wallet. Please try again.');
      }

      // Step 3: Get provider for signing
      const wallets = walletRef.current.wallets;
      if (!wallets || wallets.length === 0) {
        throw new Error('Privy wallet not available');
      }
      const provider = await wallets[0].getProvider();

      // Step 4: Build unsigned approve TX from backend (MWA wallet pays fees)
      const { transaction: txBase64 } = await apiService.buildApproveTx(
        privySignerAddress,
        vault.multisigAddress,
        txIndex,
        walletAddress, // fee payer = MWA wallet
      );

      // Step 5: Deserialize and sign with Privy wallet (approve instruction signer)
      const txBytes = Buffer.from(txBase64, 'base64');
      const tx = VersionedTransaction.deserialize(txBytes);

      const { signedTransaction: privySignedTx } = await provider.request({
        method: 'signTransaction',
        params: { transaction: tx },
      });

      // Step 6: Sign with MWA wallet (fee payer)
      const partialSerialized = privySignedTx.serialize();
      const mwaSignedBytes = await walletService.signTransactions([partialSerialized]);
      const finalTx = VersionedTransaction.deserialize(mwaSignedBytes[0]);

      // Step 7: Send fully signed TX via backend
      const signedBase64 = Buffer.from(finalTx.serialize()).toString('base64');
      await apiService.sendApproveTx(proposalId, signedBase64);

      // Step 8: Cleanup — mark signer as signed immediately and refresh
      await privyLogout().catch(() => {});
      setPrivySheetVisible(false);

      // Update signer status locally so the UI reflects it right away
      setSigners(prev => prev.map(s =>
        s.address === privySignerAddress ? { ...s, signed: true } : s
      ));
      setSignaturesCollected(prev => prev + 1);

      // Check if we've hit threshold
      const newCollected = signaturesCollected + 1;
      if (newCollected >= threshold) {
        setStep('ready');
        if (pollRef.current) clearInterval(pollRef.current);
      }

      showToast('Recovery signature submitted', 'success');
    } catch (err: any) {
      console.error('Privy sign error:', err);
      setPrivyError(err?.message || 'Failed to sign. Please try again.');
      setPrivyStep('otp');
    } finally {
      setPrivySending(false);
    }
  }, [privyOtp, privyEmail, proposalId, transactionIndex, vault.multisigAddress, privySignerAddress, loginWithCode, handleRefresh, privyLogout, showToast]);

  const handleCopyUrl = useCallback(() => {
    if (externalSigningUrl) {
      Clipboard.setString(externalSigningUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  }, [externalSigningUrl]);

  const handleOpenUrl = useCallback(() => {
    if (externalSigningUrl) {
      import('react-native').then(({ Linking }) => Linking.openURL(externalSigningUrl));
    }
  }, [externalSigningUrl]);

  const handleExecute = useCallback(async () => {
    if (!proposalId) return;
    setStep('executing');
    setStatusText('Verifying signatures...');

    try {
      // Re-check proposal status before executing — signatures may have landed since last poll
      const freshStatus = await apiService.getRecoveryProposalStatus(proposalId);
      setSigners(freshStatus.requiredSigners);
      setSignaturesCollected(freshStatus.signaturesCollected);

      if (freshStatus.status !== 'ready' && freshStatus.signaturesCollected < threshold) {
        showToast('Not enough signatures yet. Waiting for more approvals.');
        setStep('signing');
        startPolling(proposalId);
        return;
      }

      setStatusText('Submitting recovery transaction...');
      await executeRecoveryProposal(
        proposalId,
        (msg) => setStatusText(msg),
      );

      // Save vault locally
      const vaultData: VaultData = {
        multisigAddress: vault.multisigAddress,
        vaultAddress: vault.vaultAddress,
        label: 'Cashflow',
        createdAt: new Date().toISOString(),
        walletAddress,
        isInitialized: true,
      };
      await saveVault(vaultData);

      // Back up cloud key to Google Block Store (Android only, not on Seeker)
      if (pin && !IS_SOLANA_MOBILE) {
        backupCloudKeyToBlockStore(pin).catch(err => {
          console.warn('[Recovery] Block Store backup failed:', err);
        });
      }

      onComplete();
    } catch (err: any) {
      console.error('Recovery execution error:', err);
      showToast(err.message || 'Failed to execute recovery');
      setStep('ready');
    }
  }, [proposalId, vault, walletAddress, showToast]);

  const renderSignerIcon = (type: string) => {
    switch (type) {
      case 'mwa': return <Wallet size={18} color="#fff" />;
      case 'cloud': return <Cloud size={18} color="#fff" />;
      case 'privy': return <Mail size={18} color="#fff" />;
      default: return <Wallet size={18} color="#fff" />;
    }
  };

  const renderSignerStatus = (signer: typeof signers[0]) => {
    if (signer.signed) {
      return <CheckCircle2 size={20} color="#4ade80" />;
    }
    if (signer.type === 'privy') {
      return (
        <TouchableOpacity
          onPress={() => handlePrivySign(signer.address, signer.email)}
          style={styles.signButton}
          activeOpacity={0.7}
        >
          <Text style={styles.signButtonText}>Sign</Text>
        </TouchableOpacity>
      );
    }
    return <Clock size={20} color="rgba(255,255,255,0.4)" />;
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={colors.onboardingGradient}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (pollRef.current) clearInterval(pollRef.current);
            onBack();
          }}
          activeOpacity={0.7}
          disabled={step === 'executing'}
        >
          <ArrowLeft size={24} color={colors.onboardingText} />
        </TouchableOpacity>

        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.scrollInner}
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
          {/* Header */}
          <Text style={[styles.title, { color: colors.onboardingText }]}>
            Vault Recovery
          </Text>
          <Text style={[styles.subtitle, { color: colors.onboardingTextMuted }]}>
            {step === 'building' || step === 'executing'
              ? statusText
              : `${signaturesCollected} of ${threshold} signatures collected`}
          </Text>

          {/* Progress indicator */}
          {(step === 'building' || step === 'executing') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          )}

          {/* Error state with retry */}
          {step === 'error' && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{statusText}</Text>
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: colors.onboardingButton }]}
                onPress={build}
                activeOpacity={0.7}
              >
                <Text style={[styles.retryButtonText, { color: colors.onboardingButtonText }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Signers list */}
          {(step === 'signing' || step === 'ready') && signers.length > 0 && (
            <View style={[styles.signersCard, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <Text style={styles.sectionTitle}>Signers</Text>
              {signers.map((signer) => (
                <View key={signer.address} style={styles.signerRow}>
                  <View style={styles.signerInfo}>
                    {renderSignerIcon(signer.type)}
                    <View style={{ marginLeft: 12 }}>
                      <Text style={styles.signerLabel}>
                        {signer.label || truncateAddress(signer.address)}
                      </Text>
                      <Text style={styles.signerAddr}>{truncateAddress(signer.address)}</Text>
                    </View>
                  </View>
                  {renderSignerStatus(signer)}
                </View>
              ))}
            </View>
          )}

          {/* External signing URL */}
          {externalSigningUrl && step === 'signing' && signers.some(s => s.type === 'external' && !s.signed) && (
            <View style={[styles.externalCard, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <Text style={styles.sectionTitle}>External Wallet Signing</Text>
              <Text style={[styles.externalDesc, { color: colors.onboardingTextMuted }]}>
                Share this link with anyone who needs to sign with an external wallet:
              </Text>
              <View style={styles.urlRow}>
                <Text style={styles.urlText} numberOfLines={1}>{externalSigningUrl}</Text>
                <TouchableOpacity onPress={handleCopyUrl} activeOpacity={0.7} style={styles.urlButton}>
                  <Copy size={16} color="#fff" />
                  <Text style={styles.urlButtonText}>{copiedUrl ? 'Copied' : 'Copy'}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={handleOpenUrl} activeOpacity={0.7} style={styles.openLinkButton}>
                <ExternalLink size={16} color="#fff" />
                <Text style={styles.urlButtonText}>Open in Browser</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>

        {/* Bottom button */}
        <View style={styles.bottomSection}>
          {step === 'ready' && (
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.onboardingButton }]}
              onPress={handleExecute}
              activeOpacity={0.7}
            >
              <Send size={20} color="#6d28d9" />
              <Text style={[styles.primaryButtonText, { color: colors.onboardingButtonText, marginLeft: 8 }]}>
                Send Recovery Transaction
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      {/* Privy Email Signing Bottom Sheet */}
      <BottomSheet
        visible={privySheetVisible}
        onClose={() => !privySending && setPrivySheetVisible(false)}
        avoidKeyboard
      >
        <View style={styles.privySheet}>
          {privyStep === 'email' && (
            <>
              <Text style={[styles.privyTitle, { color: colors.textPrimary }]}>Verify Email</Text>
              <Text style={[styles.privySubtitle, { color: colors.textSecondary }]}>
                Enter the email address linked to this recovery key to sign the proposal.
              </Text>

              <View style={[styles.privyInputRow, { backgroundColor: colors.cardSecondary }]}>
                <TextInput
                  ref={privyEmailRef}
                  style={[styles.privyInput, { color: colors.textPrimary }]}
                  value={privyEmail}
                  onChangeText={setPrivyEmail}
                  placeholder="email@example.com"
                  placeholderTextColor={colors.placeholderColor}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!privySending}
                  onSubmitEditing={handlePrivySendCode}
                  returnKeyType="send"
                />
              </View>

              {privyError && <Text style={styles.privyErrorText}>{privyError}</Text>}

              <TouchableOpacity
                style={[styles.privyButton, { backgroundColor: colors.primaryButton }, (!privyEmail.trim() || privySending) && { opacity: 0.4 }]}
                activeOpacity={0.7}
                onPress={handlePrivySendCode}
                disabled={!privyEmail.trim() || privySending}
              >
                {privySending ? (
                  <ActivityIndicator size="small" color={colors.primaryButtonText} />
                ) : (
                  <Text style={[styles.privyButtonText, { color: colors.primaryButtonText }]}>Send Code</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {privyStep === 'otp' && (
            <>
              <TouchableOpacity
                onPress={() => !privySending && setPrivyStep('email')}
                activeOpacity={0.7}
                style={[styles.privyBackButton, { backgroundColor: colors.cardSecondary }]}
              >
                <ArrowLeft size={20} color={colors.textPrimary} />
              </TouchableOpacity>

              <Text style={[styles.privyTitle, { color: colors.textPrimary }]}>Enter Code</Text>
              <Text style={[styles.privySubtitle, { color: colors.textSecondary }]}>
                Enter the 6-digit code sent to{'\n'}{privyEmail.trim()}
              </Text>

              <OtpInput
                ref={privyOtpRef}
                value={privyOtp}
                onChange={setPrivyOtp}
                disabled={privySending}
                onComplete={handlePrivyVerifyAndSign}
              />

              {privyError && <Text style={styles.privyErrorText}>{privyError}</Text>}

              <TouchableOpacity
                style={[styles.privyButton, { backgroundColor: colors.primaryButton }, (privyOtp.length !== 6 || privySending) && { opacity: 0.4 }]}
                activeOpacity={0.7}
                onPress={handlePrivyVerifyAndSign}
                disabled={privyOtp.length !== 6 || privySending}
              >
                {privySending ? (
                  <View style={styles.privyLoadingRow}>
                    <ActivityIndicator size="small" color={colors.primaryButtonText} />
                    <Text style={[styles.privyButtonText, { color: colors.primaryButtonText, marginLeft: 8 }]}>Verifying...</Text>
                  </View>
                ) : (
                  <Text style={[styles.privyButtonText, { color: colors.primaryButtonText }]}>Verify & Sign</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {privyStep === 'signing' && (
            <View style={styles.privySigningContainer}>
              <ActivityIndicator size="large" color={colors.accentGreen} />
              <Text style={[styles.privySigningText, { color: colors.textPrimary }]}>
                Signing recovery transaction...
              </Text>
              {privyError && <Text style={styles.privyErrorText}>{privyError}</Text>}
            </View>
          )}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignSelf: 'flex-start',
  },
  scrollContent: { flex: 1 },
  scrollInner: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 32,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 20,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  signersCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  signerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  signerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  signerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  signerAddr: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  signButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  signButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  externalCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  externalDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  urlText: {
    flex: 1,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'monospace',
  },
  urlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  urlButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  openLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 10,
    borderRadius: 12,
  },
  bottomSection: {
    paddingHorizontal: 32,
    paddingBottom: 16,
  },
  primaryButton: {
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  // Privy bottom sheet styles
  privySheet: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  privyTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  privySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  privyInputRow: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 12,
  },
  privyInput: {
    fontSize: 15,
    fontWeight: '500',
    paddingVertical: 12,
  },
  privyButton: {
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  privyButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  privyBackButton: {
    alignSelf: 'flex-start',
    padding: 6,
    borderRadius: 20,
    marginBottom: 8,
  },
  privyErrorText: {
    color: '#ef4444',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  privyLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  privySigningContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 16,
  },
  privySigningText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // OTP styles
  otpContainer: {
    marginTop: 4,
    marginBottom: 4,
  },
  otpHiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 0,
    width: 0,
  },
  otpCells: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  otpCell: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 52,
    borderRadius: 14,
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigit: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
});
