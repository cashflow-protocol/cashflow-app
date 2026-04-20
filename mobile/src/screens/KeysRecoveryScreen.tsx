import React, { useEffect, useState, useRef } from 'react';
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
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { ArrowLeft, MoreHorizontal, ScanFace, Cloud, Wallet, Compass, Info, X, KeyRound, ShieldCheck, RotateCcw, Download, TriangleAlert, MessageSquareText, CircleCheck, ChevronRight, Mail, ClipboardPaste, Trash2, CirclePlus } from 'lucide-react-native';
import BottomSheet from '../components/BottomSheet';
import { useLoginWithEmail, useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { getMultisigInfo, addMember, removeMember, type MultisigInfo } from '../services/squadsService';
import { getCloudPublicKey, getDevicePublicKey, getCloudPrivateKey, getDevicePrivateKey } from '../services/keypairStorage';
import { getVault, getRecoveryEmails, saveRecoveryEmail } from '../services/vaultStorage';
import apiService from '../services/apiService';
import { logScreenView, logAddRecoveryKeySubmit, logAddRecoveryKeySuccess, logAddRecoveryKeyError } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../contexts/ToastContext';

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

const MAX_RECOVERY_KEYS = 10;

function getKeyIcon(label: MemberLabel, color?: string) {
  switch (label) {
    case 'Device': return <ScanFace size={28} color={color ?? '#19C394'} />;
    case 'Cloud': return <Cloud size={28} color={color ?? '#4A6CF7'} />;
    default: return <Wallet size={28} color={color ?? '#6B7B8D'} />;
  }
}

function OtpInput({ value, onChange, disabled, colors, onComplete }: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  colors: any;
  onComplete?: () => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const digits = value.split('');

  return (
    <View style={styles.otpContainer}>
      <TextInput
        ref={inputRef}
        style={styles.otpHiddenInput}
        value={value}
        onChangeText={(t) => {
          const cleaned = t.replace(/[^0-9]/g, '').slice(0, 6);
          onChange(cleaned);
          if (cleaned.length === 6) {
            setTimeout(() => onCompleteRef.current?.(), 50);
          }
        }}
        keyboardType="number-pad"
        maxLength={6}
        editable={!disabled}
        autoFocus
        caretHidden
      />
      <View style={styles.otpCells}>
        {Array.from({ length: 6 }).map((_, i) => {
          const isFocused = value.length === i;
          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.otpCell,
                { backgroundColor: colors.cardSecondary, borderColor: isFocused ? colors.accentGreen : 'transparent' },
              ]}
              activeOpacity={1}
              onPress={() => inputRef.current?.focus()}
            >
              <Text style={[styles.otpDigit, { color: colors.textPrimary }]}>
                {digits[i] || ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function KeysRecoveryScreen({ onNavigate, onBack }: KeysRecoveryScreenProps) {
  const { colors } = useTheme();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [multisigInfo, setMultisigInfo] = useState<MultisigInfo | null>(null);
  const [cloudPubkey, setCloudPubkey] = useState<string | null>(null);
  const [devicePubkey, setDevicePubkey] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [domainMap, setDomainMap] = useState<Record<string, string>>({});
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  const [menuMember, setMenuMember] = useState<ClassifiedMember | null>(null);
  const [infoMember, setInfoMember] = useState<ClassifiedMember | null>(null);
  const [backupVisible, setBackupVisible] = useState(false);
  const [backupRevealed, setBackupRevealed] = useState(false);
  const [backupKey, setBackupKey] = useState<string | null>(null);
  const [backupKeyType, setBackupKeyType] = useState<'cloud' | 'device' | null>(null);
  const [addRecoveryVisible, setAddRecoveryVisible] = useState(false);
  const [addRecoveryStep, setAddRecoveryStep] = useState<'choose' | 'crypto' | 'email' | 'email-verify'>('choose');
  const [newWalletAddress, setNewWalletAddress] = useState('');
  const [addingKey, setAddingKey] = useState(false);
  const [addingStep, setAddingStep] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [recoveryMenuMember, setRecoveryMenuMember] = useState<ClassifiedMember | null>(null);
  const [deletingKey, setDeletingKey] = useState(false);

  const { sendCode, loginWithCode } = useLoginWithEmail();
  const wallet = useEmbeddedSolanaWallet();
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const { logout: privyLogout } = usePrivy();

  useEffect(() => { logScreenView('KeysRecoveryScreen'); }, []);

  useEffect(() => {
    (async () => {
      try {
        const [vault, cloudPub, devicePub, emails] = await Promise.all([
          getVault(),
          getCloudPublicKey(),
          getDevicePublicKey(),
          getRecoveryEmails(),
        ]);
        setEmailMap(emails);

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
    const keyType: 'cloud' | 'device' | null =
      menuMember?.label === 'Cloud' ? 'cloud' :
      menuMember?.label === 'Device' ? 'device' : null;
    if (!keyType) return;
    setMenuMember(null);
    setBackupKeyType(keyType);
    setTimeout(async () => {
      const pk = keyType === 'cloud' ? await getCloudPrivateKey() : await getDevicePrivateKey();
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
    setRecoveryEmail('');
    setEmailCode('');
    setAddingKey(false);
    setAddingStep('');
    setAddRecoveryVisible(true);
  };

  const handleAddRecoverySubmit = async () => {
    if (!newWalletAddress.trim()) {
      showToast('Error', 'Please enter a wallet address');
      return;
    }
    if (newWalletAddress.trim().length < 32 || newWalletAddress.trim().length > 44) {
      showToast('Error', 'Invalid Solana wallet address');
      return;
    }
    if (multisigInfo?.members.some(m => m.address === newWalletAddress.trim())) {
      showToast('Already Added', 'This wallet is already a member of your vault.', 'warning');
      return;
    }

    logAddRecoveryKeySubmit();
    setAddingKey(true);
    try {
      const vaultData = await getVault();
      if (!vaultData) {
        showToast('Error', 'No vault found.');
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

      showToast('Recovery Key Added', `Successfully added ${newWalletAddress.trim().slice(0, 8)}... as a recovery key.`, 'success');
    } catch (err: any) {
      logAddRecoveryKeyError(err?.message || 'unknown');
      showToast('Error', err?.message || 'Failed to add recovery key.');
    } finally {
      setAddingKey(false);
      setAddingStep('');
    }
  };

  const handleSendEmailCode = async () => {
    const trimmed = recoveryEmail.trim();
    if (!trimmed || !trimmed.includes('@')) {
      showToast('Error', 'Please enter a valid email address');
      return;
    }
    const existingEmail = Object.values(emailMap).find(e => e.toLowerCase() === trimmed.toLowerCase());
    if (existingEmail) {
      showToast('Already Added', 'This email is already a recovery key for your vault.', 'warning');
      return;
    }
    setSendingCode(true);
    try {
      // Log out of any existing Privy session so loginWithCode won't conflict
      await privyLogout().catch(() => {});
      await sendCode({ email: trimmed });
      setAddRecoveryStep('email-verify');
    } catch (err: any) {
      showToast('Error', err?.message || 'Failed to send code');
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyEmailCode = async () => {
    if (emailCode.length !== 6) {
      showToast('Error', 'Please enter the 6-digit code');
      return;
    }
    setAddingKey(true);
    setAddingStep('Verifying...');
    try {
      // Verify OTP through Privy — authenticates user & auto-creates Solana wallet
      await loginWithCode({ code: emailCode, email: recoveryEmail.trim() });

      // Wait for embedded wallet to be ready
      setAddingStep('Creating recovery wallet...');
      let solanaAddress: string | null = null;

      for (let i = 0; i < 20; i++) {
        const w = walletRef.current;
        if (w.status === 'connected' && w.wallets.length > 0) {
          solanaAddress = w.wallets[0].address;
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // If wallet wasn't ready yet, try creating (may already exist) then poll again
      if (!solanaAddress) {
        try {
          await walletRef.current.create?.();
        } catch {
          // Wallet likely already exists — just need to wait for it to connect
        }
        for (let i = 0; i < 20; i++) {
          const w = walletRef.current;
          if (w.status === 'connected' && w.wallets.length > 0) {
            solanaAddress = w.wallets[0].address;
            break;
          }
          await new Promise(r => setTimeout(r, 500));
        }
      }

      if (!solanaAddress) {
        throw new Error('Failed to connect to Privy embedded wallet');
      }

      if (multisigInfo?.members.some(m => m.address === solanaAddress)) {
        throw new Error('This email\'s wallet is already a member of your vault.');
      }

      setAddingStep('Adding recovery key...');

      const vaultData = await getVault();
      if (!vaultData) {
        showToast('Error', 'No vault found.');
        return;
      }
      await addMember(vaultData.multisigAddress, solanaAddress, 'vote');
      await saveRecoveryEmail(solanaAddress, recoveryEmail.trim());
      setEmailMap(prev => ({ ...prev, [solanaAddress]: recoveryEmail.trim() }));
      logAddRecoveryKeySuccess();
      setAddRecoveryVisible(false);

      // Log out of Privy session — we only needed it for wallet creation
      await privyLogout();

      const info = await getMultisigInfo(vaultData.multisigAddress);
      setMultisigInfo(info);
      fetchDomains(info.members.map(m => m.address));

      showToast('Recovery Key Added', `Email recovery key for ${recoveryEmail.trim()} has been added.`, 'success');
    } catch (err: any) {
      logAddRecoveryKeyError(err?.message || 'unknown');
      showToast('Error', err?.message || 'Failed to add recovery key.');
    } finally {
      setAddingKey(false);
      setAddingStep('');
    }
  };

  const handleRecoveryMenuInfo = () => {
    const member = recoveryMenuMember;
    setRecoveryMenuMember(null);
    setTimeout(() => setInfoMember(member), 300);
  };

  const handleRecoveryMenuExplorer = () => {
    if (recoveryMenuMember) openExplorer(recoveryMenuMember.address);
    setRecoveryMenuMember(null);
  };

  const handleDeleteRecoveryKey = () => {
    const member = recoveryMenuMember;
    if (!member) return;
    setRecoveryMenuMember(null);

    setTimeout(() => {
      const label = emailMap[member.address] || truncateAddress(member.address);
      Alert.alert(
        'Remove Recovery Key',
        `Are you sure you want to remove "${label}" as a recovery key?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              setDeletingKey(true);
              try {
                const vaultData = await getVault();
                if (!vaultData) throw new Error('No vault found.');
                await removeMember(vaultData.multisigAddress, member.address);

                setEmailMap(prev => {
                  const next = { ...prev };
                  delete next[member.address];
                  return next;
                });

                const info = await getMultisigInfo(vaultData.multisigAddress);
                setMultisigInfo(info);
                fetchDomains(info.members.map(m => m.address));
              } catch (err: any) {
                showToast('Error', err?.message || 'Failed to remove recovery key.');
              } finally {
                setDeletingKey(false);
              }
            },
          },
        ],
      );
    }, 300);
  };

  const getRecoveryIcon = (address: string) => {
    if (emailMap[address]) return <Mail size={28} color="#D946EF" />;
    return <Wallet size={28} color="#EF4444" />;
  };

  const getRecoveryLabel = (address: string) => {
    if (emailMap[address]) return 'Email';
    return 'External Wallet';
  };

  const getRecoveryDetail = (address: string) => {
    if (emailMap[address]) return emailMap[address];
    if (domainMap[address]) return domainMap[address];
    return truncateAddress(address);
  };

  const getRecoveryInfoContent = (address: string) => {
    if (emailMap[address]) {
      return {
        title: "What's a Recovery Key?",
        items: [
          { icon: <KeyRound size={20} color={colors.textPrimary} />, title: 'Wallet recovery', desc: `A Recovery Key can restore access to your wallet when paired with your Device or Cloud Key. Linked to ${emailMap[address]}` },
          { icon: <RotateCcw size={20} color={colors.textPrimary} />, title: 'Recovery only', desc: 'Recovery Keys have limited rights and can never access your Cashflow Vault without an associated Active Key' },
        ],
      };
    }
    return {
      title: "What's a Recovery Key?",
      items: [
        { icon: <KeyRound size={20} color={colors.textPrimary} />, title: 'Wallet recovery', desc: 'A Recovery Key can restore access to your wallet when paired with your Device or Cloud Key. Cashflow supports up to 10 Recovery Keys' },
        { icon: <RotateCcw size={20} color={colors.textPrimary} />, title: 'Recovery only', desc: 'Recovery Keys have limited rights and can never access your Cashflow Vault without an associated Active Key' },
      ],
    };
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
            { icon: <KeyRound size={20} color={colors.textPrimary} />, title: 'Active Key', desc: 'Used to approve transactions' },
            { icon: <ShieldCheck size={20} color={colors.textPrimary} />, title: 'Secure', desc: 'Stored on your device and protected by biometrics' },
            { icon: <RotateCcw size={20} color={colors.textPrimary} />, title: 'Recovery', desc: 'If lost, can be recovered by pairing your Cloud Key and Recovery Key' },
          ],
        };
      case 'Cloud':
        return {
          title: "What's a Cloud Key?",
          items: [
            { icon: <KeyRound size={20} color={colors.textPrimary} />, title: 'Active Key', desc: 'Used to approve transactions' },
            { icon: <Cloud size={20} color={colors.textPrimary} />, title: 'Cloud-backed', desc: 'Encrypted and stored securely in your cloud account' },
            { icon: <RotateCcw size={20} color={colors.textPrimary} />, title: 'Recovery', desc: 'If lost, can be recovered by pairing your Device Key and Recovery Key' },
          ],
        };
      default:
        return {
          title: "What's a Wallet Key?",
          items: [
            { icon: <KeyRound size={20} color={colors.textPrimary} />, title: 'Active Key', desc: 'Used to approve transactions' },
            { icon: <Wallet size={20} color={colors.textPrimary} />, title: 'External', desc: 'Connected from an external wallet' },
          ],
        };
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={colors.earnGradient as [string, string]}
        style={[styles.headerGradient, Platform.OS === 'android' && { paddingBottom: 16 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <TouchableOpacity onPress={onBack} style={[styles.backButton, { top: insets.top + 8 }]} activeOpacity={0.7}>
          <ArrowLeft size={24} color="#fff" />
        </TouchableOpacity>
        <SafeAreaView edges={['top']} style={styles.header}>
          <View style={[styles.headerContent, Platform.OS === 'android' && { paddingTop: 4, paddingBottom: 4 }]}>
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
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.accentGreen} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Active Keys */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Active Keys</Text>
              <View style={styles.keysRow}>
                {coreMembers.map((m) => (
                  <TouchableOpacity
                    key={m.address}
                    style={[styles.keyCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
                    onPress={() => copyAddress(m.address, m.address)}
                    activeOpacity={0.7}
                  >
                    {getKeyIcon(m.label)}
                    <View style={styles.keyCardInfo}>
                      <Text style={[styles.keyCardLabel, { color: colors.textPrimary }]}>{m.label}</Text>
                      <Text style={[styles.keyCardAddress, { color: colors.textTertiary }]}>
                        {domainMap[m.address] || truncateAddress(m.address)}
                        {copiedField === m.address ? '  Copied!' : ''}
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.menuButton} activeOpacity={0.5} onPress={() => setMenuMember(m)}>
                      <MoreHorizontal size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.keysHint, { color: colors.textTertiary }]}>
                Your wallet requires all Active Keys to authorize transactions. If you lose access to one Active key, your Recovery Keys can help restore full access to your account.
              </Text>
            </View>

            {/* Recovery Keys */}
            <View style={styles.section}>
              <View style={styles.recoverySectionHeader}>
                <View style={styles.recoverySectionLeft}>
                  <Text style={[styles.sectionLabel, { marginBottom: 0, color: colors.textSecondary }]}>Recovery Keys</Text>
                  {recoveryMembers.length > 0 && (
                    <View style={[styles.countBadge, { backgroundColor: colors.background }]}>
                      <Text style={[styles.countBadgeText, { color: colors.textSecondary }]}>{recoveryMembers.length}/{MAX_RECOVERY_KEYS}</Text>
                    </View>
                  )}
                </View>
                {canAddRecovery && (
                  <TouchableOpacity onPress={openAddRecovery} activeOpacity={0.6}>
                    <CirclePlus size={22} color={colors.textPrimary} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.keysRow}>
                {recoveryMembers.length === 0 ? (
                  <TouchableOpacity
                    style={[styles.addRecoveryEmptyCard, { backgroundColor: colors.card, borderColor: colors.accentGreen }]}
                    onPress={openAddRecovery}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.addButtonText, { color: colors.accentGreen }]}>+ Add Recovery Key</Text>
                  </TouchableOpacity>
                ) : (
                  recoveryMembers.map((m) => (
                    <TouchableOpacity
                      key={m.address}
                      style={[styles.keyCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
                      onPress={() => copyAddress(m.address, m.address)}
                      activeOpacity={0.7}
                    >
                      {getRecoveryIcon(m.address)}
                      <View style={styles.keyCardInfo}>
                        <Text style={[styles.keyCardLabel, { color: colors.textPrimary }]}>{getRecoveryLabel(m.address)}</Text>
                      </View>
                      <Text style={[styles.recoveryDetail, { color: colors.textTertiary }]}>
                        {getRecoveryDetail(m.address)}
                        {copiedField === m.address ? '  Copied!' : ''}
                      </Text>
                      <TouchableOpacity style={styles.menuButton} activeOpacity={0.5} onPress={() => setRecoveryMenuMember(m)}>
                        <MoreHorizontal size={18} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              {!canAddRecovery && recoveryMembers.length > 0 && (
                <Text style={[styles.maxText, { color: colors.textTertiary }]}>Maximum recovery keys reached</Text>
              )}

              {recoveryMembers.length < 2 && (
                <TouchableOpacity style={[styles.recoverySuggestion, { backgroundColor: colors.cardSecondary }]} activeOpacity={0.7} onPress={openAddRecovery}>
                  <View style={[styles.recoverySuggestionIcon, { backgroundColor: colors.border }]}>
                    <ShieldCheck size={18} color="#F59E0B" />
                  </View>
                  <View style={styles.recoverySuggestionText}>
                    <Text style={[styles.recoverySuggestionTitle, { color: colors.textPrimary }]}>
                      {recoveryMembers.length === 0 ? 'Add a Recovery Key' : 'Add one more Recovery Key'}
                    </Text>
                    <Text style={[styles.recoverySuggestionDesc, { color: colors.textSecondary }]}>
                      {recoveryMembers.length === 0
                        ? 'Protect your wallet by adding at least 2 recovery keys in case you lose access to your device.'
                        : 'We recommend at least 2 recovery keys for better security.'}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}

              <Text style={[styles.keysHint, { color: colors.textTertiary }]}>
                Recovery Keys help you regain access to your wallet if you lose access to one of the Active Keys. You can choose between a key tied to your email or an external crypto wallet.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* Recovery Key Menu */}
      <BottomSheet visible={!!recoveryMenuMember} onClose={() => setRecoveryMenuMember(null)}>
        <View style={styles.menuSheet}>
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleRecoveryMenuInfo}>
            <Info size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>More info</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleRecoveryMenuExplorer}>
            <Compass size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Explorer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleDeleteRecoveryKey}>
            <Trash2 size={20} color={colors.accentRed} />
            <Text style={[styles.menuItemText, { color: colors.accentRed }]}>Delete key</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Key Menu */}
      <BottomSheet visible={!!menuMember} onClose={() => setMenuMember(null)}>
        <View style={styles.menuSheet}>
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleMenuMoreInfo}>
            <Info size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>More info</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleMenuExplorer}>
            <Compass size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Explorer</Text>
          </TouchableOpacity>
          {(menuMember?.label === 'Cloud' || menuMember?.label === 'Device') && (
            <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={handleMenuBackup}>
              <Download size={20} color={colors.textPrimary} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Backup key</Text>
            </TouchableOpacity>
          )}
        </View>
      </BottomSheet>

      {/* Key Info Modal */}
      <BottomSheet visible={!!infoMember} onClose={() => setInfoMember(null)}>
        {infoMember && (() => {
          const content = infoMember.label === 'Recovery'
            ? getRecoveryInfoContent(infoMember.address)
            : getInfoContent(infoMember.label);
          return (
            <View style={styles.infoSheet}>
              <TouchableOpacity style={styles.infoClose} activeOpacity={0.6} onPress={() => setInfoMember(null)}>
                <X size={20} color={colors.textTertiary} />
              </TouchableOpacity>
              <View style={[
                styles.infoIconWrapper,
                { backgroundColor: colors.cardSecondary },
                infoMember.label === 'Recovery' && { backgroundColor: colors.accentGreen },
              ]}>
                {infoMember.label === 'Recovery'
                  ? getRecoveryIcon(infoMember.address)
                  : getKeyIcon(infoMember.label)}
              </View>
              <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>{content.title}</Text>
              <View style={styles.infoItems}>
                {content.items.map((item, i) => (
                  <View key={i} style={styles.infoItem}>
                    {item.icon}
                    <View style={styles.infoItemText}>
                      <Text style={[styles.infoItemTitle, { color: colors.textPrimary }]}>{item.title}</Text>
                      <Text style={[styles.infoItemDesc, { color: colors.textTertiary }]}>{item.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.infoButton, { backgroundColor: colors.cardSecondary }]}
                activeOpacity={0.7}
                onPress={() => setInfoMember(null)}
              >
                <Text style={[styles.infoButtonText, { color: colors.textPrimary }]}>Got it</Text>
              </TouchableOpacity>
            </View>
          );
        })()}
      </BottomSheet>

      {/* Backup Key Modal */}
      <BottomSheet visible={backupVisible} onClose={() => setBackupVisible(false)}>
        <View style={styles.backupSheet}>
          <Text style={[styles.backupTitle, { color: colors.textPrimary }]}>Private Key</Text>
          <Text style={[styles.backupDesc, { color: colors.textTertiary }]}>
            {backupKeyType === 'device'
              ? 'Your Device Key Private Key is used to recover access to this device key if it gets lost or invalidated (e.g., after biometric re-enrollment or reinstall).'
              : 'Your Private Key is used to recover access to your Cloud key in case iCloud services are not accessible for any reason.'}
          </Text>

          <TouchableOpacity
            style={[styles.backupRevealBox, { backgroundColor: colors.cardSecondary }]}
            activeOpacity={0.7}
            onPress={backupRevealed ? handleCopyBackup : handleRevealBackup}
          >
            {backupRevealed ? (
              <Text style={[styles.backupKeyText, { color: colors.textPrimary }]} selectable>
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
              <TriangleAlert size={18} color={colors.accentRed} />
              <Text style={[styles.backupWarningText, { color: colors.textTertiary }]}>Never share this Key with anyone.</Text>
            </View>
            <View style={styles.backupWarningItem}>
              <MessageSquareText size={18} color={colors.textTertiary} />
              <Text style={[styles.backupWarningText, { color: colors.textTertiary }]}>
                {backupKeyType === 'device'
                  ? 'By continuing, you acknowledge that if a person has your Cloud Key (or connected Wallet) and your Device Key, they control your Cashflow wallet.'
                  : 'By continuing, you acknowledge that if a person has your Device Key and Private Key of your Cloud key, they control your Cashflow wallet.'}
              </Text>
            </View>
            <View style={styles.backupWarningItem}>
              <Cloud size={18} color={colors.textTertiary} />
              <Text style={[styles.backupWarningText, { color: colors.textTertiary }]}>
                {backupKeyType === 'device'
                  ? 'Store this key somewhere safe and offline. If your Device Key gets compromised, remove it from your vault and add a new Device Key immediately.'
                  : 'In case your Private Key gets compromised, your Cashflow wallet is still safe as long your device is with you. Nevertheless, change the Cloud Key immediately as soon as you become aware of the incident.'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.infoButton, { backgroundColor: colors.cardSecondary }]}
            activeOpacity={0.7}
            onPress={() => { setBackupVisible(false); setBackupRevealed(false); setBackupKey(null); setBackupKeyType(null); }}
          >
            <Text style={[styles.infoButtonText, { color: colors.textPrimary }]}>Cancel</Text>
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
            <Text style={[styles.addRecoveryTitle, { color: colors.textPrimary }]}>Add Recovery Key</Text>

            <View style={styles.addRecoveryInfo}>
              <View style={styles.addRecoveryInfoItem}>
                <CircleCheck size={20} color={colors.textPrimary} />
                <View style={styles.addRecoveryInfoText}>
                  <Text style={[styles.addRecoveryInfoTitle, { color: colors.textPrimary }]}>Wallet recovery</Text>
                  <Text style={[styles.addRecoveryInfoDesc, { color: colors.textTertiary }]}>
                    A Recovery Key can restore access to your wallet when paired with your Device or Cloud Key. Cashflow supports up to 10 Recovery Keys
                  </Text>
                </View>
              </View>
              <View style={styles.addRecoveryInfoItem}>
                <CircleCheck size={20} color={colors.textPrimary} />
                <View style={styles.addRecoveryInfoText}>
                  <Text style={[styles.addRecoveryInfoTitle, { color: colors.textPrimary }]}>Recovery only</Text>
                  <Text style={[styles.addRecoveryInfoDesc, { color: colors.textTertiary }]}>
                    Recovery Keys have limited rights and can never access your Cashflow Vault without an Active Key
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.addRecoveryMethods}>
              <TouchableOpacity
                style={[styles.addRecoveryMethodCard, { backgroundColor: colors.cardSecondary }]}
                activeOpacity={0.7}
                onPress={() => setAddRecoveryStep('crypto')}
              >
                <Wallet size={22} color={colors.textTertiary} />
                <Text style={[styles.addRecoveryMethodLabel, { color: colors.textPrimary }]}>Crypto wallet</Text>
                <ChevronRight size={20} color={colors.textTertiary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addRecoveryMethodCard, { backgroundColor: colors.cardSecondary }]}
                activeOpacity={0.7}
                onPress={() => setAddRecoveryStep('email')}
              >
                <Mail size={22} color={colors.textTertiary} />
                <Text style={[styles.addRecoveryMethodLabel, { color: colors.textPrimary }]}>Email</Text>
                <ChevronRight size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </View>
        ) : addRecoveryStep === 'crypto' ? (
          <View style={styles.addRecoverySheet}>
            <TouchableOpacity
              onPress={() => !addingKey && setAddRecoveryStep('choose')}
              activeOpacity={0.7}
              style={[styles.cryptoBackButton, { backgroundColor: colors.cardSecondary }]}
            >
              <ArrowLeft size={20} color={colors.textPrimary} />
            </TouchableOpacity>

            <Text style={[styles.addRecoveryTitle, { color: colors.textPrimary }]}>Crypto Wallet</Text>
            <Text style={[styles.cryptoSubtitle, { color: colors.textPrimary }]}>
              Enter a wallet address in the field below
            </Text>

            <View style={[styles.cryptoInputRow, { backgroundColor: colors.cardSecondary }]}>
              <TextInput
                style={[styles.cryptoInput, { color: colors.textPrimary }]}
                value={newWalletAddress}
                onChangeText={setNewWalletAddress}
                placeholder="Enter public key"
                placeholderTextColor={colors.placeholderColor}
                editable={!addingKey}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={handlePasteAddress} activeOpacity={0.6} style={styles.cryptoPasteButton}>
                <Text style={[styles.cryptoPasteText, { color: colors.textPrimary }]}>Paste</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.cryptoHintRow}>
              <Info size={16} color={colors.textTertiary} />
              <Text style={[styles.cryptoHintText, { color: colors.textTertiary }]}>
                Do not use addresses from centralized exchanges.{'\n'}This must be a self-custody wallet that you can sign with.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.cryptoNextButton, { backgroundColor: colors.primaryButton }, (!newWalletAddress.trim() || addingKey) && styles.cryptoNextButtonDisabled]}
              activeOpacity={0.7}
              onPress={handleAddRecoverySubmit}
              disabled={!newWalletAddress.trim() || addingKey}
            >
              {addingKey ? (
                <View style={styles.addRecoveryLoading}>
                  <ActivityIndicator size="small" color={colors.primaryButtonText} />
                  <Text style={[styles.cryptoNextText, { color: colors.primaryButtonText }]}>{addingStep || 'Processing...'}</Text>
                </View>
              ) : (
                <Text style={[styles.cryptoNextText, { color: colors.primaryButtonText }]}>Next</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : addRecoveryStep === 'email' ? (
          <View style={styles.addRecoverySheet}>
            <TouchableOpacity
              onPress={() => !sendingCode && setAddRecoveryStep('choose')}
              activeOpacity={0.7}
              style={[styles.cryptoBackButton, { backgroundColor: colors.cardSecondary }]}
            >
              <ArrowLeft size={20} color={colors.textPrimary} />
            </TouchableOpacity>

            <Text style={[styles.addRecoveryTitle, { color: colors.textPrimary }]}>Email</Text>
            <Text style={[styles.cryptoSubtitle, { color: colors.textPrimary }]}>
              Enter email address in the field below
            </Text>

            <View style={[styles.cryptoInputRow, { backgroundColor: colors.cardSecondary }]}>
              <TextInput
                style={[styles.cryptoInput, { color: colors.textPrimary }]}
                value={recoveryEmail}
                onChangeText={setRecoveryEmail}
                placeholder="Email address"
                placeholderTextColor={colors.placeholderColor}
                editable={!sendingCode}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <TouchableOpacity onPress={handlePasteEmail} activeOpacity={0.6} style={styles.cryptoPasteButton}>
                <Text style={[styles.cryptoPasteText, { color: colors.textPrimary }]}>Paste</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.cryptoNextButton, { backgroundColor: colors.primaryButton }, (!recoveryEmail.trim().includes('@') || sendingCode) && styles.cryptoNextButtonDisabled]}
              activeOpacity={0.7}
              onPress={handleSendEmailCode}
              disabled={!recoveryEmail.trim().includes('@') || sendingCode}
            >
              {sendingCode ? (
                <View style={styles.addRecoveryLoading}>
                  <ActivityIndicator size="small" color={colors.primaryButtonText} />
                  <Text style={[styles.cryptoNextText, { color: colors.primaryButtonText }]}>Sending...</Text>
                </View>
              ) : (
                <Text style={[styles.cryptoNextText, { color: colors.primaryButtonText }]}>Send code</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : addRecoveryStep === 'email-verify' ? (
          <View style={styles.addRecoverySheet}>
            <TouchableOpacity
              onPress={() => !addingKey && setAddRecoveryStep('email')}
              activeOpacity={0.7}
              style={[styles.cryptoBackButton, { backgroundColor: colors.cardSecondary }]}
            >
              <ArrowLeft size={20} color={colors.textPrimary} />
            </TouchableOpacity>

            <Text style={[styles.addRecoveryTitle, { color: colors.textPrimary }]}>Verify Email</Text>
            <Text style={[styles.cryptoSubtitle, { color: colors.textPrimary }]}>
              Enter the 6-digit code sent to{'\n'}{recoveryEmail.trim()}
            </Text>

            <OtpInput
              value={emailCode}
              onChange={setEmailCode}
              disabled={addingKey}
              colors={colors}
              onComplete={handleVerifyEmailCode}
            />

            <TouchableOpacity
              style={[styles.cryptoNextButton, { backgroundColor: colors.primaryButton }, (emailCode.length !== 6 || addingKey) && styles.cryptoNextButtonDisabled]}
              activeOpacity={0.7}
              onPress={handleVerifyEmailCode}
              disabled={emailCode.length !== 6 || addingKey}
            >
              {addingKey ? (
                <View style={styles.addRecoveryLoading}>
                  <ActivityIndicator size="small" color={colors.primaryButtonText} />
                  <Text style={[styles.cryptoNextText, { color: colors.primaryButtonText }]}>{addingStep || 'Processing...'}</Text>
                </View>
              ) : (
                <Text style={[styles.cryptoNextText, { color: colors.primaryButtonText }]}>Verify</Text>
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
  },
  headerGradient: {
    paddingBottom: 40,
  },
  header: {},
  backButton: {
    position: 'absolute',
    top: 8,
    left: 16,
    zIndex: 1,
    padding: 4,
  },
  headerContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 8,
    paddingBottom: 16,
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
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  keysRow: {
    gap: 10,
  },
  keyCard: {
    borderRadius: 14,
    padding: 16,
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
  },
  menuButton: {
    padding: 4,
  },
  keyCardAddress: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  recoverySectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  recoverySectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  addPlusButton: {
    fontSize: 24,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  addRecoveryEmptyCard: {
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  recoveryDetail: {
    fontSize: 13,
    fontWeight: '500',
  },
  recoverySuggestion: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    alignItems: 'flex-start',
    marginTop: 10,
  },
  recoverySuggestionIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recoverySuggestionText: {
    flex: 1,
  },
  recoverySuggestionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  recoverySuggestionDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  keysHint: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 14,
    paddingHorizontal: 2,
  },
  card: {
    borderRadius: 14,
    padding: 16,
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
    marginBottom: 2,
  },
  memberDomain: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 1,
  },
  memberAddress: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
  },
  addButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  maxText: {
    fontSize: 12,
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
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
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
    marginBottom: 2,
  },
  infoItemDesc: {
    fontSize: 14,
    lineHeight: 20,
  },
  infoButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  infoButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Backup key modal
  backupSheet: {
    paddingBottom: 8,
  },
  backupTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  backupDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  backupRevealBox: {
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
    marginBottom: 4,
  },
  addRecoveryInfoDesc: {
    fontSize: 14,
    lineHeight: 20,
  },
  addRecoveryMethods: {
    gap: 10,
    marginTop: 8,
  },
  addRecoveryMethodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    gap: 12,
  },
  addRecoveryMethodLabel: {
    fontSize: 16,
    fontWeight: '600',
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
    borderRadius: 20,
    marginBottom: 8,
  },
  cryptoSubtitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    marginTop: -4,
  },
  cryptoInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginTop: 8,
  },
  cryptoInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    paddingVertical: 12,
  },
  cryptoPasteButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  cryptoPasteText: {
    fontSize: 15,
    fontWeight: '600',
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
    lineHeight: 18,
  },
  cryptoNextButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  cryptoNextButtonDisabled: {
    opacity: 0.4,
  },
  cryptoNextText: {
    fontWeight: '700',
    fontSize: 16,
  },
  otpContainer: {
    marginTop: 12,
  },
  otpHiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 0,
    width: 0,
  },
  otpCells: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  otpCell: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 52,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigit: {
    fontSize: 24,
    fontWeight: '700',
  },
});
