import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import PinPad from '../components/PinPad';
import { savePin } from '../services/pinStorage';
import { logScreenView, logPinSetupComplete, logPinSetupMismatch } from '../services/analyticsService';

interface PinSetupScreenProps {
  onComplete: () => void;
}

export default function PinSetupScreen({ onComplete }: PinSetupScreenProps) {
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');

  React.useEffect(() => { logScreenView('PinSetupScreen'); }, []);

  const handleCreate = useCallback((pin: string) => {
    setFirstPin(pin);
    setError('');
    setStep('confirm');
  }, []);

  const handleConfirm = useCallback(
    async (pin: string) => {
      if (pin !== firstPin) {
        logPinSetupMismatch();
        setError("PINs don't match. Try again.");
        setStep('create');
        setFirstPin('');
        return;
      }
      await savePin(pin);
      logPinSetupComplete();
      onComplete();
    },
    [firstPin, onComplete],
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
        {step === 'create' ? (
          <PinPad
            key="create"
            title="Create a PIN"
            subtitle="You'll use this to unlock the app"
            error={error}
            onComplete={handleCreate}
          />
        ) : (
          <PinPad
            key="confirm"
            title="Confirm your PIN"
            subtitle="Enter the same PIN again"
            onComplete={handleConfirm}
          />
        )}
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
