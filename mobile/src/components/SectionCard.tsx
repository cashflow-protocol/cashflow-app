import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface SectionCardProps {
  title: string;
  children: React.ReactNode;
  onMorePress?: () => void;
  height?: number;
}

export default function SectionCard({
  title,
  children,
  onMorePress,
  height
}: SectionCardProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.card }, height ? { height } : {}]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {onMorePress && (
          <TouchableOpacity
            style={[styles.moreButton, { backgroundColor: colors.moreButtonBg }]}
            onPress={onMorePress}
          >
            <Text style={[styles.moreText, { color: colors.moreButtonText }]}>More</Text>
            <Text style={[styles.arrow, { color: colors.moreButtonText }]}>›</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.content}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  moreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 3,
  },
  moreText: {
    fontSize: 14,
    fontWeight: '500',
  },
  arrow: {
    fontSize: 16,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 16,
  },
});
