import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

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
  return (
    <View style={[styles.container, height ? { height } : {}]}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {onMorePress && (
          <TouchableOpacity
            style={styles.moreButton}
            onPress={onMorePress}
          >
            <Text style={styles.moreText}>More</Text>
            <Text style={styles.arrow}>›</Text>
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
    backgroundColor: '#fff',
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
    color: '#000',
  },
  moreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E9EDF4',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 3,
  },
  moreText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#294E90',
  },
  arrow: {
    fontSize: 16,
    color: '#294E90',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 16,
  },
});
