import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from 'react-native';
import BottomSheet from './BottomSheet';

interface ConnectTelegramSheetProps {
  visible: boolean;
  onClose: () => void;
  code: string;
  botUrl: string;
}

export default function ConnectTelegramSheet({ visible, onClose, code, botUrl }: ConnectTelegramSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Connect Telegram</Text>
      <Text style={styles.subtitle}>
        Send this code to our Telegram bot to verify your account.
      </Text>

      <View style={styles.codeBox}>
        <Text style={styles.codeText}>{code}</Text>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={() => Linking.openURL(botUrl)}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonText}>Open Telegram Bot</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        After sending the code, return here and pull to refresh.
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
