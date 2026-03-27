import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { useLoginWithEmail, useEmbeddedSolanaWallet } from '@privy-io/expo';
import { addMember } from '../services/squadsService';
import { getVault, saveRecoveryEmail } from '../services/vaultStorage';
import {
  logScreenView,
  logAddRecoveryKeyPress,
  logAddRecoveryKeySubmit,
  logAddRecoveryKeySuccess,
  logAddRecoveryKeyError,
} from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

interface AddRecoveryKeyScreenProps {
  onNavigate: (screen: string) => void;
  onBack: () => void;
}

type RecoveryMethod = 'crypto_wallet' | 'email';

export default function AddRecoveryKeyScreen({ onNavigate, onBack }: AddRecoveryKeyScreenProps) {
  const { colors } = useTheme();
  const [method, setMethod] = useState<RecoveryMethod>('crypto_wallet');
  const [walletAddress, setWalletAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState('');

  // Privy email recovery
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailStep, setEmailStep] = useState<'input' | 'code' | 'adding'>('input');
  const [emailError, setEmailError] = useState('');

  const { sendCode, loginWithCode, state: privyState } = useLoginWithEmail({
    onLoginSuccess: () => {
      setEmailStep('adding');
    },
    onError: (err) => {
      setEmailError(err.message || 'Authentication failed');
    },
  });
  const embeddedWallet = useEmbeddedSolanaWallet();

  React.useEffect(() => { logScreenView('AddRecoveryKeyScreen'); }, []);

  const handleSendEmailCode = useCallback(async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Please enter a valid email address');
      return;
    }
    setEmailError('');
    try {
      await sendCode({ email: email.trim() });
      setEmailStep('code');
    } catch (err: any) {
      setEmailError(err.message || 'Failed to send code');
    }
  }, [email, sendCode]);

  const handleVerifyEmailCode = useCallback(async () => {
    if (!emailCode.trim() || emailCode.trim().length !== 6) {
      setEmailError('Please enter the 6-digit code');
      return;
    }
    setEmailError('');
    try {
      await loginWithCode({ code: emailCode.trim() });
      // onLoginSuccess will set emailStep to 'adding'
    } catch (err: any) {
      setEmailError(err.message || 'Invalid code');
    }
  }, [emailCode, loginWithCode]);

  // After Privy auth succeeds, get wallet and add as recovery key
  React.useEffect(() => {
    if (emailStep !== 'adding') return;
    const wallets = embeddedWallet.wallets;
    if (!wallets || wallets.length === 0) return;

    const privyWallet = wallets[0];
    const privyAddress = privyWallet.address;
    if (!privyAddress) return;

    (async () => {
      setSubmitting(true);
      try {
        const vaultData = await getVault();
        if (!vaultData) {
          Alert.alert('Error', 'No vault found.');
          return;
        }

        setStep('Adding recovery key...');
        await addMember(vaultData.multisigAddress, privyAddress, 'vote');

        // Save email ↔ address mapping
        await saveRecoveryEmail(privyAddress, email.trim());

        logAddRecoveryKeySuccess();
        Alert.alert(
          'Recovery Key Added',
          `Email recovery key for ${email.trim()} added successfully.`,
          [{ text: 'OK', onPress: () => onNavigate('keys-recovery') }],
        );
      } catch (err: any) {
        logAddRecoveryKeyError(err?.message || 'unknown');
        Alert.alert('Error', err?.message || 'Failed to add recovery key.');
      } finally {
        setSubmitting(false);
        setStep('');
      }
    })();
  }, [emailStep, embeddedWallet.wallets]);

  const handleAddCryptoWallet = async () => {
    if (!walletAddress.trim()) {
      Alert.alert('Error', 'Please enter a wallet address');
      return;
    }

    if (walletAddress.trim().length < 32 || walletAddress.trim().length > 44) {
      Alert.alert('Error', 'Invalid Solana wallet address');
      return;
    }

    logAddRecoveryKeySubmit();
    setSubmitting(true);
    try {
      const vaultData = await getVault();
      if (!vaultData) {
        Alert.alert('Error', 'No vault found. Please create a vault first.');
        return;
      }

      setStep('Creating proposal & approving...');
      await addMember(
        vaultData.multisigAddress,
        walletAddress.trim(),
        'vote',
      );

      logAddRecoveryKeySuccess();
      Alert.alert(
        'Recovery Key Added',
        `Successfully added ${walletAddress.trim().slice(0, 8)}... as a recovery key.`,
        [{ text: 'OK', onPress: () => onNavigate('keys-recovery') }],
      );
    } catch (err: any) {
      logAddRecoveryKeyError(err?.message || 'unknown');
      console.error('Failed to add recovery key:', err);
      Alert.alert('Error', err?.message || 'Failed to add recovery key. Please try again.');
    } finally {
      setSubmitting(false);
      setStep('');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={colors.earnGradient as [string, string]}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} disabled={submitting}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Add Recovery Key</Text>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={styles.formContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Method Selector */}
        <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Recovery Method</Text>
          <TouchableOpacity
            style={[styles.methodRow, { borderBottomColor: colors.border }, method === 'crypto_wallet' && styles.methodRowActive]}
            onPress={() => { setMethod('crypto_wallet'); logAddRecoveryKeyPress(); }}
            disabled={submitting}
          >
            <View style={[styles.radioOuter, { borderColor: colors.textTertiary }]}>
              {method === 'crypto_wallet' && <View style={[styles.radioInner, { backgroundColor: colors.accentGreen }]} />}
            </View>
            <View style={styles.methodInfo}>
              <Text style={[styles.methodLabel, { color: colors.textPrimary }]}>Crypto Wallet</Text>
              <Text style={[styles.methodDescription, { color: colors.textSecondary }]}>Add a Solana wallet address as recovery key</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.methodRow, { borderBottomColor: colors.border }, method === 'email' && styles.methodRowActive]}
            onPress={() => setMethod('email')}
            disabled={submitting}
          >
            <View style={[styles.radioOuter, { borderColor: colors.textTertiary }]}>
              {method === 'email' && <View style={[styles.radioInner, { backgroundColor: colors.accentGreen }]} />}
            </View>
            <View style={styles.methodInfo}>
              <View style={styles.methodLabelRow}>
                <Text style={[styles.methodLabel, { color: colors.textPrimary }]}>Email</Text>
              </View>
              <Text style={[styles.methodDescription, { color: colors.textSecondary }]}>Restore access via email with a Privy embedded wallet</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Crypto Wallet Input */}
        {method === 'crypto_wallet' && (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Wallet Address</Text>
              <TextInput
                style={[styles.input, { color: colors.textPrimary, borderBottomColor: colors.border }]}
                value={walletAddress}
                onChangeText={setWalletAddress}
                placeholder="Paste Solana wallet address"
                placeholderTextColor={colors.placeholderColor}
                editable={!submitting}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                This wallet will be able to vote on recovery proposals but cannot initiate or execute transactions.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: colors.accentGreen }, submitting && styles.submitButtonDisabled]}
              onPress={handleAddCryptoWallet}
              disabled={submitting}
            >
              {submitting ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.primaryButtonText} />
                  <Text style={[styles.submitButtonText, { color: colors.primaryButtonText }]}>{step || 'Processing...'}</Text>
                </View>
              ) : (
                <Text style={[styles.submitButtonText, { color: colors.primaryButtonText }]}>Add Recovery Key</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* Email Recovery via Privy */}
        {method === 'email' && (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
              {emailStep === 'input' && (
                <>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Email Address</Text>
                  <TextInput
                    style={[styles.input, { color: colors.textPrimary, borderBottomColor: colors.border }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="recovery@email.com"
                    placeholderTextColor={colors.placeholderColor}
                    editable={!submitting && privyState.status !== 'sending-code'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="done"
                    onSubmitEditing={handleSendEmailCode}
                  />
                  <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                    A verification code will be sent to this email. A Privy wallet will be created that can vote on recovery proposals.
                  </Text>
                </>
              )}

              {emailStep === 'code' && (
                <>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Verification Code</Text>
                  <Text style={[styles.hintText, { color: colors.textSecondary, marginBottom: 12 }]}>
                    Enter the 6-digit code sent to {email}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.codeInput, { color: colors.textPrimary, borderBottomColor: colors.border }]}
                    value={emailCode}
                    onChangeText={(t) => setEmailCode(t.replace(/\D/g, ''))}
                    placeholder="000000"
                    placeholderTextColor={colors.placeholderColor}
                    editable={!submitting && privyState.status !== 'submitting-code'}
                    keyboardType="number-pad"
                    maxLength={6}
                    returnKeyType="done"
                    onSubmitEditing={handleVerifyEmailCode}
                  />
                </>
              )}

              {emailStep === 'adding' && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.accentGreen} />
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{step || 'Setting up recovery wallet...'}</Text>
                </View>
              )}

              {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
            </View>

            {emailStep === 'input' && (
              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: colors.accentGreen }, (privyState.status === 'sending-code') && styles.submitButtonDisabled]}
                onPress={handleSendEmailCode}
                disabled={!email.trim() || privyState.status === 'sending-code'}
              >
                {privyState.status === 'sending-code' ? (
                  <ActivityIndicator size="small" color={colors.primaryButtonText} />
                ) : (
                  <Text style={[styles.submitButtonText, { color: colors.primaryButtonText }]}>Send Verification Code</Text>
                )}
              </TouchableOpacity>
            )}

            {emailStep === 'code' && (
              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: colors.accentGreen }, (privyState.status === 'submitting-code') && styles.submitButtonDisabled]}
                onPress={handleVerifyEmailCode}
                disabled={emailCode.length !== 6 || privyState.status === 'submitting-code'}
              >
                {privyState.status === 'submitting-code' ? (
                  <ActivityIndicator size="small" color={colors.primaryButtonText} />
                ) : (
                  <Text style={[styles.submitButtonText, { color: colors.primaryButtonText }]}>Verify & Add Recovery Key</Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}
      </KeyboardAvoidingView>
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
  formContainer: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 24,
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
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    fontSize: 15,
    fontWeight: '500',
    borderBottomWidth: 1,
    paddingBottom: 8,
  },
  hintText: {
    fontSize: 12,
    marginTop: 8,
    lineHeight: 16,
  },
  codeInput: {
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 8,
  },
  errorText: {
    color: '#E53E3E',
    fontSize: 13,
    marginTop: 8,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  methodRowActive: {
    backgroundColor: '#F5FFF8',
    marginHorizontal: -16,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  methodInfo: {
    flex: 1,
  },
  methodLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  methodLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  methodDescription: {
    fontSize: 13,
  },
  comingSoonBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  comingSoonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F5A623',
  },
  comingSoonMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  submitButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    fontWeight: '700',
    fontSize: 16,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
