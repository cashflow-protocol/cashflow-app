import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface ActionButtonProps {
  icon: any;
  label: string;
  onPress: () => void;
  backgroundColor?: string;
}

export default function ActionButton({
  icon,
  label,
  onPress,
  backgroundColor = '#171D26'
}: ActionButtonProps) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity style={styles.container} onPress={onPress}>
      <View style={[styles.iconContainer, { backgroundColor }]}>
        {typeof icon === 'string' ? (
          <Image source={{ uri: icon }} style={styles.icon} />
        ) : (
          icon
        )}
      </View>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 8,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  icon: {
    width: 32,
    height: 32,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
});
