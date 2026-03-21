import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface StatBoxProps {
  label: string;
  value: string;
}

export default function StatBox({ label, value }: StatBoxProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.cardSecondary }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: 60,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    marginBottom: 4,
  },
  value: {
    fontSize: 14,
    fontWeight: '400',
  },
});
