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


interface AddMemberScreenProps {
  onNavigate: (screen: string) => void;
  onBack: () => void;
}

type PermissionType = 'all' | 'vote' | 'execute';

const PERMISSION_OPTIONS: Array<{ value: PermissionType; label: string; description: string }> = [
  { value: 'all', label: 'All Permissions', description: 'Can initiate, vote, and execute' },
  { value: 'vote', label: 'Vote Only', description: 'Can only approve or reject proposals' },
  { value: 'execute', label: 'Execute Only', description: 'Can only execute approved transactions' },
];

export default function AddMemberScreen({ onNavigate, onBack }: AddMemberScreenProps) {
  const [memberAddress, setMemberAddress] = useState('');
  const [permissionType, setPermissionType] = useState<PermissionType>('all');
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState('');

  const handleAddMember = async () => {
    if (!memberAddress.trim()) {
      Alert.alert('Error', 'Please enter a wallet address');
      return;
    }

    // Basic validation: Solana addresses are 32-44 chars base58
    if (memberAddress.trim().length < 32 || memberAddress.trim().length > 44) {
      Alert.alert('Error', 'Invalid Solana wallet address');
      return;
    }

    setSubmitting(true);
    try {
      const vaultData = await getVault();
      if (!vaultData) {
        Alert.alert('Error', 'No vault found. Please create a vault first.');
        return;
      }

      setStep('Creating proposal & approving...');
      const { signature } = await addMember(
        vaultData.multisigAddress,
        memberAddress.trim(),
        permissionType,
      );

      Alert.alert(
        'Member Added',
        `Successfully added ${memberAddress.trim().slice(0, 8)}... to your vault.`,
        [{ text: 'OK', onPress: () => onNavigate('squads') }],
      );
    } catch (err: any) {
      console.error('Failed to add member:', err);
      Alert.alert('Error', err?.message || 'Failed to add member. Please try again.');
    } finally {
      setSubmitting(false);
      setStep('');
    }
  };

  return (
    <View style={styles.container}>

      <LinearGradient
        colors={['#1E8260', '#19C394']}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} disabled={submitting}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Add Signing Wallet</Text>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={styles.formContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Wallet Address Input */}
        <View style={styles.card}>
          <Text style={styles.inputLabel}>Wallet Address</Text>
          <TextInput
            style={styles.input}
            value={memberAddress}
            onChangeText={setMemberAddress}
            placeholder="Paste Solana wallet address"
            placeholderTextColor="#B2B2B2"
            editable={!submitting}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Permission Selector */}
        <View style={styles.card}>
          <Text style={styles.inputLabel}>Permissions</Text>
          {PERMISSION_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.permissionRow,
                permissionType === option.value && styles.permissionRowActive,
              ]}
              onPress={() => setPermissionType(option.value)}
              disabled={submitting}
            >
              <View style={styles.radioOuter}>
                {permissionType === option.value && <View style={styles.radioInner} />}
              </View>
              <View style={styles.permissionInfo}>
                <Text style={styles.permissionLabel}>{option.label}</Text>
                <Text style={styles.permissionDescription}>{option.description}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleAddMember}
          disabled={submitting}
        >
          {submitting ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.submitButtonText}>{step || 'Processing...'}</Text>
            </View>
          ) : (
            <Text style={styles.submitButtonText}>Add Member</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8EAF1',
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
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7B8D',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1A1A1A',
    borderBottomWidth: 1,
    borderBottomColor: '#E8EAF1',
    paddingBottom: 8,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 12,
  },
  permissionRowActive: {
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
    borderColor: '#B2B2B2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#19C394',
  },
  permissionInfo: {
    flex: 1,
  },
  permissionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 2,
  },
  permissionDescription: {
    fontSize: 13,
    color: '#6B7B8D',
  },
  submitButton: {
    backgroundColor: '#19C394',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
