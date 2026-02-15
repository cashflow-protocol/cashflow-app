import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useWallet } from '../hooks/useWallet';

export default function HomeScreen() {
  const { wallet, isConnecting, balance, connect, disconnect, refreshBalance } = useWallet();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.content}>
        <Text style={styles.title}>Cashflow</Text>
        <Text style={styles.subtitle}>Solana Yield Generation</Text>

        {wallet ? (
          <View style={styles.walletInfo}>
            <Text style={styles.label}>Connected Wallet</Text>
            <Text style={styles.address}>
              {wallet.publicKey.toString().slice(0, 4)}...
              {wallet.publicKey.toString().slice(-4)}
            </Text>

            <View style={styles.balanceContainer}>
              <Text style={styles.balanceLabel}>Balance</Text>
              <Text style={styles.balance}>{balance.toFixed(4)} SOL</Text>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={refreshBalance}
              >
                <Text style={styles.refreshButtonText}>Refresh</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, styles.disconnectButton]}
              onPress={disconnect}
            >
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.connectContainer}>
            <Text style={styles.description}>
              Connect your Solana wallet to start earning yield
            </Text>
            <TouchableOpacity
              style={styles.button}
              onPress={connect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Connect Wallet</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#888',
    marginBottom: 40,
  },
  connectContainer: {
    width: '100%',
    alignItems: 'center',
  },
  description: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  button: {
    backgroundColor: '#9945FF',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
  },
  disconnectButton: {
    backgroundColor: '#333',
    marginTop: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  walletInfo: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  address: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 32,
  },
  balanceContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  balance: {
    fontSize: 36,
    color: '#14F195',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  refreshButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  refreshButtonText: {
    color: '#9945FF',
    fontSize: 14,
    fontWeight: '600',
  },
});
