import React, { useState } from 'react';
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
import { addMember } from '../services/squadsService';
import { getVault } from '../services/vaultStorage';
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

  React.useEffect(() => { logScreenView('AddRecoveryKeyScreen'); }, []);

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
                <View style={styles.comingSoonBadge}>
                  <Text style={styles.comingSoonText}>Coming Soon</Text>
                </View>
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

        {/* Email Placeholder */}
        {method === 'email' && (
          <View style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
            <Text style={[styles.comingSoonMessage, { color: colors.textSecondary }]}>
              Email recovery via Privy embedded wallets is coming soon. Your contact will receive a wallet that can vote on recovery proposals.
            </Text>
          </View>
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
