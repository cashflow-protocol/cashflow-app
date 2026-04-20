import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { retrievePinWithBiometric } from '../services/keypairStorage';
import { verifyPin } from '../services/pinStorage';
import PinPad from './PinPad';
import { logScreenView, logBiometricUnlockAttempt, logBiometricUnlockSuccess, logPinUnlockSuccess, logPinUnlockFailed } from '../services/analyticsService';

interface BiometricLockScreenProps {
  onUnlock: () => void;
  onPinUnlock?: (pin: string) => void | Promise<void>;
}

export default function BiometricLockScreen({ onUnlock, onPinUnlock }: BiometricLockScreenProps) {
  const [error, setError] = useState('');

  const promptBiometric = useCallback(async () => {
    logBiometricUnlockAttempt();
    const pin = await retrievePinWithBiometric();
    if (pin) {
      logBiometricUnlockSuccess();
      await onPinUnlock?.(pin);
      onUnlock();
    }
  }, [onUnlock, onPinUnlock]);

  // Auto-prompt biometric on mount
  useEffect(() => {
    logScreenView('BiometricLockScreen');
    promptBiometric();
  }, []);

  const handlePinComplete = useCallback(
    async (pin: string) => {
      const result = await verifyPin(pin);
      if (result.success) {
        logPinUnlockSuccess();
        await onPinUnlock?.(pin);
        onUnlock();
      } else {
        logPinUnlockFailed();
        if (result.attemptsRemaining === 0) {
          setError('Too many attempts. Try again in 5 minutes.');
        } else if (result.attemptsRemaining != null) {
          setError(`Wrong PIN. ${result.attemptsRemaining} attempts remaining.`);
        } else {
          setError('Wrong PIN. Try again.');
        }
      }
    },
    [onUnlock, onPinUnlock],
  );

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0D4A82', '#175DA3', '#347AC0', '#5A9AD5']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <SafeAreaView style={styles.safeArea}>
        <PinPad
          title="Enter PIN"
          error={error}
          onComplete={handlePinComplete}
          biometricAction={promptBiometric}
        />
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
});
