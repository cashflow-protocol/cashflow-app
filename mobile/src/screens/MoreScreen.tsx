import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  Clipboard,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { LifetimeEarnedIcon, Last7DIcon } from '../assets/stat-icons';
import { getVault, clearVault, type VaultData } from '../services/vaultStorage';
import { getCloudPublicKey, getDevicePublicKey, getCloudPrivateKey, getDevicePrivateKey, deleteAllKeypairs } from '../services/keypairStorage';
import { reclaimRent } from '../services/squadsService';
import apiService from '../services/apiService';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

const squadAvatar = require('../assets/squad-avatar.webp');

interface MoreScreenProps {
  onNavigate?: (screen: string) => void;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatSol(amount: number | null): string {
  if (amount === null) return '';
  if (amount === 0) return '0 SOL';
  if (amount < 0.001) return '<0.001 SOL';
  return `${amount.toFixed(4)} SOL`;
}

export default function MoreScreen({ onNavigate }: MoreScreenProps) {
  const [vault, setVault] = useState<VaultData | null>(null);
  const [cloudPubkey, setCloudPubkey] = useState<string | null>(null);
  const [devicePubkey, setDevicePubkey] = useState<string | null>(null);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [vaultBalance, setVaultBalance] = useState<number | null>(null);
  const [cloudBalance, setCloudBalance] = useState<number | null>(null);
  const [deviceBalance, setDeviceBalance] = useState<number | null>(null);
  const [reclaimStatus, setReclaimStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const v = await getVault();
      setVault(v);

      const [cloudPub, devicePub] = await Promise.all([
        getCloudPublicKey(),
        getDevicePublicKey(),
      ]);
      setCloudPubkey(cloudPub);
      setDevicePubkey(devicePub);
      setKeysLoaded(true);

      // Fetch SOL balances for all addresses
      const balanceAddresses = [
        v?.vaultAddress,
        cloudPub,
        devicePub,
      ];
      const balanceResults = await Promise.all(
        balanceAddresses.map(addr =>
          addr
            ? apiService.getWalletBalance(addr, SOL_MINT).then(r => r.uiAmount).catch(() => null)
            : Promise.resolve(null),
        ),
      );
      setVaultBalance(balanceResults[0]);
      setCloudBalance(balanceResults[1]);
      setDeviceBalance(balanceResults[2]);
    })();
  }, []);

  const copyAddress = useCallback((addr: string, field: string) => {
    Clipboard.setString(addr);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const copyPrivateKey = useCallback((keyType: 'cloud' | 'device') => {
    const label = keyType === 'cloud' ? 'Cloud' : 'Device';
    Alert.alert(
      `Export ${label} Private Key`,
      'This will copy the full private key to your clipboard. Anyone with this key can sign transactions. Make sure no one is watching your screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          style: 'destructive',
          onPress: async () => {
            const key = keyType === 'cloud'
              ? await getCloudPrivateKey()
              : await getDevicePrivateKey();
            if (key) {
              Clipboard.setString(key);
              setCopiedField(`${keyType}-private`);
              setTimeout(() => setCopiedField(null), 2000);
            }
          },
        },
      ],
    );
  }, []);

  const handleReclaimRent = useCallback(async () => {
    if (!vault) return;
    setReclaimStatus('Starting...');
    try {
      const result = await reclaimRent(vault.multisigAddress, (msg) => {
        setReclaimStatus(msg);
      });
      setReclaimStatus(`Done! Closed: ${result.closed}, Skipped: ${result.skipped}, Failed: ${result.failed}`);
      setTimeout(() => setReclaimStatus(null), 5000);
    } catch (err: any) {
      setReclaimStatus(`Error: ${err.message}`);
      setTimeout(() => setReclaimStatus(null), 5000);
    }
  }, [vault]);

  const handleRemoveVault = useCallback(() => {
    Alert.alert(
      'Remove Vault',
      'This will delete the local vault data and signing keypairs. The on-chain multisig will still exist but you will lose signing access from this device.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await Promise.all([clearVault(), deleteAllKeypairs()]);
            setVault(null);
            setCloudPubkey(null);
            setDevicePubkey(null);
            setKeysLoaded(false);
          },
        },
      ],
    );
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <LinearGradient
        colors={['#1E8260', '#19C394']}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.title}>More</Text>
      </SafeAreaView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsContainer}
          style={styles.statsScroll}
        >
          <View style={styles.statCard}>
            <View style={styles.statRow}>
              <View style={styles.statIconCircle}>
                <LifetimeEarnedIcon size={20} />
              </View>
              <View>
                <Text style={styles.statLabel}>Transactions</Text>
                <Text style={styles.statValue}>0</Text>
              </View>
            </View>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statRow}>
              <View style={styles.statIconCircle}>
                <Last7DIcon size={20} />
              </View>
              <View>
                <Text style={styles.statLabel}>Active since</Text>
                <Text style={styles.statValue}>Today</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Squads Section */}
        <View style={styles.content}>
          <Text style={styles.sectionLabel}>Squads</Text>

          {vault ? (
            <>
            <TouchableOpacity
              style={styles.vaultCard}
              onPress={() => onNavigate?.('squads')}
              activeOpacity={0.7}
            >
              <View style={styles.vaultHeader}>
                <Image source={squadAvatar} style={styles.vaultAvatar} />
                <View style={styles.vaultHeaderInfo}>
                  <Text style={styles.vaultName}>{vault.label}</Text>
                  <TouchableOpacity
                    onPress={() => copyAddress(vault.vaultAddress, 'vault')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.vaultAddress}>
                      {truncateAddress(vault.vaultAddress)}
                      {copiedField === 'vault' ? '  Copied!' : ''}
                    </Text>
                  </TouchableOpacity>
                  {vaultBalance !== null && (
                    <Text style={styles.balanceText}>{formatSol(vaultBalance)}</Text>
                  )}
                </View>
                <Text style={styles.menuArrow}>{'>'}</Text>
              </View>

              {/* Keypairs */}
              {keysLoaded && (
                <View style={styles.keypairSection}>
                  <TouchableOpacity
                    style={styles.keypairRow}
                    onPress={() => cloudPubkey && copyAddress(cloudPubkey, 'cloud')}
                    activeOpacity={cloudPubkey ? 0.6 : 1}
                  >
                    <Text style={styles.keypairLabel}>Cloud Key</Text>
                    {cloudPubkey ? (
                      <View style={styles.keypairRight}>
                        <Text style={styles.keypairValue}>
                          {truncateAddress(cloudPubkey)}
                          {copiedField === 'cloud' ? '  Copied!' : ''}
                        </Text>
                        {cloudBalance !== null && (
                          <Text style={styles.keypairBalance}>{formatSol(cloudBalance)}</Text>
                        )}
                      </View>
                    ) : (
                      <Text style={styles.keypairMissing}>Not found</Text>
                    )}
                  </TouchableOpacity>
                  {cloudPubkey && (
                    <TouchableOpacity
                      onPress={() => copyPrivateKey('cloud')}
                      activeOpacity={0.6}
                      hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
                    >
                      <Text style={styles.exportKeyText}>
                        {copiedField === 'cloud-private' ? 'Copied!' : 'Copy Private Key'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.keypairRow}
                    onPress={() => devicePubkey && copyAddress(devicePubkey, 'device')}
                    activeOpacity={devicePubkey ? 0.6 : 1}
                  >
                    <Text style={styles.keypairLabel}>Device Key</Text>
                    {devicePubkey ? (
                      <View style={styles.keypairRight}>
                        <Text style={styles.keypairValue}>
                          {truncateAddress(devicePubkey)}
                          {copiedField === 'device' ? '  Copied!' : ''}
                        </Text>
                        {deviceBalance !== null && (
                          <Text style={styles.keypairBalance}>{formatSol(deviceBalance)}</Text>
                        )}
                      </View>
                    ) : (
                      <Text style={styles.keypairMissing}>Not found</Text>
                    )}
                  </TouchableOpacity>
                  {devicePubkey && (
                    <TouchableOpacity
                      onPress={() => copyPrivateKey('device')}
                      activeOpacity={0.6}
                      hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
                    >
                      <Text style={styles.exportKeyText}>
                        {copiedField === 'device-private' ? 'Copied!' : 'Copy Private Key'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.reclaimButton}
              onPress={handleReclaimRent}
              activeOpacity={0.7}
              disabled={reclaimStatus !== null}
            >
              <Text style={styles.reclaimButtonText}>
                {reclaimStatus ?? 'Reclaim Rent'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.removeButton}
              onPress={handleRemoveVault}
              activeOpacity={0.7}
            >
              <Text style={styles.removeButtonText}>Remove Vault</Text>
            </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.menuCard}
              onPress={() => onNavigate?.('squads')}
              activeOpacity={0.7}
            >
              <View style={styles.menuIconCircle}>
                <Text style={styles.menuIcon}>+</Text>
              </View>
              <View style={styles.menuInfo}>
                <Text style={styles.menuTitle}>Create Vault</Text>
                <Text style={styles.menuSubtitle}>Set up a multisig self-custody vault</Text>
              </View>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
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
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  statsScroll: {
    maxHeight: 70,
    marginTop: 16,
    marginBottom: 12,
  },
  statsContainer: {
    paddingHorizontal: 14,
    gap: 10,
  },
  statCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minWidth: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#19C394',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 13,
    color: '#6B7B8D',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7B8D',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  vaultCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  vaultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vaultAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 14,
  },
  vaultHeaderInfo: {
    flex: 1,
  },
  vaultName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 2,
  },
  vaultAddress: {
    fontSize: 13,
    color: '#19C394',
    fontWeight: '500',
  },
  keypairSection: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingTop: 12,
    gap: 10,
  },
  keypairRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  keypairLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7B8D',
  },
  keypairRight: {
    alignItems: 'flex-end' as const,
  },
  keypairValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  keypairBalance: {
    fontSize: 11,
    fontWeight: '500',
    color: '#6B7B8D',
    marginTop: 2,
  },
  balanceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1A1A1A',
    marginTop: 2,
  },
  exportKeyText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#F95357',
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  keypairMissing: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F95357',
  },
  reclaimButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#19C394',
  },
  reclaimButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#19C394',
  },
  removeButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#F95357',
  },
  removeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F95357',
  },
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  menuIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#19C394',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  menuInfo: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 13,
    color: '#6B7B8D',
  },
  menuArrow: {
    fontSize: 18,
    color: '#B2B2B2',
    fontWeight: '600',
  },
});
