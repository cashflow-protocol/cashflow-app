import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import {
  getWaitlistTasks,
  checkWaitlistStatus,
  registerWaitlist,
  type WaitlistTaskItem,
} from '../services/onboardingService';
import { generateAndStoreCloudKeypair, getCloudPublicKey } from '../services/keypairStorage';
import ConnectEmailSheet from '../components/ConnectEmailSheet';

interface WaitlistDashboardScreenProps {
  onApproved: (inviteCode: string) => void;
  onBack: () => void;
}

function CheckIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
        fill="#22C55E"
      />
    </Svg>
  );
}

function LockIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z"
        fill="#999"
      />
    </Svg>
  );
}

function ChevronIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9.29 6.71a1 1 0 000 1.41L13.17 12l-3.88 3.88a1 1 0 101.41 1.41l4.59-4.59a1 1 0 000-1.41L10.7 6.7a1 1 0 00-1.41.01z"
        fill="#CCC"
      />
    </Svg>
  );
}

export default function WaitlistDashboardScreen({ onApproved, onBack }: WaitlistDashboardScreenProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WaitlistTaskItem[]>([]);
  const [xp, setXp] = useState(0);
  const [rank, setRank] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [emailSheetVisible, setEmailSheetVisible] = useState(false);

  // Initialize: get or generate cloud keypair, register, load tasks
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

    // Check approval status
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

  const handleTaskPress = (task: WaitlistTaskItem) => {
    if (task.completed || task.locked) return;

    switch (task.taskId) {
      case 'connect_email':
        setEmailSheetVisible(true);
        break;
      case 'connect_x':
      case 'connect_discord':
      case 'connect_telegram':
      case 'follow_cashflow_x':
      case 'follow_heymike_x':
      case 'retweet_announcement':
      case 'subscribe_founders_tg':
        // TODO: PR 3 — OAuth flows and action verification
        break;
    }
  };

  const handleEmailSuccess = useCallback((xpAwarded: number) => {
    setEmailSheetVisible(false);
    if (publicKey) {
      loadTasks(publicKey);
    }
  }, [publicKey]);

  if (loading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#0D4A82', '#175DA3', '#347AC0', '#5A9AD5']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0D4A82', '#175DA3', '#347AC0', '#5A9AD5']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} activeOpacity={0.7}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Waitlist</Text>
          <View style={styles.backText as any} />
        </View>

        {/* XP & Rank Card */}
        <View style={styles.statsCard}>
          <Text style={styles.xpLabel}>Your XP</Text>
          <Text style={styles.xpValue}>{xp}</Text>
          <Text style={styles.rankText}>
            You are #{rank}. Get more points to rank higher.
          </Text>
        </View>

        {/* Tasks */}
        <ScrollView
          style={styles.taskList}
          contentContainerStyle={styles.taskListContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#fff"
            />
          }
        >
          <Text style={styles.sectionTitle}>Tasks</Text>
          {tasks.map((task) => (
            <TouchableOpacity
              key={task.taskId}
              style={[
                styles.taskRow,
                task.completed && styles.taskRowCompleted,
                task.locked && styles.taskRowLocked,
              ]}
              onPress={() => handleTaskPress(task)}
              disabled={task.completed || task.locked}
              activeOpacity={0.7}
            >
              <View style={styles.taskLeft}>
                {task.completed ? (
                  <CheckIcon />
                ) : task.locked ? (
                  <LockIcon />
                ) : (
                  <View style={styles.taskDot} />
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
                {!task.completed && !task.locked && <ChevronIcon />}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>

      {publicKey && (
        <ConnectEmailSheet
          visible={emailSheetVisible}
          onClose={() => setEmailSheetVisible(false)}
          publicKey={publicKey}
          onSuccess={handleEmailSuccess}
        />
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
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backText: {
    fontSize: 17,
    color: '#fff',
    fontWeight: '600',
    minWidth: 50,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  statsCard: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  xpLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
  },
  xpValue: {
    fontSize: 48,
    fontWeight: '800',
    color: '#fff',
    marginVertical: 4,
  },
  rankText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  taskList: {
    flex: 1,
  },
  taskListContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  taskRowCompleted: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  taskRowLocked: {
    opacity: 0.5,
  },
  taskLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  taskDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  taskInfo: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  taskTitleCompleted: {
    color: '#22C55E',
  },
  taskTitleLocked: {
    color: 'rgba(255, 255, 255, 0.6)',
  },
  taskRequires: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
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
    color: '#FFD700',
  },
  taskXpCompleted: {
    color: '#22C55E',
  },
  taskXpLocked: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
});
