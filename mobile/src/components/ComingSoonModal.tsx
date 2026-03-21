import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import BottomSheet from './BottomSheet';
import { useTheme } from '../theme/ThemeContext';

interface ComingSoonModalProps {
  visible: boolean;
  onClose: () => void;
  icon?: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export default function ComingSoonModal({
  visible,
  onClose,
  icon,
  title = 'Coming soon',
  subtitle = 'This feature is under development and will be available soon.',
}: ComingSoonModalProps) {
  const { colors } = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.content}>
        {icon && (
          <View style={[styles.iconContainer, { backgroundColor: colors.infoBackground }]}>
            {icon}
          </View>
        )}

        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>

        <TouchableOpacity
          style={[styles.closeButton, { backgroundColor: colors.primaryButton }]}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Text style={[styles.closeButtonText, { color: colors.primaryButtonText }]}>Got it</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    gap: 16,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  closeButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
  },
  closeButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
