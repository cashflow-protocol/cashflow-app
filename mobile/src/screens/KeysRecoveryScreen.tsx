import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Clipboard,
  Linking,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { ArrowLeft, MoreHorizontal, ScanFace, Cloud, Wallet, Compass, Info, X, KeyRound, ShieldCheck, RotateCcw, Download, TriangleAlert, MessageSquareText, CircleCheck, ChevronRight, Mail, ClipboardPaste } from 'lucide-react-native';
import BottomSheet from '../components/BottomSheet';
import { getMultisigInfo, addMember, type MultisigInfo } from '../services/squadsService';
import { getCloudPublicKey, getDevicePublicKey, getCloudPrivateKey } from '../services/keypairStorage';
import { getVault } from '../services/vaultStorage';
import apiService from '../services/apiService';
import { logScreenView, logAddRecoveryKeySubmit, logAddRecoveryKeySuccess, logAddRecoveryKeyError } from '../services/analyticsService';

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

function getKeyIcon(label: MemberLabel, color?: string) {
  switch (label) {
    case 'Device': return <ScanFace size={28} color={color ?? '#19C394'} />;
    case 'Cloud': return <Cloud size={28} color={color ?? '#4A6CF7'} />;
    default: return <Wallet size={28} color={color ?? '#6B7B8D'} />;
  }
}

export default function KeysRecoveryScreen({ onNavigate, onBack }: KeysRecoveryScreenProps) {
  const [loading, setLoading] = useState(true);
  const [multisigInfo, setMultisigInfo] = useState<MultisigInfo | null>(null);
  const [cloudPubkey, setCloudPubkey] = useState<string | null>(null);
  const [devicePubkey, setDevicePubkey] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [domainMap, setDomainMap] = useState<Record<string, string>>({});
  const [menuMember, setMenuMember] = useState<ClassifiedMember | null>(null);
  const [infoMember, setInfoMember] = useState<ClassifiedMember | null>(null);
  const [backupVisible, setBackupVisible] = useState(false);
  const [backupRevealed, setBackupRevealed] = useState(false);
  const [backupKey, setBackupKey] = useState<string | null>(null);
  const [addRecoveryVisible, setAddRecoveryVisible] = useState(false);
  const [addRecoveryStep, setAddRecoveryStep] = useState<'choose' | 'crypto' | 'email' | 'email-verify'>('choose');
  const [newWalletAddress, setNewWalletAddress] = useState('');
  const [addingKey, setAddingKey] = useState(false);
  const [addingStep, setAddingStep] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);

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

  const openExplorer = (address: string) => {
    Linking.openURL(`https://solscan.io/account/${address}`);
  };

  const handleMenuMoreInfo = () => {
    const member = menuMember;
    setMenuMember(null);
    setTimeout(() => setInfoMember(member), 300);
  };

  const handleMenuExplorer = () => {
    if (menuMember) openExplorer(menuMember.address);
    setMenuMember(null);
  };

  const handleMenuBackup = () => {
    setMenuMember(null);
    setTimeout(async () => {
      const pk = await getCloudPrivateKey();
      setBackupKey(pk);
      setBackupRevealed(false);
      setBackupVisible(true);
    }, 300);
  };

  const handleRevealBackup = () => {
    setBackupRevealed(true);
  };

  const handleCopyBackup = () => {
    if (backupKey) {
      Clipboard.setString(backupKey);
      setCopiedField('backup');
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const openAddRecovery = () => {
    setAddRecoveryStep('choose');
    setNewWalletAddress('');
    setAddingKey(false);
    setAddingStep('');
    setAddRecoveryVisible(true);
  };

  const handleAddRecoverySubmit = async () => {
    if (!newWalletAddress.trim()) {
      Alert.alert('Error', 'Please enter a wallet address');
      return;
    }
    if (newWalletAddress.trim().length < 32 || newWalletAddress.trim().length > 44) {
      Alert.alert('Error', 'Invalid Solana wallet address');
      return;
    }

    logAddRecoveryKeySubmit();
    setAddingKey(true);
    try {
      const vaultData = await getVault();
      if (!vaultData) {
        Alert.alert('Error', 'No vault found.');
        return;
      }
      setAddingStep('Creating proposal & approving...');
      await addMember(vaultData.multisigAddress, newWalletAddress.trim(), 'vote');
      logAddRecoveryKeySuccess();
      setAddRecoveryVisible(false);

      // Refresh multisig info
      const info = await getMultisigInfo(vaultData.multisigAddress);
      setMultisigInfo(info);
      fetchDomains(info.members.map(m => m.address));

      Alert.alert('Recovery Key Added', `Successfully added ${newWalletAddress.trim().slice(0, 8)}... as a recovery key.`);
    } catch (err: any) {
      logAddRecoveryKeyError(err?.message || 'unknown');
      Alert.alert('Error', err?.message || 'Failed to add recovery key.');
    } finally {
      setAddingKey(false);
      setAddingStep('');
    }
  };

  const handleSendEmailCode = async () => {
    const trimmed = recoveryEmail.trim();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }
    setSendingCode(true);
    try {
      await apiService.sendRecoveryCode(trimmed);
      setAddRecoveryStep('email-verify');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to send code');
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyEmailCode = async () => {
    if (emailCode.length !== 6) {
      Alert.alert('Error', 'Please enter the 6-digit code');
      return;
    }
    setAddingKey(true);
    setAddingStep('Verifying...');
    try {
      const solanaAddress = await apiService.verifyRecoveryCode(recoveryEmail.trim(), emailCode);
      setAddingStep('Adding recovery key...');

      const vaultData = await getVault();
      if (!vaultData) {
        Alert.alert('Error', 'No vault found.');
        return;
      }
      await addMember(vaultData.multisigAddress, solanaAddress, 'vote');
      logAddRecoveryKeySuccess();
      setAddRecoveryVisible(false);

      const info = await getMultisigInfo(vaultData.multisigAddress);
      setMultisigInfo(info);
      fetchDomains(info.members.map(m => m.address));

      Alert.alert('Recovery Key Added', `Email recovery key for ${recoveryEmail.trim()} has been added.`);
    } catch (err: any) {
      logAddRecoveryKeyError(err?.message || 'unknown');
      Alert.alert('Error', err?.message || 'Failed to add recovery key.');
    } finally {
      setAddingKey(false);
      setAddingStep('');
    }
  };

  const handlePasteEmail = async () => {
    try {
      const text = await Clipboard.getString();
      if (text) setRecoveryEmail(text.trim());
    } catch {}
  };

  const handlePasteAddress = async () => {
    try {
      const text = await Clipboard.getString();
      if (text) setNewWalletAddress(text.trim());
    } catch {}
  };

  const getInfoContent = (label: MemberLabel) => {
    switch (label) {
      case 'Device':
        return {
          title: "What's a Device Key?",
          items: [
            { icon: <KeyRound size={20} color="#1A1A1A" />, title: 'Active Key', desc: 'Used to approve transactions' },
            { icon: <ShieldCheck size={20} color="#1A1A1A" />, title: 'Secure', desc: 'Stored on your device and protected by biometrics' },
            { icon: <RotateCcw size={20} color="#1A1A1A" />, title: 'Recovery', desc: 'If lost, can be recovered by pairing your Cloud Key and Recovery Key' },
          ],
        };
      case 'Cloud':
        return {
          title: "What's a Cloud Key?",
          items: [
            { icon: <KeyRound size={20} color="#1A1A1A" />, title: 'Active Key', desc: 'Used to approve transactions' },
            { icon: <Cloud size={20} color="#1A1A1A" />, title: 'Cloud-backed', desc: 'Encrypted and stored securely in your cloud account' },
            { icon: <RotateCcw size={20} color="#1A1A1A" />, title: 'Recovery', desc: 'If lost, can be recovered by pairing your Device Key and Recovery Key' },
          ],
        };
      default:
        return {
          title: "What's a Wallet Key?",
          items: [
            { icon: <KeyRound size={20} color="#1A1A1A" />, title: 'Active Key', desc: 'Used to approve transactions' },
            { icon: <Wallet size={20} color="#1A1A1A" />, title: 'External', desc: 'Connected from an external wallet' },
          ],
        };
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#1E8260', '#19C394']}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <SafeAreaView edges={['top']} style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.7}>
            <ArrowLeft size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>Keys & Recovery</Text>
            <Text style={styles.subtitle}>
              Manage the keys that control your wallet.
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator size="large" color="#19C394" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Active Keys */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Active Keys</Text>
              <View style={styles.keysRow}>
                {coreMembers.map((m) => (
                  <TouchableOpacity
                    key={m.address}
                    style={styles.keyCard}
                    onPress={() => copyAddress(m.address, m.address)}
                    activeOpacity={0.7}
                  >
                    {getKeyIcon(m.label)}
                    <View style={styles.keyCardInfo}>
                      <Text style={styles.keyCardLabel}>{m.label}</Text>
                      <Text style={styles.keyCardAddress}>
                        {truncateAddress(m.address)}
                        {copiedField === m.address ? '  Copied!' : ''}
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.menuButton} activeOpacity={0.5} onPress={() => setMenuMember(m)}>
                      <MoreHorizontal size={18} color="#B2B2B2" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.keysHint}>
                Your wallet requires all Active Keys to authorize transactions. If you lose access to one Active key, your Recovery Keys can help restore full access to your account.
              </Text>
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
                    </TouchableOpacity>
                  ))
                )}

                {canAddRecovery && (
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={openAddRecovery}
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

      {/* Key Menu */}
      <BottomSheet visible={!!menuMember} onClose={() => setMenuMember(null)}>
        <View style={styles.menuSheet}>
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleMenuMoreInfo}>
            <Info size={20} color="#1A1A1A" />
            <Text style={styles.menuItemText}>More info</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleMenuExplorer}>
            <Compass size={20} color="#1A1A1A" />
            <Text style={styles.menuItemText}>Explorer</Text>
          </TouchableOpacity>
          {menuMember?.label === 'Cloud' && (
            <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleMenuBackup}>
              <Download size={20} color="#1A1A1A" />
              <Text style={styles.menuItemText}>Backup key</Text>
            </TouchableOpacity>
          )}
        </View>
      </BottomSheet>

      {/* Key Info Modal */}
      <BottomSheet visible={!!infoMember} onClose={() => setInfoMember(null)}>
        {infoMember && (() => {
          const content = getInfoContent(infoMember.label);
          return (
            <View style={styles.infoSheet}>
              <TouchableOpacity style={styles.infoClose} activeOpacity={0.6} onPress={() => setInfoMember(null)}>
                <X size={20} color="#9CA3AF" />
              </TouchableOpacity>
              <View style={styles.infoIconWrapper}>
                {getKeyIcon(infoMember.label, '#fff')}
              </View>
              <Text style={styles.infoTitle}>{content.title}</Text>
              <View style={styles.infoItems}>
                {content.items.map((item, i) => (
                  <View key={i} style={styles.infoItem}>
                    {item.icon}
                    <View style={styles.infoItemText}>
                      <Text style={styles.infoItemTitle}>{item.title}</Text>
                      <Text style={styles.infoItemDesc}>{item.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={styles.infoButton}
                activeOpacity={0.7}
                onPress={() => setInfoMember(null)}
              >
                <Text style={styles.infoButtonText}>Got it</Text>
              </TouchableOpacity>
            </View>
          );
        })()}
      </BottomSheet>

      {/* Backup Key Modal */}
      <BottomSheet visible={backupVisible} onClose={() => setBackupVisible(false)}>
        <View style={styles.backupSheet}>
          <Text style={styles.backupTitle}>Private Key</Text>
          <Text style={styles.backupDesc}>
            Your Private Key is used to recover access to your Cloud key in case iCloud services are not accessible for any reason.
          </Text>

          <TouchableOpacity
            style={styles.backupRevealBox}
            activeOpacity={0.7}
            onPress={backupRevealed ? handleCopyBackup : handleRevealBackup}
          >
            {backupRevealed ? (
              <Text style={styles.backupKeyText} selectable>
                {backupKey}
                {copiedField === 'backup' ? '\n\nCopied!' : ''}
              </Text>
            ) : (
              <View style={styles.backupRevealContent}>
                <ScanFace size={22} color="#4A6CF7" />
                <Text style={styles.backupRevealText}>Reveal</Text>
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.backupWarnings}>
            <View style={styles.backupWarningItem}>
              <TriangleAlert size={18} color="#EF4444" />
              <Text style={styles.backupWarningText}>Never share this Key with anyone.</Text>
            </View>
            <View style={styles.backupWarningItem}>
              <MessageSquareText size={18} color="#9CA3AF" />
              <Text style={styles.backupWarningText}>
                By continuing, you acknowledge that if a person has your Device Key and Private Key of your Cloud key, they control your Cashflow wallet.
              </Text>
            </View>
            <View style={styles.backupWarningItem}>
              <Cloud size={18} color="#9CA3AF" />
              <Text style={styles.backupWarningText}>
                In case your Private Key gets compromised, your Cashflow wallet is still safe as long your device is with you. Nevertheless, change the Cloud Key immediately as soon as you become aware of the incident.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.infoButton}
            activeOpacity={0.7}
            onPress={() => { setBackupVisible(false); setBackupRevealed(false); setBackupKey(null); }}
          >
            <Text style={styles.infoButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Add Recovery Key Modal */}
      <BottomSheet
        visible={addRecoveryVisible}
        onClose={() => !addingKey && setAddRecoveryVisible(false)}
        avoidKeyboard
      >
        {addRecoveryStep === 'choose' ? (
          <View style={styles.addRecoverySheet}>
            <Text style={styles.addRecoveryTitle}>Add{'\n'}Recovery Key</Text>

            <View style={styles.addRecoveryInfo}>
              <View style={styles.addRecoveryInfoItem}>
                <CircleCheck size={20} color="#1A1A1A" />
                <View style={styles.addRecoveryInfoText}>
                  <Text style={styles.addRecoveryInfoTitle}>Wallet recovery</Text>
                  <Text style={styles.addRecoveryInfoDesc}>
                    A Recovery Key can restore access to your wallet when paired with your Device or Cloud Key. Cashflow supports up to 3 Recovery Keys
                  </Text>
                </View>
              </View>
              <View style={styles.addRecoveryInfoItem}>
                <CircleCheck size={20} color="#1A1A1A" />
                <View style={styles.addRecoveryInfoText}>
                  <Text style={styles.addRecoveryInfoTitle}>Recovery only</Text>
                  <Text style={styles.addRecoveryInfoDesc}>
                    Recovery Keys have limited rights and can never access your Cashflow Vault without an Active Key
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.addRecoveryMethods}>
              <TouchableOpacity
                style={styles.addRecoveryMethodCard}
                activeOpacity={0.7}
                onPress={() => setAddRecoveryStep('crypto')}
              >
                <Wallet size={22} color="#9CA3AF" />
                <Text style={styles.addRecoveryMethodLabel}>Crypto wallet</Text>
                <ChevronRight size={20} color="#9CA3AF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addRecoveryMethodCard}
                activeOpacity={0.7}
                onPress={() => setAddRecoveryStep('email')}
              >
                <Mail size={22} color="#9CA3AF" />
                <Text style={styles.addRecoveryMethodLabel}>Email</Text>
                <ChevronRight size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          </View>
        ) : addRecoveryStep === 'crypto' ? (
          <View style={styles.addRecoverySheet}>
            <TouchableOpacity
              onPress={() => !addingKey && setAddRecoveryStep('choose')}
              activeOpacity={0.7}
              style={styles.cryptoBackButton}
            >
              <ArrowLeft size={20} color="#1A1A1A" />
            </TouchableOpacity>

            <Text style={styles.addRecoveryTitle}>Crypto Wallet</Text>
            <Text style={styles.cryptoSubtitle}>
              Enter a wallet address{'\n'}in the field below
            </Text>

            <View style={styles.cryptoInputRow}>
              <TextInput
                style={styles.cryptoInput}
                value={newWalletAddress}
                onChangeText={setNewWalletAddress}
                placeholder="Enter public key"
                placeholderTextColor="#C5C5C5"
                editable={!addingKey}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={handlePasteAddress} activeOpacity={0.6} style={styles.cryptoPasteButton}>
                <Text style={styles.cryptoPasteText}>Paste</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.cryptoHintRow}>
              <Info size={16} color="#B2B2B2" />
              <Text style={styles.cryptoHintText}>
                Do not use addresses from centralized exchanges.{'\n'}This must be a self-custody wallet that you can sign with.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.cryptoNextButton, (!newWalletAddress.trim() || addingKey) && styles.cryptoNextButtonDisabled]}
              activeOpacity={0.7}
              onPress={handleAddRecoverySubmit}
              disabled={!newWalletAddress.trim() || addingKey}
            >
              {addingKey ? (
                <View style={styles.addRecoveryLoading}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.cryptoNextText}>{addingStep || 'Processing...'}</Text>
                </View>
              ) : (
                <Text style={styles.cryptoNextText}>Next</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : addRecoveryStep === 'email' ? (
          <View style={styles.addRecoverySheet}>
            <TouchableOpacity
              onPress={() => !sendingCode && setAddRecoveryStep('choose')}
              activeOpacity={0.7}
              style={styles.cryptoBackButton}
            >
              <ArrowLeft size={20} color="#1A1A1A" />
            </TouchableOpacity>

            <Text style={styles.addRecoveryTitle}>Email</Text>
            <Text style={styles.cryptoSubtitle}>
              Enter email address{'\n'}in the field below
            </Text>

            <View style={styles.cryptoInputRow}>
              <TextInput
                style={styles.cryptoInput}
                value={recoveryEmail}
                onChangeText={setRecoveryEmail}
                placeholder="Email address"
                placeholderTextColor="#C5C5C5"
                editable={!sendingCode}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <TouchableOpacity onPress={handlePasteEmail} activeOpacity={0.6} style={styles.cryptoPasteButton}>
                <Text style={styles.cryptoPasteText}>Paste</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.cryptoNextButton, (!recoveryEmail.trim().includes('@') || sendingCode) && styles.cryptoNextButtonDisabled]}
              activeOpacity={0.7}
              onPress={handleSendEmailCode}
              disabled={!recoveryEmail.trim().includes('@') || sendingCode}
            >
              {sendingCode ? (
                <View style={styles.addRecoveryLoading}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.cryptoNextText}>Sending...</Text>
                </View>
              ) : (
                <Text style={styles.cryptoNextText}>Send code</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : addRecoveryStep === 'email-verify' ? (
          <View style={styles.addRecoverySheet}>
            <TouchableOpacity
              onPress={() => !addingKey && setAddRecoveryStep('email')}
              activeOpacity={0.7}
              style={styles.cryptoBackButton}
            >
              <ArrowLeft size={20} color="#1A1A1A" />
            </TouchableOpacity>

            <Text style={styles.addRecoveryTitle}>Verify Email</Text>
            <Text style={styles.cryptoSubtitle}>
              Enter the 6-digit code sent to{'\n'}{recoveryEmail.trim()}
            </Text>

            <View style={styles.cryptoInputRow}>
              <TextInput
                style={styles.cryptoInput}
                value={emailCode}
                onChangeText={setEmailCode}
                placeholder="000000"
                placeholderTextColor="#C5C5C5"
                editable={!addingKey}
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>

            <TouchableOpacity
              style={[styles.cryptoNextButton, (emailCode.length !== 6 || addingKey) && styles.cryptoNextButtonDisabled]}
              activeOpacity={0.7}
              onPress={handleVerifyEmailCode}
              disabled={emailCode.length !== 6 || addingKey}
            >
              {addingKey ? (
                <View style={styles.addRecoveryLoading}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.cryptoNextText}>{addingStep || 'Processing...'}</Text>
                </View>
              ) : (
                <Text style={styles.cryptoNextText}>Verify</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8EAF1',
  },
  headerGradient: {
    paddingBottom: 24,
  },
  header: {},
  backButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
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
  keysRow: {
    gap: 10,
  },
  keyCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  keyCardInfo: {
    flex: 1,
  },
  keyCardLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  menuButton: {
    padding: 4,
  },
  keyCardAddress: {
    fontSize: 13,
    fontWeight: '500',
    color: '#B2B2B2',
    marginTop: 2,
  },
  keysHint: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 18,
    marginTop: 14,
    paddingHorizontal: 2,
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
  // Menu bottom sheet
  menuSheet: {
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  // Info bottom sheet
  infoSheet: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  infoClose: {
    position: 'absolute',
    right: 0,
    top: 0,
    padding: 4,
    zIndex: 1,
  },
  infoIconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 20,
  },
  infoItems: {
    width: '100%',
    gap: 18,
    marginBottom: 24,
  },
  infoItem: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  infoItemText: {
    flex: 1,
  },
  infoItemTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 2,
  },
  infoItemDesc: {
    fontSize: 14,
    color: '#9CA3AF',
    lineHeight: 20,
  },
  infoButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  infoButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  // Backup key modal
  backupSheet: {
    paddingBottom: 8,
  },
  backupTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  backupDesc: {
    fontSize: 14,
    color: '#9CA3AF',
    lineHeight: 20,
    marginBottom: 20,
  },
  backupRevealBox: {
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
    marginBottom: 20,
  },
  backupRevealContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backupRevealText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4A6CF7',
  },
  backupKeyText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1A1A1A',
    lineHeight: 20,
    textAlign: 'center',
  },
  backupWarnings: {
    gap: 16,
    marginBottom: 24,
  },
  backupWarningItem: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  backupWarningText: {
    flex: 1,
    fontSize: 14,
    color: '#9CA3AF',
    lineHeight: 20,
  },
  // Add Recovery Key modal
  addRecoverySheet: {
    paddingBottom: 8,
    gap: 16,
  },
  addRecoveryTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  addRecoveryInfo: {
    gap: 20,
  },
  addRecoveryInfoItem: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  addRecoveryInfoText: {
    flex: 1,
  },
  addRecoveryInfoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  addRecoveryInfoDesc: {
    fontSize: 14,
    color: '#9CA3AF',
    lineHeight: 20,
  },
  addRecoveryMethods: {
    gap: 10,
    marginTop: 8,
  },
  addRecoveryMethodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F8',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    gap: 12,
  },
  addRecoveryMethodLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    flex: 1,
  },
  comingSoonBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  comingSoonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F5A623',
  },
  addRecoveryLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // Crypto wallet step
  cryptoBackButton: {
    alignSelf: 'flex-start',
    padding: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    marginBottom: 8,
  },
  cryptoSubtitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
    lineHeight: 22,
    marginTop: -4,
  },
  cryptoInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F8',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginTop: 8,
  },
  cryptoInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#1A1A1A',
    paddingVertical: 12,
  },
  cryptoPasteButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  cryptoPasteText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  cryptoHintRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: 4,
  },
  cryptoHintText: {
    flex: 1,
    fontSize: 13,
    color: '#B2B2B2',
    lineHeight: 18,
  },
  cryptoNextButton: {
    backgroundColor: '#1A1A1A',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  cryptoNextButtonDisabled: {
    opacity: 0.4,
  },
  cryptoNextText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
