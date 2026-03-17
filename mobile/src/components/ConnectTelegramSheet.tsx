import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import BottomSheet from './BottomSheet';
import { logTelegramCodeCopy, logTelegramBotOpen } from '../services/analyticsService';

interface ConnectTelegramSheetProps {
  visible: boolean;
  onClose: () => void;
  code: string;
  botUrl: string;
}

export default function ConnectTelegramSheet({ visible, onClose, code, botUrl }: ConnectTelegramSheetProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    logTelegramCodeCopy();
    Clipboard.setString(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenBot = () => {
    logTelegramBotOpen();
    // Append ?start=CODE so Telegram auto-sends "/start CODE" to the bot
    const deepLink = `${botUrl}?start=${code}`;
    Linking.openURL(deepLink);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Connect Telegram</Text>
      <Text style={styles.subtitle}>
        Tap the button below to open our Telegram bot. The code will be sent automatically.
      </Text>

      <View style={styles.codeBox}>
        <Text style={styles.codeText}>{code}</Text>
      </View>

      <TouchableOpacity
        style={styles.copyButton}
        onPress={handleCopy}
        activeOpacity={0.7}
      >
        <Text style={styles.copyButtonText}>{copied ? 'Copied!' : 'Copy Code'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.button}
        onPress={handleOpenBot}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonText}>Open Telegram Bot</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        After connecting, return here and pull to refresh.
      </Text>
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
  codeBox: {
    backgroundColor: '#F4F6FC',
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: 'center',
  },
  codeText: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 8,
    color: '#175DA3',
  },
  copyButton: {
    backgroundColor: '#F4F6FC',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  copyButtonText: {
    color: '#175DA3',
    fontSize: 15,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#175DA3',
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
    color: '#999',
    textAlign: 'center',
  },
});
