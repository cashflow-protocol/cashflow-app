import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { ArrowLeft } from 'lucide-react-native';
import { validateInviteCode, redeemInviteCode } from '../services/onboardingService';
import { getCloudPublicKey, generateAndStoreCloudKeypair } from '../services/keypairStorage';
import { logScreenView, logInviteCodeSubmit, logInviteCodeSuccess, logInviteCodeError } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../contexts/ToastContext';

interface InviteCodeScreenProps {
  onValidCode: (code: string) => void;
  onBack: () => void;
}

export default function InviteCodeScreen({ onValidCode, onBack }: InviteCodeScreenProps) {
  const { colors } = useTheme();
  const { showToast } = useToast();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  React.useEffect(() => { logScreenView('InviteCodeScreen'); }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length === 0) return;

    logInviteCodeSubmit();
    setLoading(true);
    try {
      const valid = await validateInviteCode(trimmed);
      if (!valid) {
        logInviteCodeError('invalid');
        showToast('Invalid Invite Code', 'This code is invalid or has already been used.', 'warning');
        return;
      }

      // Get or generate cloud keypair to redeem against
      let pk = await getCloudPublicKey();
      if (!pk) {
        pk = await generateAndStoreCloudKeypair();
      }

      const redeemed = await redeemInviteCode(trimmed, pk);
      if (redeemed) {
        logInviteCodeSuccess();
        onValidCode(trimmed);
      } else {
        logInviteCodeError('redeem_failed');
        showToast('Invalid Invite Code', 'This code is invalid or has already been used.', 'warning');
      }
    } catch {
      logInviteCodeError('exception');
      showToast('Invalid Invite Code', 'This code is invalid or has already been used.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [code, onValidCode]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={colors.onboardingGradient}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Back button */}
          <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
            <ArrowLeft size={24} color={colors.onboardingText} />
          </TouchableOpacity>

          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.onboardingText }]}>Enter Invite Code</Text>
            <Text style={[styles.description, { color: colors.onboardingText + 'CC' }]}>
              Enter your invite code to unlock early access.
            </Text>

            <TextInput
              style={[styles.input, { backgroundColor: colors.onboardingText + '26', color: colors.onboardingText }]}
              value={code}
              onChangeText={(text) => setCode(text.toUpperCase())}
              placeholder="XXXXXXXX"
              placeholderTextColor={colors.onboardingText + '4D'}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={16}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: colors.onboardingButton }, (loading || code.trim().length === 0) && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading || code.trim().length === 0}
              activeOpacity={0.7}
            >
              {loading ? (
                <ActivityIndicator color={colors.onboardingButtonText} />
              ) : (
                <Text style={[styles.submitButtonText, { color: colors.onboardingButtonText }]}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
  keyboardView: {
    flex: 1,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  input: {
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 4,
    width: '100%',
  },
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  submitButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
