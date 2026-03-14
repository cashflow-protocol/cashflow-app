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

interface ConnectEmailSheetProps {
  visible: boolean;
  onClose: () => void;
  publicKey: string;
  onSuccess: (xpAwarded: number) => void;
}

export default function ConnectEmailSheet({ visible, onClose, publicKey, onSuccess }: ConnectEmailSheetProps) {
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
        setStep('code');
      } else {
        setError('Failed to send code. Try again.');
      }
    } catch {
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
        onSuccess(result.xpAwarded ?? 100);
        handleReset();
      } else {
        setError('Invalid code. Try again.');
      }
    } catch {
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
      <Text style={styles.title}>
        {step === 'email' ? 'Connect your email' : 'Enter verification code'}
      </Text>
      <Text style={styles.subtitle}>
        {step === 'email'
          ? 'We\'ll send you a 6-digit verification code.'
          : `Code sent to ${email}`}
      </Text>

      {step === 'email' ? (
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="your@email.com"
          placeholderTextColor="#999"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSendCode}
        />
      ) : (
        <TextInput
          style={[styles.input, styles.codeInput]}
          value={code}
          onChangeText={setCode}
          placeholder="000000"
          placeholderTextColor="#999"
          keyboardType="number-pad"
          maxLength={6}
          returnKeyType="done"
          onSubmitEditing={handleVerify}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
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
          <Text style={styles.linkText}>Use a different email</Text>
        </TouchableOpacity>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  input: {
    backgroundColor: '#F4F6FC',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#000',
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
    backgroundColor: '#175DA3',
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
    color: '#175DA3',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
