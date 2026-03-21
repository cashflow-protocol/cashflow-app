import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import BottomSheet from './BottomSheet';
import { sendEmailCode, verifyEmailCode } from '../services/onboardingService';
import { logEmailCodeSent, logEmailCodeError, logEmailVerifySuccess, logEmailVerifyError } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

interface ConnectEmailSheetProps {
  visible: boolean;
  onClose: () => void;
  publicKey: string;
  onSuccess: (xpAwarded: number) => void;
}

export default function ConnectEmailSheet({ visible, onClose, publicKey, onSuccess }: ConnectEmailSheetProps) {
  const { colors } = useTheme();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendCode = useCallback(async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      const ok = await sendEmailCode(publicKey, email.trim());
      if (ok) {
        logEmailCodeSent();
        setStep('code');
      } else {
        logEmailCodeError('send_failed');
        setError('Failed to send code. Try again.');
      }
    } catch {
      logEmailCodeError('exception');
      setError('Failed to send code. Try again.');
    } finally {
      setLoading(false);
    }
  }, [email, publicKey]);

  const handleVerify = useCallback(async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await verifyEmailCode(publicKey, email.trim(), code.trim());
      if (result.success) {
        logEmailVerifySuccess();
        onSuccess(result.xpAwarded ?? 100);
        handleReset();
      } else {
        logEmailVerifyError('invalid_code');
        setError('Invalid code. Try again.');
      }
    } catch {
      logEmailVerifyError('exception');
      setError('Verification failed. Try again.');
    } finally {
      setLoading(false);
    }
  }, [code, email, publicKey, onSuccess]);

  const handleReset = () => {
    setStep('email');
    setEmail('');
    setCode('');
    setError('');
    setLoading(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={handleClose} avoidKeyboard>
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        {step === 'email' ? 'Connect your email' : 'Enter verification code'}
      </Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {step === 'email'
          ? 'We\'ll send you a 6-digit verification code.'
          : `Code sent to ${email}`}
      </Text>

      {step === 'email' ? (
        <TextInput
          key="email-input"
          style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.textPrimary }]}
          value={email}
          onChangeText={setEmail}
          placeholder="your@email.com"
          placeholderTextColor={colors.placeholderColor}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSendCode}
        />
      ) : (
        <TextInput
          key="code-input"
          style={[styles.input, styles.codeInput, { backgroundColor: colors.inputBackground, color: colors.textPrimary }]}
          value={code}
          onChangeText={setCode}
          placeholder="000000"
          placeholderTextColor={colors.placeholderColor}
          keyboardType="number-pad"
          maxLength={6}
          returnKeyType="done"
          onSubmitEditing={handleVerify}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.accentBlue }, loading && styles.buttonDisabled]}
        onPress={step === 'email' ? handleSendCode : handleVerify}
        disabled={loading || (step === 'email' ? !email.trim() : !code.trim())}
        activeOpacity={0.7}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {step === 'email' ? 'Send Code' : 'Verify'}
          </Text>
        )}
      </TouchableOpacity>

      {step === 'code' && (
        <TouchableOpacity onPress={() => setStep('email')} activeOpacity={0.7}>
          <Text style={[styles.linkText, { color: colors.accentBlue }]}>Use a different email</Text>
        </TouchableOpacity>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
  },
  input: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  codeInput: {
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 8,
  },
  error: {
    color: '#E53E3E',
    fontSize: 13,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
