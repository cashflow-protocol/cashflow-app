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
  startConnectX,
  startConnectDiscord,
  startConnectTelegram,
  type WaitlistTaskItem,
} from '../services/onboardingService';
import { generateAndStoreCloudKeypair, getCloudPublicKey } from '../services/keypairStorage';
import ConnectEmailSheet from '../components/ConnectEmailSheet';
import ConnectTelegramSheet from '../components/ConnectTelegramSheet';
import VerifyActionSheet from '../components/VerifyActionSheet';

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

  // Auto-close Telegram sheet when returning to app after connecting
  useEffect(() => {
    if (!telegramSheetVisible || !publicKey) return;
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        const data = await getWaitlistTasks(publicKey);
        const tgTask = data.tasks.find((t) => t.taskId === 'connect_telegram');
        if (tgTask?.completed) {
          setTelegramSheetVisible(false);
          setTasks(data.tasks);
          setXp(data.xp);
          setRank(data.rank);
        }
      }
    });
    return () => sub.remove();
  }, [telegramSheetVisible, publicKey]);

  const handleTaskPress = async (task: WaitlistTaskItem) => {
    if (task.completed || task.locked || !publicKey) return;

    switch (task.taskId) {
      case 'connect_email':
        setEmailSheetVisible(true);
        break;
      case 'connect_x': {
        const xResult = await startConnectX(publicKey);
        if (xResult?.authUrl) {
          Linking.openURL(xResult.authUrl);
        } else {
          Alert.alert('Not Available', 'Twitter integration is not configured yet.');
        }
        break;
      }
      case 'connect_discord': {
        const dResult = await startConnectDiscord(publicKey);
        if (dResult?.authUrl) {
          Linking.openURL(dResult.authUrl);
        } else {
          Alert.alert('Not Available', 'Discord integration is not configured yet.');
        }
        break;
      }
      case 'connect_telegram': {
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
      case 'follow_cashflow_x':
      case 'follow_heymike_x':
      case 'retweet_announcement':
      case 'subscribe_founders_tg':
        setVerifyTask(task);
        setVerifySheetVisible(true);
        break;
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
      <View style={styles.container}>
        <LinearGradient
          colors={['#104982', '#3985D8']}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3985D8" />
        </View>
      </View>
    );
  }

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#104982', '#3985D8']}
        style={[styles.headerGradient, { height: gradientHeight }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView
        edges={['top']}
        style={styles.header}
        onLayout={(e) => setGradientHeight(e.nativeEvent.layout.height + 34)}
      >
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={styles.backButton}>
          <ArrowLeft size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Waitlist</Text>
        <Text style={styles.headerSubtitle}>
          Complete tasks to earn XP{'\n'}and move up the queue
        </Text>
      </SafeAreaView>

      {/* Stat cards */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statsContainer}
        style={styles.statsScroll}
      >
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <Zap size={20} color="#fff" />
            </View>
            <View>
              <Text style={styles.statLabel}>Your XP</Text>
              <Text style={styles.statValue}>{xp}</Text>
            </View>
          </View>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <Hash size={20} color="#fff" />
            </View>
            <View>
              <Text style={styles.statLabel}>Queue Position</Text>
              <Text style={styles.statValue}>#{rank}</Text>
            </View>
          </View>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <Clock size={20} color="#fff" />
            </View>
            <View>
              <Text style={styles.statLabel}>Next Invite Batch</Text>
              <Text style={styles.statValue}>{countdown}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Task list */}
      <ScrollView
        style={styles.taskList}
        contentContainerStyle={styles.taskListContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#3985D8"
          />
        }
      >
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Tasks</Text>
          <Text style={styles.sectionCount}>{completedCount}/{tasks.length}</Text>
        </View>
        {tasks.map((task) => (
          <TouchableOpacity
            key={task.taskId}
            style={[
              styles.taskRow,
              task.locked && styles.taskRowLocked,
            ]}
            onPress={() => handleTaskPress(task)}
            disabled={task.completed || task.locked}
            activeOpacity={0.7}
          >
            <View style={styles.taskLeft}>
              {task.completed ? (
                <View style={[styles.taskIconCircle, styles.taskIconCompleted]}>
                  <Check size={14} color="#fff" />
                </View>
              ) : task.locked ? (
                <View style={[styles.taskIconCircle, styles.taskIconLocked]}>
                  <Lock size={14} color="#999" />
                </View>
              ) : (
                <View style={styles.taskIconCircle} />
              )}
              <View style={styles.taskInfo}>
                <Text
                  style={[
                    styles.taskTitle,
                    task.completed && styles.taskTitleCompleted,
                    task.locked && styles.taskTitleLocked,
                  ]}
                >
                  {task.title}
                </Text>
                {task.locked && task.requiresTask && (
                  <Text style={styles.taskRequires}>
                    Requires: {tasks.find((t) => t.taskId === task.requiresTask)?.title ?? task.requiresTask}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.taskRight}>
              <Text
                style={[
                  styles.taskXp,
                  task.completed && styles.taskXpCompleted,
                  task.locked && styles.taskXpLocked,
                ]}
              >
                +{task.xpReward} XP
              </Text>
              {!task.completed && !task.locked && (
                <ChevronRight size={16} color="#CCC" />
              )}
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={styles.inviteCodeButton}
          onPress={onHaveInviteCode}
          activeOpacity={0.7}
        >
          <Text style={styles.inviteCodeButtonText}>I have an invite code</Text>
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
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8EAF1',
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
    color: '#fff',
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.7)',
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
    backgroundColor: '#3985D8',
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
    color: '#1A1A1A',
  },
  sectionCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7B8D',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
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
    borderColor: '#D0D5DD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskIconCompleted: {
    backgroundColor: '#22C55E',
    borderColor: '#22C55E',
  },
  taskIconLocked: {
    backgroundColor: '#F2F4F7',
    borderColor: '#E4E7EC',
  },
  taskInfo: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  taskTitleCompleted: {
    color: '#22C55E',
  },
  taskTitleLocked: {
    color: '#999',
  },
  taskRequires: {
    fontSize: 12,
    color: '#999',
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
    color: '#3985D8',
  },
  taskXpCompleted: {
    color: '#22C55E',
  },
  taskXpLocked: {
    color: '#999',
  },
  inviteCodeButton: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  inviteCodeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3985D8',
  },
});
