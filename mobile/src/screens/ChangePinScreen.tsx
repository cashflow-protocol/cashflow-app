import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import PinPad from '../components/PinPad';
import { verifyPin, savePin } from '../services/pinStorage';
import { authenticate } from '../services/keypairStorage';
import { logScreenView, logPinChangeStart, logPinChangeComplete, logPinChangeWrongPin, logPinChangeMismatch } from '../services/analyticsService';

interface ChangePinScreenProps {
  onComplete: () => void;
  onBack: () => void;
}

type Step = 'verify' | 'create' | 'confirm';

export default function ChangePinScreen({ onComplete, onBack }: ChangePinScreenProps) {
  const [step, setStep] = useState<Step>('verify');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState('');

  React.useEffect(() => { logScreenView('ChangePinScreen'); logPinChangeStart(); }, []);

  const handleVerify = useCallback(async (pin: string) => {
    const valid = await verifyPin(pin);
    if (valid) {
      setError('');
      setStep('create');
    } else {
      logPinChangeWrongPin();
      setError('Wrong PIN');
    }
  }, []);

  const handleBiometricVerify = useCallback(async () => {
    const success = await authenticate('Verify identity to change PIN');
    if (success) {
      setError('');
      setStep('create');
    }
  }, []);

  const handleCreate = useCallback((pin: string) => {
    setNewPin(pin);
    setError('');
    setStep('confirm');
  }, []);

  const handleConfirm = useCallback(
    async (pin: string) => {
      if (pin !== newPin) {
        logPinChangeMismatch();
        setError("PINs don't match. Try again.");
        setNewPin('');
        setStep('create');
        return;
      }
      await savePin(pin);
      logPinChangeComplete();
      onComplete();
    },
    [newPin, onComplete],
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
        {step === 'verify' && (
          <PinPad
            key="verify"
            title="Enter current PIN"
            error={error}
            onComplete={handleVerify}
            onCancel={onBack}
            biometricAction={handleBiometricVerify}
          />
        )}
        {step === 'create' && (
          <PinPad
            key="create"
            title="Enter new PIN"
            error={error}
            onComplete={handleCreate}
            onCancel={onBack}
          />
        )}
        {step === 'confirm' && (
          <PinPad
            key="confirm"
            title="Confirm new PIN"
            subtitle="Enter the same PIN again"
            onComplete={handleConfirm}
            onCancel={onBack}
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
