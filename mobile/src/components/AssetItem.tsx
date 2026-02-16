import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';

interface AssetItemProps {
  name: string;
  subtitle: string;
  amount: string;
  iconUrl?: string;
  iconColor?: string;
  isPositive?: boolean;
}

export default function AssetItem({
  name,
  subtitle,
  amount,
  iconUrl,
  iconColor = '#14F195',
  isPositive = true
}: AssetItemProps) {
  return (
    <View style={styles.container}>
      <View style={styles.leftSection}>
        <View style={[styles.iconContainer, { backgroundColor: iconColor }]}>
          {iconUrl && (
            <Image
              source={{ uri: iconUrl }}
              style={styles.icon}
              resizeMode="contain"
            />
          )}
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      <Text style={[
        styles.amount,
        { color: isPositive ? '#138001' : '#000' }
      ]}>
        {isPositive && !amount.startsWith('-') ? '' : ''}{amount}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    width: 24,
    height: 24,
  },
  textContainer: {
    justifyContent: 'center',
  },
  name: {
    fontSize: 14,
    color: '#000',
    fontWeight: '400',
  },
  subtitle: {
    fontSize: 14,
    color: '#808080',
  },
  amount: {
    fontSize: 20,
    fontWeight: '400',
  },
});
