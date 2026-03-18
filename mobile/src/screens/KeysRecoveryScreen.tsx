import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { getMultisigInfo, type MultisigInfo } from '../services/squadsService';
import { getCloudPublicKey, getDevicePublicKey } from '../services/keypairStorage';
import { getVault } from '../services/vaultStorage';
import apiService from '../services/apiService';
import { logScreenView } from '../services/analyticsService';

interface KeysRecoveryScreenProps {
  onNavigate: (screen: string) => void;
  onBack: () => void;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

type MemberLabel = 'Cloud' | 'Device' | 'Wallet' | 'Recovery';

interface ClassifiedMember {
  address: string;
  label: MemberLabel;
  permissions: { initiate: boolean; vote: boolean; execute: boolean };
}

function classifyMembers(
  members: MultisigInfo['members'],
  cloudPubkey: string | null,
  devicePubkey: string | null,
  walletAddress: string | null,
): { coreMembers: ClassifiedMember[]; recoveryMembers: ClassifiedMember[] } {
  const coreMembers: ClassifiedMember[] = [];
  const recoveryMembers: ClassifiedMember[] = [];

  for (const m of members) {
    let label: MemberLabel;
    if (cloudPubkey && m.address === cloudPubkey) {
      label = 'Cloud';
    } else if (devicePubkey && m.address === devicePubkey) {
      label = 'Device';
    } else if (walletAddress && m.address === walletAddress) {
      label = 'Wallet';
    } else {
      label = 'Recovery';
    }

    const classified = { address: m.address, label, permissions: m.permissions };
    if (label === 'Recovery') {
      recoveryMembers.push(classified);
    } else {
      coreMembers.push(classified);
    }
  }

  return { coreMembers, recoveryMembers };
}

const MAX_RECOVERY_KEYS = 3;

export default function KeysRecoveryScreen({ onNavigate, onBack }: KeysRecoveryScreenProps) {
  const [loading, setLoading] = useState(true);
  const [multisigInfo, setMultisigInfo] = useState<MultisigInfo | null>(null);
  const [cloudPubkey, setCloudPubkey] = useState<string | null>(null);
  const [devicePubkey, setDevicePubkey] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [domainMap, setDomainMap] = useState<Record<string, string>>({});

  useEffect(() => { logScreenView('KeysRecoveryScreen'); }, []);

  useEffect(() => {
    (async () => {
      try {
        const [vault, cloudPub, devicePub] = await Promise.all([
          getVault(),
          getCloudPublicKey(),
          getDevicePublicKey(),
        ]);

        setCloudPubkey(cloudPub);
        setDevicePubkey(devicePub);
        setWalletAddress(vault?.walletAddress ?? null);

        if (vault?.multisigAddress) {
          const info = await getMultisigInfo(vault.multisigAddress);
          setMultisigInfo(info);

          // Fetch .skr domains for all members
          fetchDomains(info.members.map(m => m.address));
        }
      } catch (err) {
        console.error('Failed to load multisig info:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fetchDomains = async (addresses: string[]) => {
    try {
      const domains = await apiService.resolveDomains(addresses);
      if (Object.keys(domains).length > 0) {
        setDomainMap(domains);
      }
    } catch {
      // Domain resolution is best-effort
    }
  };

  const copyAddress = (addr: string, field: string) => {
    Clipboard.setString(addr);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const { coreMembers, recoveryMembers } = multisigInfo
    ? classifyMembers(multisigInfo.members, cloudPubkey, devicePubkey, walletAddress)
    : { coreMembers: [], recoveryMembers: [] };

  const canAddRecovery = recoveryMembers.length < MAX_RECOVERY_KEYS;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#1E8260', '#19C394']}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Keys & Recovery</Text>
      </SafeAreaView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator size="large" color="#19C394" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Signing Keys */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Signing Keys</Text>
              <View style={styles.card}>
                {multisigInfo && (
                  <View style={styles.thresholdRow}>
                    <Text style={styles.thresholdText}>
                      Threshold: {multisigInfo.threshold} of {multisigInfo.members.length}
                    </Text>
                  </View>
                )}
                {coreMembers.map((m) => (
                  <TouchableOpacity
                    key={m.address}
                    style={styles.memberRow}
                    onPress={() => copyAddress(m.address, m.address)}
                    activeOpacity={0.6}
                  >
                    <View style={styles.memberLeft}>
                      <Text style={styles.memberLabel}>{m.label}</Text>
                      {domainMap[m.address] ? (
                        <Text style={styles.memberDomain}>{domainMap[m.address]}</Text>
                      ) : null}
                      <Text style={styles.memberAddress}>
                        {truncateAddress(m.address)}
                        {copiedField === m.address ? '  Copied!' : ''}
                      </Text>
                    </View>
                    <View style={styles.permissionBadges}>
                      {m.permissions.initiate && <View style={styles.badge}><Text style={styles.badgeText}>Initiate</Text></View>}
                      {m.permissions.vote && <View style={styles.badge}><Text style={styles.badgeText}>Vote</Text></View>}
                      {m.permissions.execute && <View style={styles.badge}><Text style={styles.badgeText}>Execute</Text></View>}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Recovery Keys */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Recovery Keys</Text>
              <View style={styles.card}>
                {recoveryMembers.length === 0 ? (
                  <Text style={styles.emptyText}>
                    Recovery keys allow trusted wallets to vote on proposals if you lose access to your main keys.
                  </Text>
                ) : (
                  recoveryMembers.map((m) => (
                    <TouchableOpacity
                      key={m.address}
                      style={styles.memberRow}
                      onPress={() => copyAddress(m.address, m.address)}
                      activeOpacity={0.6}
                    >
                      <View style={styles.memberLeft}>
                        <Text style={styles.memberLabel}>Recovery</Text>
                        {domainMap[m.address] ? (
                          <Text style={styles.memberDomain}>{domainMap[m.address]}</Text>
                        ) : null}
                        <Text style={styles.memberAddress}>
                          {truncateAddress(m.address)}
                          {copiedField === m.address ? '  Copied!' : ''}
                        </Text>
                      </View>
                      <View style={styles.permissionBadges}>
                        <View style={styles.badge}><Text style={styles.badgeText}>Vote</Text></View>
                      </View>
                    </TouchableOpacity>
                  ))
                )}

                {canAddRecovery && (
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => onNavigate('add-recovery-key')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.addButtonText}>+ Add Recovery Key</Text>
                  </TouchableOpacity>
                )}

                {!canAddRecovery && recoveryMembers.length > 0 && (
                  <Text style={styles.maxText}>Maximum recovery keys reached ({MAX_RECOVERY_KEYS})</Text>
                )}
              </View>
            </View>
          </>
        )}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  section: {
    paddingHorizontal: 14,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7B8D',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
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
    gap: 12,
  },
  thresholdRow: {
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  thresholdText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  memberLeft: {
    flex: 1,
  },
  memberLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 2,
  },
  memberDomain: {
    fontSize: 13,
    fontWeight: '600',
    color: '#19C394',
    marginBottom: 1,
  },
  memberAddress: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7B8D',
  },
  permissionBadges: {
    flexDirection: 'row',
    gap: 4,
  },
  badge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#19C394',
  },
  emptyText: {
    fontSize: 13,
    color: '#6B7B8D',
    lineHeight: 18,
  },
  addButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#F5FFF8',
    borderWidth: 1,
    borderColor: '#19C394',
    borderStyle: 'dashed',
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#19C394',
  },
  maxText: {
    fontSize: 12,
    color: '#B2B2B2',
    textAlign: 'center',
  },
});
