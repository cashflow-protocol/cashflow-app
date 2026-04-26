import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Linking,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';

function ChatIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 11.5C21.0034 12.8199 20.6951 14.1219 20.1 15.3C19.3944 16.7118 18.3098 17.8992 16.9674 18.7293C15.6251 19.5594 14.0782 19.9994 12.5 20C11.1801 20.0035 9.87812 19.6951 8.7 19.1L3 21L4.9 15.3C4.30493 14.1219 3.99656 12.8199 4 11.5C4.00061 9.92179 4.44061 8.37488 5.27072 7.03258C6.10083 5.69028 7.28825 4.6056 8.7 3.90003C9.87812 3.30496 11.1801 2.99659 12.5 3.00003H13C15.0843 3.11502 17.053 3.99479 18.5291 5.47089C20.0052 6.94699 20.885 8.91568 21 11V11.5Z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function TelegramIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22 2L11 13"
        stroke="#229ED9"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M22 2L15 22L11 13L2 9L22 2Z"
        stroke="#229ED9"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function EmailIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z"
        stroke="#F95357"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M22 6L12 13L2 6"
        stroke="#F95357"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function ContactFloatingButton() {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  const open = () => {
    setVisible(true);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        damping: 15,
        stiffness: 200,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const close = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => setVisible(false));
  };

  const openTelegram = () => {
    close();
    Linking.openURL('https://t.me/mike_cashflow');
  };

  const openEmail = () => {
    close();
    Linking.openURL('mailto:mike@cashflow.fun');
  };

  const openNews = () => {
    close();
    Linking.openURL('https://t.me/cashflow_fi');
  };

  const openCommunity = () => {
    close();
    Linking.openURL('https://t.me/+bF-piLXZ7o40NWYy');
  };

  return (
    <>
      <TouchableOpacity
        style={styles.fab}
        onPress={open}
        activeOpacity={0.8}
      >
        <ChatIcon color="rgba(255, 255, 255, 0.85)" />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={styles.modalContainer}>
          <Animated.View style={[styles.overlay, { opacity: fadeAnim, backgroundColor: colors.overlay }]}>
            <TouchableOpacity style={styles.overlayTouchable} activeOpacity={1} onPress={close} />
          </Animated.View>

          <Animated.View
            style={[
              styles.popup,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            <Text style={[styles.popupTitle, { color: colors.textPrimary }]}>Contact us</Text>

            <TouchableOpacity style={[styles.popupOption, { backgroundColor: colors.cardSecondary }]} onPress={openTelegram}>
              <TelegramIcon />
              <View style={styles.popupOptionText}>
                <Text style={[styles.popupOptionLabel, { color: colors.textPrimary }]}>Telegram</Text>
                <Text style={[styles.popupOptionValue, { color: colors.textSecondary }]}>@mike_cashflow</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.popupOption, { backgroundColor: colors.cardSecondary }]} onPress={openNews}>
              <TelegramIcon />
              <View style={styles.popupOptionText}>
                <Text style={[styles.popupOptionLabel, { color: colors.textPrimary }]}>News</Text>
                <Text style={[styles.popupOptionValue, { color: colors.textSecondary }]}>@cashflow_fi</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.popupOption, { backgroundColor: colors.cardSecondary }]} onPress={openCommunity}>
              <TelegramIcon />
              <View style={styles.popupOptionText}>
                <Text style={[styles.popupOptionLabel, { color: colors.textPrimary }]}>Community</Text>
                <Text style={[styles.popupOptionValue, { color: colors.textSecondary }]}>Join the community</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.popupOption, { backgroundColor: colors.cardSecondary }]} onPress={openEmail}>
              <EmailIcon />
              <View style={styles.popupOptionText}>
                <Text style={[styles.popupOptionLabel, { color: colors.textPrimary }]}>Email</Text>
                <Text style={[styles.popupOptionValue, { color: colors.textSecondary }]}>mike@cashflow.fun</Text>
              </View>
            </TouchableOpacity>

          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    top: 70,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContainer: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  overlayTouchable: {
    flex: 1,
  },
  popup: {
    position: 'absolute',
    top: 120,
    right: 20,
    width: 240,
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 16,
    gap: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  popupTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  popupOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 12,
  },
  popupOptionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  popupOptionValue: {
    fontSize: 12,
    marginTop: 1,
  },
  popupOptionText: {
    flex: 1,
  },
});
