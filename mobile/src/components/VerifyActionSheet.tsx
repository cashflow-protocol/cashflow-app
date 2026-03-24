import React, { useState, useCallback, useEffect } from 'react';
import {
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Linking,
} from 'react-native';
import BottomSheet from './BottomSheet';
import { verifyWaitlistAction, type WaitlistTaskItem } from '../services/onboardingService';
import { logVerifyActionOpen, logVerifyActionAttempt, logVerifyActionSuccess, logVerifyActionError } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

interface VerifyActionSheetProps {
  visible: boolean;
  onClose: () => void;
  task: WaitlistTaskItem | null;
  publicKey: string;
  onSuccess: () => void;
}

export default function VerifyActionSheet({ visible, onClose, task, publicKey, onSuccess }: VerifyActionSheetProps) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!visible) {
      setLoading(false);
      setMessage('');
    }
  }, [visible]);

  const handleOpenAction = useCallback(() => {
    if (!task) return;
    logVerifyActionOpen(task.id);
    const url = task.metadata?.profileUrl || task.metadata?.tweetUrl || task.metadata?.channelUrl || '';
    if (url) Linking.openURL(url);
  }, [task]);

  const handleVerify = useCallback(async () => {
    if (!task) return;
    logVerifyActionAttempt(task.id);
    setLoading(true);
    setMessage('');
    try {
      const result = await verifyWaitlistAction(publicKey, task.id);
      if (result.verified) {
        logVerifyActionSuccess(task.id);
        onSuccess();
        setMessage('');
      } else {
        logVerifyActionError(task.id, result.message || 'not_verified');
        setMessage(result.message || 'Could not verify. Please try again.');
      }
    } catch {
      logVerifyActionError(task.id, 'exception');
      setMessage('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [task, publicKey, onSuccess]);

  if (!task) return null;

  const actionLabel = task.metadata?.handle
    ? 'Open Profile'
    : task.metadata?.tweetId || task.metadata?.tweetUrl
      ? 'Open Tweet'
      : 'Open Channel';

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{task.title}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Complete this action and tap Verify to earn +{task.xpReward} XP.
      </Text>

      <TouchableOpacity
        style={[styles.actionButton, { backgroundColor: colors.inputBackground }]}
        onPress={handleOpenAction}
        activeOpacity={0.7}
      >
        <Text style={[styles.actionButtonText, { color: colors.accentBlue }]}>{actionLabel}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.verifyButton, { backgroundColor: colors.accentBlue }, loading && styles.buttonDisabled]}
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

      {message ? <Text style={[styles.message, { color: colors.errorText }]}>{message}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
  },
  actionButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  verifyButton: {
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
    textAlign: 'center',
  },
});
