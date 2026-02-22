import React from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { LifetimeEarnedIcon, Last7DIcon, AvgApyIcon } from '../assets/stat-icons';

export default function AssetsScreen() {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <LinearGradient
        colors={['#1E8260', '#19C394']}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.title}>Assets</Text>
        <Text style={styles.totalAmount}>$0.00</Text>
      </SafeAreaView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statsContainer}
        style={styles.statsScroll}
      >
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <LifetimeEarnedIcon size={20} />
            </View>
            <View>
              <Text style={styles.statLabel}>Net worth</Text>
              <Text style={styles.statValue}>$0.00</Text>
            </View>
          </View>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <Last7DIcon size={20} />
            </View>
            <View>
              <Text style={styles.statLabel}>24h change</Text>
              <Text style={styles.statValue}>$0.00</Text>
            </View>
          </View>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <View style={styles.statIconCircle}>
              <AvgApyIcon size={20} />
            </View>
            <View>
              <Text style={styles.statLabel}>Total PnL</Text>
              <Text style={styles.statValue}>$0.00</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.content}>
        <Text style={styles.placeholder}>Coming soon</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8EAF1',
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  header: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
  },
  totalAmount: {
    fontSize: 44,
    fontWeight: '700',
    color: '#fff',
  },
  statsScroll: {
    maxHeight: 70,
    marginTop: 16,
    marginBottom: 12,
  },
  statsContainer: {
    paddingHorizontal: 14,
    gap: 10,
  },
  statCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minWidth: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#19C394',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 13,
    color: '#6B7B8D',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6B7B8D',
  },
});
