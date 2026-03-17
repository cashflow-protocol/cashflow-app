import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Linking,
} from 'react-native';
import BottomSheet from './BottomSheet';
import { verifyWaitlistAction, type WaitlistTaskItem } from '../services/onboardingService';
import { logVerifyActionOpen, logVerifyActionAttempt, logVerifyActionSuccess, logVerifyActionError } from '../services/analyticsService';

interface VerifyActionSheetProps {
  visible: boolean;
  onClose: () => void;
  task: WaitlistTaskItem | null;
  publicKey: string;
  onSuccess: () => void;
}

const FALLBACK_URLS: Record<string, string> = {
  follow_cashflow_x: 'https://x.com/cashflow_fi',
  follow_heymike_x: 'https://x.com/heymike777',
  retweet_announcement: 'https://x.com/cashflow_fi',
  subscribe_founders_tg: 'https://t.me/founders_journey',
};

export default function VerifyActionSheet({ visible, onClose, task, publicKey, onSuccess }: VerifyActionSheetProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (!visible) {
      setLoading(false);
      setMessage('');
    }
  }, [visible]);

  const handleOpenAction = useCallback(() => {
    if (!task) return;
    logVerifyActionOpen(task.taskId);
    const url = task.metadata?.profileUrl || task.metadata?.tweetUrl || task.metadata?.channelUrl || FALLBACK_URLS[task.taskId] || '';
    if (url) Linking.openURL(url);
  }, [task]);

  const handleVerify = useCallback(async () => {
    if (!task) return;
    logVerifyActionAttempt(task.taskId);
    setLoading(true);
    setMessage('');
    try {
      const result = await verifyWaitlistAction(publicKey, task.taskId);
      if (result.verified) {
        logVerifyActionSuccess(task.taskId);
        onSuccess();
        setMessage('');
      } else {
        logVerifyActionError(task.taskId, result.message || 'not_verified');
        setMessage(result.message || 'Could not verify. Please try again.');
      }
    } catch {
      logVerifyActionError(task.taskId, 'exception');
      setMessage('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [task, publicKey, onSuccess]);

  if (!task) return null;

  const actionLabel = task.taskId.startsWith('follow_')
    ? 'Open Profile'
    : task.taskId === 'retweet_announcement'
      ? 'Open Tweet'
      : 'Open Channel';

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{task.title}</Text>
      <Text style={styles.subtitle}>
        Complete this action and tap Verify to earn +{task.xpReward} XP.
      </Text>

      <TouchableOpacity
        style={styles.actionButton}
        onPress={handleOpenAction}
        activeOpacity={0.7}
      >
        <Text style={styles.actionButtonText}>{actionLabel}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.verifyButton, loading && styles.buttonDisabled]}
        onPress={handleVerify}
        disabled={loading}
        activeOpacity={0.7}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.verifyButtonText}>Verify</Text>
        )}
      </TouchableOpacity>

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  actionButton: {
    backgroundColor: '#F4F6FC',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#175DA3',
    fontSize: 16,
    fontWeight: '700',
  },
  verifyButton: {
    backgroundColor: '#175DA3',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  verifyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  message: {
    fontSize: 13,
    color: '#E53E3E',
    textAlign: 'center',
  },
});
