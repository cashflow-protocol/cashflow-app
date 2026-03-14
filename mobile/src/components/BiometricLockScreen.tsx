import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { authenticate } from '../services/keypairStorage';
import { verifyPin } from '../services/pinStorage';
import PinPad from './PinPad';

interface BiometricLockScreenProps {
  onUnlock: () => void;
}

export default function BiometricLockScreen({ onUnlock }: BiometricLockScreenProps) {
  const [error, setError] = useState('');

  const promptBiometric = useCallback(async () => {
    const success = await authenticate('Unlock Cashflow');
    if (success) {
      onUnlock();
    }
  }, [onUnlock]);

  // Auto-prompt biometric on mount
  useEffect(() => {
    promptBiometric();
  }, []);

  const handlePinComplete = useCallback(
    async (pin: string) => {
      const valid = await verifyPin(pin);
      if (valid) {
        onUnlock();
      } else {
        setError('Wrong PIN. Try again.');
      }
    },
    [onUnlock],
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
