import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { useWallet } from '../hooks/useWallet';
import ActionButton from '../components/ActionButton';
import AssetItem from '../components/AssetItem';
import SectionCard from '../components/SectionCard';
import StatBox from '../components/StatBox';

export default function NewHomeScreen() {
  const { wallet, balance, connect } = useWallet();

  // Mock data - replace with real data from your backend/blockchain
  const assets = [
    { name: 'SOL', subtitle: 'Solana', amount: '1,000.69', iconColor: '#14F195' },
    { name: 'USDC', subtitle: 'Circle USD', amount: '100', iconColor: '#2775CA' },
    { name: 'LUMEN', subtitle: 'Lumenless', amount: '100,000,000', iconColor: '#9C42FF' },
  ];

  const earnDeposits = [
    { name: 'Deposit', subtitle: 'Jupiter Lend', amount: '1000.69 JupUSD', isPositive: true },
    { name: 'Deposit', subtitle: 'Kamino', amount: '69.00 USDC', isPositive: true },
    { name: 'Deposit', subtitle: 'Kamino', amount: '-69.00 USDC', isPositive: false },
  ];

  const operations = [
    { name: 'Deposit', subtitle: 'Jupiter Lend', amount: '1000.69 JupUSD', isPositive: true },
    { name: 'Deposit', subtitle: 'Kamino', amount: '69.00 USDC', isPositive: true },
    { name: 'Deposit', subtitle: 'Kamino', amount: '-69.00 USDC', isPositive: false },
  ];

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

      {/* Status Bar Area */}
      <SafeAreaView edges={['top']} style={styles.statusBar}>
        <View style={styles.statusBarContent}>
          <TouchableOpacity style={styles.profileIcon}>
            <View style={styles.profileIconPlaceholder} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsIcon}>
            <Text style={styles.settingsIconText}>⚙</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Balance Display */}
      <View style={styles.balanceSection}>
        <Text style={styles.balanceAmount}>$ {balance.toFixed(2)}</Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <ActionButton
          icon={<Text style={styles.actionIcon}>↓</Text>}
          label="Receive"
          onPress={() => console.log('Receive')}
          backgroundColor="#175DA3"
        />
        <ActionButton
          icon={<Text style={styles.actionIcon}>↑</Text>}
          label="Send"
          onPress={() => console.log('Send')}
          backgroundColor="#175DA3"
        />
        <ActionButton
          icon={<Text style={styles.actionIcon}>⇄</Text>}
          label="Convert"
          onPress={() => console.log('Convert')}
          backgroundColor="#175DA3"
        />
        <ActionButton
          icon={<Text style={styles.actionIcon}>+</Text>}
          label="More"
          onPress={() => console.log('More')}
          backgroundColor="#175DA3"
        />
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Assets Section */}
        <SectionCard
          title="Assets"
          onMorePress={() => console.log('More assets')}
        >
          {assets.map((asset, index) => (
            <AssetItem
              key={index}
              name={asset.name}
              subtitle={asset.subtitle}
              amount={asset.amount}
              iconColor={asset.iconColor}
            />
          ))}
        </SectionCard>

        {/* Earn Section */}
        <SectionCard
          title="Earn"
          onMorePress={() => console.log('More earn')}
        >
          <View style={styles.statsRow}>
            <StatBox label="Balance" value="$1,000,000" />
            <StatBox label="APY" value="7.77%" />
            <StatBox label="Annualized" value="$77,000" />
          </View>
          {earnDeposits.map((deposit, index) => (
            <AssetItem
              key={index}
              name={deposit.name}
              subtitle={deposit.subtitle}
              amount={deposit.amount}
              iconColor="#14F195"
              isPositive={deposit.isPositive}
            />
          ))}
        </SectionCard>

        {/* Operations Section */}
        <SectionCard
          title="Operations"
          onMorePress={() => console.log('More operations')}
        >
          {operations.map((op, index) => (
            <AssetItem
              key={index}
              name={op.name}
              subtitle={op.subtitle}
              amount={op.amount}
              iconColor="#14F195"
              isPositive={op.isPositive}
            />
          ))}
        </SectionCard>

        {/* Notification */}
        <View style={styles.notification}>
          <View style={styles.notificationIcon}>
            <Text style={styles.notificationIconText}>🔔</Text>
          </View>
          <View>
            <Text style={styles.notificationTitle}>Some notification</Text>
            <Text style={styles.notificationSubtitle}>Notification</Text>
          </View>
        </View>

        {/* Useful Section */}
        <SectionCard title="Useful">
          <View style={styles.solPrice}>
            <View style={styles.solPriceIcon}>
              <Text style={styles.solPriceIconText}>◎</Text>
            </View>
            <View>
              <Text style={styles.solPriceLabel}>SOL</Text>
              <Text style={styles.solPriceValue}>$125.69</Text>
            </View>
          </View>
          <View style={styles.helpButtons}>
            <TouchableOpacity style={styles.helpButton}>
              <Text style={styles.helpButtonIcon}>💬</Text>
              <Text style={styles.helpButtonText}>Support</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.helpButton}>
              <Text style={styles.helpButtonIcon}>❓</Text>
              <Text style={styles.helpButtonText}>Questions</Text>
            </TouchableOpacity>
          </View>
        </SectionCard>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom Tab Bar */}
      <View style={styles.tabBarContainer}>
        <LinearGradient
          colors={['rgba(165, 165, 165, 0)', 'rgba(165, 165, 165, 0.3)']}
          style={styles.tabBarGlow}
        />
        <View style={styles.tabBar}>
          <TouchableOpacity style={styles.tabItem}>
            <Text style={styles.tabIconActive}>🏠</Text>
            <Text style={styles.tabLabelActive}>Home</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem}>
            <Text style={styles.tabIcon}>💰</Text>
            <Text style={styles.tabLabel}>Earn</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem}>
            <Text style={styles.tabIcon}>💼</Text>
            <Text style={styles.tabLabel}>Assets</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem}>
            <Text style={styles.tabIcon}>⋯</Text>
            <Text style={styles.tabLabel}>More</Text>
          </TouchableOpacity>
        </View>
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
    height: 463,
  },
  statusBar: {
    paddingTop: 0,
  },
  statusBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  profileIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  profileIconPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F95357',
  },
  settingsIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsIconText: {
    fontSize: 20,
    color: '#fff',
  },
  balanceSection: {
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  balanceAmount: {
    fontSize: 48,
    fontWeight: '500',
    color: '#fff',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
    marginTop: -20,
    marginBottom: 20,
  },
  actionIcon: {
    fontSize: 24,
    color: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    gap: 14,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  notification: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#9C42FF',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notificationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#14F195',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationIconText: {
    fontSize: 20,
  },
  notificationTitle: {
    fontSize: 14,
    color: '#000',
  },
  notificationSubtitle: {
    fontSize: 14,
    color: '#808080',
  },
  solPrice: {
    backgroundColor: '#F4F4F4',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  solPriceIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#14F195',
    justifyContent: 'center',
    alignItems: 'center',
  },
  solPriceIconText: {
    fontSize: 20,
    color: '#fff',
  },
  solPriceLabel: {
    fontSize: 14,
    color: '#808080',
  },
  solPriceValue: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  helpButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  helpButton: {
    flex: 1,
    backgroundColor: '#F4F4F4',
    borderRadius: 12,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  helpButtonIcon: {
    fontSize: 16,
  },
  helpButtonText: {
    fontSize: 14,
    color: '#000',
  },
  tabBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 116,
  },
  tabBarGlow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 116,
  },
  tabBar: {
    position: 'absolute',
    bottom: 28,
    left: '50%',
    transform: [{ translateX: -154.5 }],
    width: 309,
    height: 56,
    backgroundColor: '#FDFDFE',
    borderRadius: 28,
    borderWidth: 0.5,
    borderColor: '#EEECEC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 3,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  tabIconActive: {
    fontSize: 20,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 10,
    color: '#B2B2B2',
    fontWeight: '500',
  },
  tabLabelActive: {
    fontSize: 10,
    color: '#F95357',
    fontWeight: '500',
  },
});
