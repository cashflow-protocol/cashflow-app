import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import { logEmailCodeSent, logEmailCodeError, logEmailVerifySuccess, logEmailVerifyError, logEmailSheetOpen, logEmailUseDifferent } from '../services/analyticsService';
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
  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) logEmailSheetOpen();
  }, [visible]);

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

  const handleVerify = useCallback(async (codeOverride?: string) => {
    const verifyCode = codeOverride ?? code;
    if (!verifyCode.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await verifyEmailCode(publicKey, email.trim(), verifyCode.trim());
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
        <View style={styles.otpContainer}>
          <TextInput
            ref={codeInputRef}
            style={styles.otpHiddenInput}
            value={code}
            onChangeText={(t) => {
              const cleaned = t.replace(/[^0-9]/g, '').slice(0, 6);
              setCode(cleaned);
              if (cleaned.length === 6) {
                setTimeout(() => handleVerify(cleaned), 50);
              }
            }}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            caretHidden
          />
          <View style={styles.otpCells}>
            {Array.from({ length: 6 }).map((_, i) => {
              const isFocused = code.length === i;
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.otpCell,
                    { backgroundColor: colors.inputBackground, borderColor: isFocused ? colors.accentBlue : 'transparent' },
                  ]}
                  activeOpacity={1}
                  onPress={() => codeInputRef.current?.focus()}
                >
                  <Text style={[styles.otpDigit, { color: colors.textPrimary }]}>
                    {code[i] || ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
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
        <TouchableOpacity onPress={() => { logEmailUseDifferent(); setStep('email'); }} activeOpacity={0.7}>
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
  otpContainer: {
    marginTop: 4,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigit: {
    fontSize: 24,
    fontWeight: '700',
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
