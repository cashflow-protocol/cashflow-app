import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import BottomSheet from './BottomSheet';
import { logTelegramCodeCopy, logTelegramBotOpen, logTelegramSheetOpen } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

interface ConnectTelegramSheetProps {
  visible: boolean;
  onClose: () => void;
  code: string;
  botUrl: string;
}

export default function ConnectTelegramSheet({ visible, onClose, code, botUrl }: ConnectTelegramSheetProps) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) logTelegramSheetOpen();
  }, [visible]);

  const handleCopy = () => {
    logTelegramCodeCopy();
    Clipboard.setString(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenBot = () => {
    logTelegramBotOpen();
    const deepLink = `${botUrl}?start=${code}`;
    Linking.openURL(deepLink);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Connect Telegram</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Tap the button below to open our Telegram bot. The code will be sent automatically.
      </Text>

      <View style={[styles.codeBox, { backgroundColor: colors.inputBackground }]}>
        <Text style={[styles.codeText, { color: colors.accentBlue }]}>{code}</Text>
      </View>

      <TouchableOpacity
        style={[styles.copyButton, { backgroundColor: colors.inputBackground }]}
        onPress={handleCopy}
        activeOpacity={0.7}
      >
        <Text style={[styles.copyButtonText, { color: colors.accentBlue }]}>{copied ? 'Copied!' : 'Copy Code'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.accentBlue }]}
        onPress={handleOpenBot}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonText}>Open Telegram Bot</Text>
      </TouchableOpacity>

      <Text style={[styles.hint, { color: colors.textTertiary }]}>
        After connecting, return here and pull to refresh.
      </Text>
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
  codeBox: {
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: 'center',
  },
  codeText: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 8,
  },
  copyButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  copyButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
  },
});
