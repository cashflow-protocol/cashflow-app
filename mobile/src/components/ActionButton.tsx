import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';

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
  backgroundColor = '#175DA3'
}: ActionButtonProps) {
  return (
    <TouchableOpacity style={styles.container} onPress={onPress}>
      <View style={[styles.iconContainer, { backgroundColor }]}>
        {typeof icon === 'string' ? (
          <Image source={{ uri: icon }} style={styles.icon} />
        ) : (
          icon
        )}
      </View>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 6,
  },
  iconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    width: 32,
    height: 32,
  },
  label: {
    fontSize: 12,
    color: '#000',
    fontWeight: '400',
  },
});
