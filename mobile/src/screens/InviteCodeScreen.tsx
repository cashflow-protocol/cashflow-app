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
import { validateInviteCode } from '../services/onboardingService';
import Toast from '../components/Toast';

interface InviteCodeScreenProps {
  onValidCode: (code: string) => void;
  onBack: () => void;
}

export default function InviteCodeScreen({ onValidCode, onBack }: InviteCodeScreenProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length === 0) return;

    setLoading(true);
    try {
      const valid = await validateInviteCode(trimmed);
      if (valid) {
        onValidCode(trimmed);
      } else {
        setToastVisible(true);
      }
    } catch {
      setToastVisible(true);
    } finally {
      setLoading(false);
    }
  }, [code, onValidCode]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0D4A82', '#175DA3', '#347AC0', '#5A9AD5']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <Toast
        visible={toastVisible}
        message="Invalid Invite Code"
        description="This code is invalid or has already been used."
        type="warning"
        onDismiss={() => setToastVisible(false)}
      />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Back button */}
          <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
            <ArrowLeft size={24} color="#fff" />
          </TouchableOpacity>

          <View style={styles.content}>
            <Text style={styles.title}>Enter Invite Code</Text>
            <Text style={styles.description}>
              Enter your invite code to unlock early access.
            </Text>

            <TextInput
              style={styles.input}
              value={code}
              onChangeText={(text) => setCode(text.toUpperCase())}
              placeholder="XXXXXXXX"
              placeholderTextColor="rgba(255, 255, 255, 0.3)"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={[styles.submitButton, (loading || code.trim().length === 0) && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading || code.trim().length === 0}
              activeOpacity={0.7}
            >
              {loading ? (
                <ActivityIndicator color="#175DA3" />
              ) : (
                <Text style={styles.submitButtonText}>Continue</Text>
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
    color: '#fff',
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
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 4,
    width: '100%',
  },
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  submitButton: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#175DA3',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
