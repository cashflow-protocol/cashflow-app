import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
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
import apiService from '../services/apiService';
import Toast from '../components/Toast';
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
  onComplete: () => void;
  onBack: () => void;
}

type ExecutionStep = 'building' | 'error' | 'signing' | 'ready' | 'executing' | 'done';

function truncateAddress(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function maskEmail(email: string): string {
  if (email.length <= 12) return email.slice(0, 2) + '...' + email.slice(-4);
  return email.slice(0, 2) + '...' + email.slice(-10);
}

export default function VaultRecoveryExecutionScreen({
  vault,
  walletAddress,
  onComplete,
  onBack,
}: VaultRecoveryExecutionScreenProps) {
  const { colors } = useTheme();
  const [step, setStep] = useState<ExecutionStep>('building');
  const [statusText, setStatusText] = useState('Preparing recovery...');
  const [proposalId, setProposalId] = useState<string | null>(null);
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
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setToastVisible(true);
  }, []);

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

  const handlePrivySign = useCallback(async (email: string) => {
    if (!proposalId) return;
    try {
      setStatusText(`Signing with ${maskEmail(email)}...`);
      const result = await apiService.requestPrivySign(proposalId, email);
      setSignaturesCollected(result.signaturesCollected);

      if (result.status === 'ready') {
        setStep('ready');
        if (pollRef.current) clearInterval(pollRef.current);
      }

      // Refresh signer statuses
      const status = await apiService.getRecoveryProposalStatus(proposalId);
      setSigners(status.requiredSigners);
    } catch (err: any) {
      showToast(err.message || 'Failed to sign with email');
    }
  }, [proposalId, showToast]);

  const handleCopyUrl = useCallback(() => {
    if (externalSigningUrl) {
      Clipboard.setString(externalSigningUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  }, [externalSigningUrl]);

  const handleOpenUrl = useCallback(() => {
    if (externalSigningUrl) {
      Linking.openURL(externalSigningUrl);
    }
  }, [externalSigningUrl]);

  const handleExecute = useCallback(async () => {
    if (!proposalId) return;
    setStep('executing');
    setStatusText('Submitting recovery transaction...');

    try {
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
      };
      await saveVault(vaultData);

      setStep('done');
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
    if (signer.type === 'privy' && signer.email) {
      return (
        <TouchableOpacity
          onPress={() => handlePrivySign(signer.email!)}
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
      <Toast
        visible={toastVisible}
        message={toastMessage}
        type="warning"
        onDismiss={() => setToastVisible(false)}
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
        >
          {/* Header */}
          <Text style={[styles.title, { color: colors.onboardingText }]}>
            {step === 'done' ? 'Recovery Complete' : 'Vault Recovery'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.onboardingTextMuted }]}>
            {step === 'building' || step === 'executing'
              ? statusText
              : step === 'done'
              ? 'Your vault has been recovered successfully.'
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
          {externalSigningUrl && step === 'signing' && (
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

          {/* Done state */}
          {step === 'done' && (
            <View style={styles.doneContainer}>
              <CheckCircle2 size={64} color="#4ade80" />
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

          {step === 'done' && (
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.onboardingButton }]}
              onPress={onComplete}
              activeOpacity={0.7}
            >
              <Text style={[styles.primaryButtonText, { color: colors.onboardingButtonText }]}>Continue</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
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
  doneContainer: {
    alignItems: 'center',
    paddingVertical: 40,
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
});
