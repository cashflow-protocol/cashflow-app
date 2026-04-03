import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Linking,
  Alert,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { ArrowLeft, Check, Lock, ChevronRight, Zap, Hash, Clock } from 'lucide-react-native';
import {
  getWaitlistTasks,
  checkWaitlistStatus,
  registerWaitlist,
  connectWallet as connectWalletApi,
  startConnectX,
  startConnectDiscord,
  startConnectTelegram,
  type WaitlistTaskItem,
} from '../services/onboardingService';
import { useWallet } from '../hooks/useWallet';
import { generateAndStoreCloudKeypair, getCloudPublicKey } from '../services/keypairStorage';
import ConnectEmailSheet from '../components/ConnectEmailSheet';
import ConnectTelegramSheet from '../components/ConnectTelegramSheet';
import VerifyActionSheet from '../components/VerifyActionSheet';
import UploadScreenshotSheet from '../components/UploadScreenshotSheet';
import { logScreenView, logWaitlistTaskPress, logWaitlistApproved, logOnboardingHaveInviteCode, logError } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

function getCountdown(): string {
  const now = new Date();
  const next = new Date(now);
  if (now.getUTCHours() < 12) {
    next.setUTCHours(12, 0, 0, 0);
  } else {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
  }
  const diff = next.getTime() - now.getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

interface WaitlistDashboardScreenProps {
  onApproved: (inviteCode: string) => void;
  onBack: () => void;
  onHaveInviteCode: () => void;
}

export default function WaitlistDashboardScreen({ onApproved, onBack, onHaveInviteCode }: WaitlistDashboardScreenProps) {
  const { colors } = useTheme();
  const { connect: connectWallet } = useWallet();
  const [gradientHeight, setGradientHeight] = useState(255);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WaitlistTaskItem[]>([]);
  const [xp, setXp] = useState(0);
  const [rank, setRank] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [emailSheetVisible, setEmailSheetVisible] = useState(false);
  const [telegramSheetVisible, setTelegramSheetVisible] = useState(false);
  const [telegramCode, setTelegramCode] = useState('');
  const [telegramBotUrl, setTelegramBotUrl] = useState('');
  const [verifySheetVisible, setVerifySheetVisible] = useState(false);
  const [screenshotSheetVisible, setScreenshotSheetVisible] = useState(false);
  const [screenshotStoreUrl, setScreenshotStoreUrl] = useState('');
  const [screenshotTaskId, setScreenshotTaskId] = useState('');
  const [verifyTask, setVerifyTask] = useState<WaitlistTaskItem | null>(null);
  const [countdown, setCountdown] = useState(getCountdown());
  useEffect(() => {
    const id = setInterval(() => setCountdown(getCountdown()), 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        let pk = await getCloudPublicKey();
        if (!pk) {
          pk = await generateAndStoreCloudKeypair();
        }
        setPublicKey(pk);

        await registerWaitlist(pk);
        await loadTasks(pk);
      } catch (err) {
        console.error('Waitlist init error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadTasks = async (pk: string) => {
    const data = await getWaitlistTasks(pk);
    setTasks(data.tasks);
    setXp(data.xp);
    setRank(data.rank);

    const status = await checkWaitlistStatus(pk);
    if (status.approved && status.inviteCode) {
      logWaitlistApproved();
      onApproved(status.inviteCode);
    }
  };

  const handleRefresh = useCallback(async () => {
    if (!publicKey) return;
    setRefreshing(true);
    try {
      await loadTasks(publicKey);
    } catch (err) {
      console.error('Refresh error:', err);
    } finally {
      setRefreshing(false);
    }
  }, [publicKey]);

  // Deep link listener for OAuth callbacks
  useEffect(() => {
    const handleDeepLink = (event: { url: string }) => {
      if (event.url.startsWith('cashflow://oauth/callback') && publicKey) {
        loadTasks(publicKey);
      }
    };
    const sub = Linking.addEventListener('url', handleDeepLink);
    return () => sub.remove();
  }, [publicKey]);

  // Refresh waitlist data when app returns to foreground
  useEffect(() => {
    if (!publicKey) return;
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        const data = await getWaitlistTasks(publicKey);
        setTasks(data.tasks);
        setXp(data.xp);
        setRank(data.rank);

        if (telegramSheetVisible) {
          const tgTask = data.tasks.find((t) => t.metadata?.provider === 'telegram');
          if (tgTask?.completed) {
            setTelegramSheetVisible(false);
          }
        }

        const status = await checkWaitlistStatus(publicKey);
        if (status.approved && status.inviteCode) {
          logWaitlistApproved();
          onApproved(status.inviteCode);
        }
      }
    });
    return () => sub.remove();
  }, [publicKey, telegramSheetVisible]);

  React.useEffect(() => { logScreenView('WaitlistDashboardScreen'); }, []);

  const handleTaskPress = async (task: WaitlistTaskItem) => {
    if (task.completed || task.locked || !publicKey) return;
    logWaitlistTaskPress(task.id);

    if (task.category === 'social_connect') {
      switch (task.metadata?.provider) {
        case 'wallet': {
          try {
            const account = await connectWallet();
            if (account) {
              await connectWalletApi(publicKey, account.publicKey as string);
              loadTasks(publicKey);
            }
          } catch (err: any) {
            const msg = err?.message || '';
            if (!msg.includes('CancellationException')) {
              logError('waitlist_connect_wallet', msg);
              Alert.alert('Error', msg || 'Failed to connect wallet.');
            }
          }
          break;
        }
        case 'email':
          setEmailSheetVisible(true);
          break;
        case 'x': {
          const xResult = await startConnectX(publicKey);
          if (xResult?.authUrl) {
            Linking.openURL(xResult.authUrl);
          } else {
            Alert.alert('Not Available', 'Twitter integration is not configured yet.');
          }
          break;
        }
        case 'discord': {
          const dResult = await startConnectDiscord(publicKey);
          if (dResult?.authUrl) {
            Linking.openURL(dResult.authUrl);
          } else {
            Alert.alert('Not Available', 'Discord integration is not configured yet.');
          }
          break;
        }
        case 'telegram': {
          const tResult = await startConnectTelegram(publicKey);
          if (tResult) {
            setTelegramCode(tResult.code);
            setTelegramBotUrl(tResult.botUrl);
            setTelegramSheetVisible(true);
          } else {
            Alert.alert('Not Available', 'Telegram integration is not configured yet.');
          }
          break;
        }
      }
    } else if (task.category === 'social_action') {
      setVerifyTask(task);
      setVerifySheetVisible(true);
    } else if (task.metadata?.requiresScreenshot) {
      setScreenshotTaskId(task.id);
      setScreenshotStoreUrl(task.metadata.storeUrl || 'https://cashflow.fun/download');
      setScreenshotSheetVisible(true);
    }
  };

  const handleEmailSuccess = useCallback((_xpAwarded: number) => {
    setEmailSheetVisible(false);
    if (publicKey) {
      loadTasks(publicKey);
    }
  }, [publicKey]);

  const handleTelegramClose = useCallback(() => {
    setTelegramSheetVisible(false);
    if (publicKey) loadTasks(publicKey);
  }, [publicKey]);

  const handleVerifySuccess = useCallback(() => {
    setVerifySheetVisible(false);
    setVerifyTask(null);
    if (publicKey) loadTasks(publicKey);
  }, [publicKey]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LinearGradient
          colors={['#104982', colors.accentBlue]}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accentBlue} />
        </View>
      </View>
    );
  }

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={['#104982', colors.accentBlue]}
        style={[styles.headerGradient, { height: gradientHeight }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView
        edges={['top']}
        style={styles.header}
      >
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={styles.backButton}>
          <ArrowLeft size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: '#FFFFFF' }]}>Waitlist</Text>
        <Text style={[styles.headerSubtitle, { color: 'rgba(255,255,255,0.7)' }]}>
          Complete tasks to earn XP{'\n'}and move up the queue
        </Text>
      </SafeAreaView>

      {/* Stat cards */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statsContainer}
        style={styles.statsScroll}
        onLayout={(e) => {
          const { y, height } = e.nativeEvent.layout;
          setGradientHeight(y + height / 2);
        }}
      >
        <View style={[styles.statCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
          <View style={styles.statRow}>
            <View style={[styles.statIconCircle, { backgroundColor: colors.accentBlue }]}>
              <Zap size={20} color={colors.primaryButtonText} />
            </View>
            <View>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Your XP</Text>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>{xp}</Text>
            </View>
          </View>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
          <View style={styles.statRow}>
            <View style={[styles.statIconCircle, { backgroundColor: colors.accentBlue }]}>
              <Hash size={20} color={colors.primaryButtonText} />
            </View>
            <View>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Queue Position</Text>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>#{rank}</Text>
            </View>
          </View>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
          <View style={styles.statRow}>
            <View style={[styles.statIconCircle, { backgroundColor: colors.accentBlue }]}>
              <Clock size={20} color={colors.primaryButtonText} />
            </View>
            <View>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Next Invite Batch</Text>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>{countdown}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Task list */}
      <ScrollView
        style={styles.taskList}
        contentContainerStyle={styles.taskListContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accentBlue}
          />
        }
      >
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Tasks</Text>
          <Text style={[styles.sectionCount, { color: colors.textSecondary }]}>{completedCount}/{tasks.length}</Text>
        </View>
        {tasks.map((task) => (
          <TouchableOpacity
            key={task.id}
            style={[
              styles.taskRow,
              { backgroundColor: colors.card, shadowColor: colors.shadowColor },
              task.locked && styles.taskRowLocked,
            ]}
            onPress={() => handleTaskPress(task)}
            disabled={task.completed || task.locked}
            activeOpacity={0.7}
          >
            <View style={styles.taskLeft}>
              {task.completed ? (
                <View style={[styles.taskIconCircle, styles.taskIconCompleted, { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen }]}>
                  <Check size={14} color={colors.primaryButtonText} />
                </View>
              ) : task.locked ? (
                <View style={[styles.taskIconCircle, styles.taskIconLocked, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
                  <Lock size={14} color={colors.textTertiary} />
                </View>
              ) : (
                <View style={[styles.taskIconCircle, { borderColor: colors.border }]} />
              )}
              <View style={styles.taskInfo}>
                <Text
                  style={[
                    styles.taskTitle,
                    { color: colors.textPrimary },
                    task.completed && [styles.taskTitleCompleted, { color: colors.accentGreen }],
                    task.locked && [styles.taskTitleLocked, { color: colors.textTertiary }],
                  ]}
                >
                  {task.title}
                </Text>
                {task.locked && task.requiresTask && (
                  <Text style={[styles.taskRequires, { color: colors.textTertiary }]}>
                    Requires: {tasks.find((t) => t.id === task.requiresTask)?.title ?? 'prerequisite'}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.taskRight}>
              <Text
                style={[
                  styles.taskXp,
                  { color: colors.accentBlue },
                  task.completed && [styles.taskXpCompleted, { color: colors.accentGreen }],
                  task.locked && [styles.taskXpLocked, { color: colors.textTertiary }],
                ]}
              >
                +{task.xpReward} XP
              </Text>
              {!task.completed && !task.locked && (
                <ChevronRight size={16} color={colors.border} />
              )}
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={styles.inviteCodeButton}
          onPress={() => { logOnboardingHaveInviteCode('waitlist'); onHaveInviteCode(); }}
          activeOpacity={0.7}
        >
          <Text style={[styles.inviteCodeButtonText, { color: colors.accentBlue }]}>I have an invite code</Text>
        </TouchableOpacity>

      </ScrollView>

      {publicKey && (
        <>
          <ConnectEmailSheet
            visible={emailSheetVisible}
            onClose={() => setEmailSheetVisible(false)}
            publicKey={publicKey}
            onSuccess={handleEmailSuccess}
          />
          <ConnectTelegramSheet
            visible={telegramSheetVisible}
            onClose={handleTelegramClose}
            code={telegramCode}
            botUrl={telegramBotUrl}
          />
          <VerifyActionSheet
            visible={verifySheetVisible}
            onClose={() => { setVerifySheetVisible(false); setVerifyTask(null); }}
            task={verifyTask}
            publicKey={publicKey}
            onSuccess={handleVerifySuccess}
          />
          <UploadScreenshotSheet
            visible={screenshotSheetVisible}
            onClose={() => { setScreenshotSheetVisible(false); setScreenshotTaskId(''); }}
            publicKey={publicKey}
            taskId={screenshotTaskId}
            storeUrl={screenshotStoreUrl}
            onSuccess={() => {
              setScreenshotSheetVisible(false);
              setScreenshotTaskId('');
              loadTasks(publicKey);
            }}
          />
        </>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  header: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 24,
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: 4,
    marginLeft: 16,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  statsScroll: {
    maxHeight: 70,
    marginBottom: 12,
  },
  statsContainer: {
    paddingHorizontal: 14,
    gap: 10,
  },
  statCard: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minWidth: 150,
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  taskList: {
    flex: 1,
  },
  taskListContent: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionCount: {
    fontSize: 14,
    fontWeight: '600',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  taskRowLocked: {
    opacity: 0.55,
  },
  taskLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  taskIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskIconCompleted: {
  },
  taskIconLocked: {
  },
  taskInfo: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  taskTitleCompleted: {
  },
  taskTitleLocked: {
  },
  taskRequires: {
    fontSize: 12,
    marginTop: 2,
  },
  taskRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taskXp: {
    fontSize: 14,
    fontWeight: '700',
  },
  taskXpCompleted: {
  },
  taskXpLocked: {
  },
  inviteCodeButton: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  inviteCodeButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  hackathonHint: {
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.6,
    marginTop: 8,
  },
});
