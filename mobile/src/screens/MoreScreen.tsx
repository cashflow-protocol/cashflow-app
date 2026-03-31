import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { KeyRound, Lock, Recycle, Trash2, DatabaseZap, ShieldOff, MessageCircle } from 'lucide-react-native';
import { getVault, clearVault, type VaultData } from '../services/vaultStorage';
import { getDevicePublicKey, deleteAllKeypairs, deleteDeviceKeypair } from '../services/keypairStorage';
import { reclaimRent } from '../services/squadsService';
import apiService from '../services/apiService';
import { APP_VERSION, BUILD_NUMBER } from '../config/version';
import {
  logScreenView,
  logMoreNavigate,
  logSupportLinkPress,
  logReclaimRentPress,
  logReclaimRentSuccess,
  logReclaimRentError,
  logRemoveVaultPress,
  logRemoveVaultConfirm,
} from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

interface MoreScreenProps {
  onNavigate?: (screen: string) => void;
}

export default function MoreScreen({ onNavigate }: MoreScreenProps) {
  const { colors } = useTheme();
  const [vault, setVault] = useState<VaultData | null>(null);
  const [devicePubkey, setDevicePubkey] = useState<string | null>(null);
  const [reclaimStatus, setReclaimStatus] = useState<string | null>(null);
  const [supportUrl, setSupportUrl] = useState<string | null>(null);

  useEffect(() => { logScreenView('MoreScreen'); }, []);

  useEffect(() => {
    (async () => {
      const [v, devicePub] = await Promise.all([
        getVault(),
        getDevicePublicKey(),
      ]);
      setVault(v);
      setDevicePubkey(devicePub);
    })();
    apiService.getConfig().then(cfg => setSupportUrl(cfg.supportUrl)).catch(() => {});
  }, []);

  const handleReclaimRent = useCallback(async () => {
    if (!vault) return;
    logReclaimRentPress();
    setReclaimStatus('Starting...');
    try {
      const result = await reclaimRent(vault.multisigAddress, (msg) => {
        setReclaimStatus(msg);
      });
      logReclaimRentSuccess(result.closed, result.skipped, result.failed);
      setReclaimStatus(`Done! Cancelled: ${result.cancelled}, Closed: ${result.closed}, Skipped: ${result.skipped}, Failed: ${result.failed}`);
      setTimeout(() => setReclaimStatus(null), 5000);
    } catch (err: any) {
      logReclaimRentError(err.message);
      setReclaimStatus(`Error: ${err.message}`);
      setTimeout(() => setReclaimStatus(null), 5000);
    }
  }, [vault]);

  const handleRemoveDeviceKey = useCallback(() => {
    Alert.alert(
      'Remove Device Key',
      'This will delete the device signing key from this device. The cloud key and vault will not be affected.\n\nYou can generate a new device key later, but you will need to re-add it to your multisig.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteDeviceKeypair();
            setDevicePubkey(null);
          },
        },
      ],
    );
  }, []);

  const handleRemoveVaultData = useCallback(() => {
    Alert.alert(
      'Remove Vault Data',
      'This will delete the local vault data only. Your signing keys will not be removed.\n\nThe app will return to onboarding. You can re-link your vault or create a new one.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await clearVault();
            onNavigate?.('onboarding');
          },
        },
      ],
    );
  }, []);

  const handleRemoveVault = useCallback(() => {
    logRemoveVaultPress();
    Alert.alert(
      'Remove Vault',
      'This will delete the local vault data and signing keypairs. The onchain multisig will still exist but you will lose signing access from this device.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            logRemoveVaultConfirm();
            await Promise.all([clearVault(), deleteAllKeypairs()]);
            onNavigate?.('onboarding');
          },
        },
      ],
    );
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      <LinearGradient
        colors={colors.moreGradient as [string, string]}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <SafeAreaView edges={['top']} style={styles.header}>
          <View style={styles.headerContent}>
            <Text style={styles.title}>Settings</Text>
            <Text style={styles.subtitle}>Manage your vault</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          {/* Keys & Recovery */}
          {vault && (
            <TouchableOpacity
              style={[styles.menuCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
              onPress={() => { logMoreNavigate('keys-recovery'); onNavigate?.('keys-recovery'); }}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconCircle, { backgroundColor: '#19C394' }]}>
                <KeyRound size={22} color="#fff" />
              </View>
              <View style={styles.menuInfo}>
                <Text style={[styles.menuTitle, { color: colors.textPrimary }]}>Keys & Recovery</Text>
                <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>Manage signing keys and backup</Text>
              </View>
              <Text style={[styles.menuArrow, { color: colors.textTertiary }]}>{'>'}</Text>
            </TouchableOpacity>
          )}

          {/* Change PIN */}
          {vault && (
            <TouchableOpacity
              style={[styles.menuCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
              onPress={() => { logMoreNavigate('change-pin'); onNavigate?.('change-pin'); }}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconCircle, { backgroundColor: '#6B7B8D' }]}>
                <Lock size={22} color="#fff" />
              </View>
              <View style={styles.menuInfo}>
                <Text style={[styles.menuTitle, { color: colors.textPrimary }]}>Change PIN</Text>
                <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>Update your security PIN</Text>
              </View>
              <Text style={[styles.menuArrow, { color: colors.textTertiary }]}>{'>'}</Text>
            </TouchableOpacity>
          )}

          {/* Support */}
          {supportUrl && (
            <TouchableOpacity
              style={[styles.menuCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
              onPress={() => { logSupportLinkPress(); Linking.openURL(supportUrl); }}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconCircle, { backgroundColor: '#29B6F6' }]}>
                <MessageCircle size={22} color="#fff" />
              </View>
              <View style={styles.menuInfo}>
                <Text style={[styles.menuTitle, { color: colors.textPrimary }]}>Support</Text>
                <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>Chat with Cashflow team</Text>
              </View>
              <Text style={[styles.menuArrow, { color: colors.textTertiary }]}>{'>'}</Text>
            </TouchableOpacity>
          )}

          {/* DEV-only: Reclaim Rent */}
          {__DEV__ && vault && (
            <TouchableOpacity
              style={[styles.menuCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
              onPress={handleReclaimRent}
              activeOpacity={0.7}
              disabled={reclaimStatus !== null}
            >
              <View style={[styles.menuIconCircle, { backgroundColor: '#F5A623' }]}>
                <Recycle size={22} color="#fff" />
              </View>
              <View style={styles.menuInfo}>
                <Text style={[styles.menuTitle, { color: colors.textPrimary }]}>
                  {reclaimStatus ?? 'Reclaim Rent'}
                </Text>
                <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>Close empty accounts to recover SOL</Text>
              </View>
              <Text style={[styles.menuArrow, { color: colors.textTertiary }]}>{'>'}</Text>
            </TouchableOpacity>
          )}

          {/* DEV-only: Danger Zone */}
          {__DEV__ && vault && (
            <View style={styles.dangerSection}>
              <Text style={styles.dangerLabel}>Danger Zone</Text>

              {devicePubkey && (
                <TouchableOpacity
                  style={[styles.dangerCard, { backgroundColor: colors.card, borderColor: '#F5A623' }]}
                  onPress={handleRemoveDeviceKey}
                  activeOpacity={0.7}
                >
                  <ShieldOff size={18} color="#F5A623" style={styles.dangerIcon} />
                  <Text style={[styles.dangerCardText, { color: '#F5A623' }]}>Remove Device Key</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.dangerCard, { backgroundColor: colors.card, borderColor: '#F5A623' }]}
                onPress={handleRemoveVaultData}
                activeOpacity={0.7}
              >
                <DatabaseZap size={18} color="#F5A623" style={styles.dangerIcon} />
                <Text style={[styles.dangerCardText, { color: '#F5A623' }]}>Remove Vault Data</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dangerCard, { backgroundColor: colors.card, borderColor: colors.accentRed }]}
                onPress={handleRemoveVault}
                activeOpacity={0.7}
              >
                <Trash2 size={18} color={colors.accentRed} style={styles.dangerIcon} />
                <Text style={[styles.dangerCardText, { color: colors.accentRed }]}>Remove Vault</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={[styles.versionText, { color: colors.textTertiary }]}>App verion: {APP_VERSION} ({BUILD_NUMBER})</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerGradient: {
    paddingBottom: 24,
  },
  header: {},
  headerContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    lineHeight: 18,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 10,
  },
  menuCard: {
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  menuIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuInfo: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 13,
  },
  menuArrow: {
    fontSize: 18,
    fontWeight: '600',
  },
  dangerSection: {
    marginTop: 24,
    gap: 10,
  },
  dangerLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F95357',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  dangerCard: {
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  dangerIcon: {
    marginRight: 8,
  },
  dangerCardText: {
    fontSize: 15,
    fontWeight: '600',
  },
  versionText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 32,
  },
});
