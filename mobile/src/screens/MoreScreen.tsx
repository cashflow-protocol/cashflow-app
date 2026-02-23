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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { LifetimeEarnedIcon, Last7DIcon } from '../assets/stat-icons';
import { getVault, type VaultData } from '../services/vaultStorage';
import { getCloudKeypair, getDeviceKeypair } from '../services/keypairStorage';
import bs58 from 'bs58';

const squadAvatar = require('../assets/squad-avatar.webp');

interface MoreScreenProps {
  onNavigate?: (screen: string) => void;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function MoreScreen({ onNavigate }: MoreScreenProps) {
  const [vault, setVault] = useState<VaultData | null>(null);
  const [cloudPubkey, setCloudPubkey] = useState<string | null>(null);
  const [devicePubkey, setDevicePubkey] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const v = await getVault();
      setVault(v);

      const cloudBytes = await getCloudKeypair();
      if (cloudBytes) {
        setCloudPubkey(bs58.encode(cloudBytes.slice(32)));
      }
      const deviceBytes = await getDeviceKeypair();
      if (deviceBytes) {
        setDevicePubkey(bs58.encode(deviceBytes.slice(32)));
      }
    })();
  }, []);

  const copyAddress = useCallback((addr: string, field: string) => {
    Clipboard.setString(addr);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
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
                </View>
                <Text style={styles.menuArrow}>{'>'}</Text>
              </View>

              {/* Keypairs */}
              <View style={styles.keypairSection}>
                {cloudPubkey && (
                  <TouchableOpacity
                    style={styles.keypairRow}
                    onPress={() => copyAddress(cloudPubkey, 'cloud')}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.keypairLabel}>Cloud Key</Text>
                    <Text style={styles.keypairValue}>
                      {truncateAddress(cloudPubkey)}
                      {copiedField === 'cloud' ? '  Copied!' : ''}
                    </Text>
                  </TouchableOpacity>
                )}
                {devicePubkey && (
                  <TouchableOpacity
                    style={styles.keypairRow}
                    onPress={() => copyAddress(devicePubkey, 'device')}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.keypairLabel}>Device Key</Text>
                    <Text style={styles.keypairValue}>
                      {truncateAddress(devicePubkey)}
                      {copiedField === 'device' ? '  Copied!' : ''}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
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
  keypairValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1A1A1A',
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
