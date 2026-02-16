import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StatBoxProps {
  label: string;
  value: string;
}

export default function StatBox({ label, value }: StatBoxProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: 60,
    backgroundColor: '#F4F4F4',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    color: '#808080',
    marginBottom: 4,
  },
  value: {
    fontSize: 14,
    color: '#000',
    fontWeight: '400',
  },
});
