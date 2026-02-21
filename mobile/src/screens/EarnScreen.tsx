import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { useEarnTokens } from '../hooks/useEarnTokens';
import EarnTokenItem from '../components/EarnTokenItem';

export default function EarnScreen() {
  const { tokens, loading, error, refresh } = useEarnTokens();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header Gradient */}
      <LinearGradient
        colors={['#175DA3', '#347AC0', '#8EB2D8', '#E8EAF1']}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.title}>Earn</Text>
        <Text style={styles.subtitle}>
          Deposit stablecoins into DeFi protocols and earn yield
        </Text>
      </SafeAreaView>

      {/* Content */}
      <View style={styles.content}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#175DA3" />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={refresh}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={tokens}
            keyExtractor={(item) => `${item.type}:${item.mint}${item.vaultAddress ? `:${item.vaultAddress}` : ''}`}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onRefresh={refresh}
            refreshing={loading}
            renderItem={({ item }) => (
              <EarnTokenItem
                type={item.type}
                mint={item.mint}
                symbol={item.symbol}
                vaultTitle={item.vaultTitle}
                logoUrl={item.logoUrl}
                rewardsRate={item.rewardsRate}
                positionAmount={item.position?.balance.uiAmount}
                onPress={() => console.log('Token pressed:', item.vaultTitle)}
              />
            )}
            ListEmptyComponent={
              <View style={styles.centered}>
                <Text style={styles.emptyText}>No earn opportunities available</Text>
              </View>
            }
          />
        )}
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
    height: 200,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  content: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 120,
    gap: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  errorText: {
    fontSize: 15,
    color: '#F95357',
    marginBottom: 12,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#175DA3',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  emptyText: {
    fontSize: 15,
    color: '#808080',
  },
});
