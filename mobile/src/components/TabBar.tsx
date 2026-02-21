import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';

export type TabName = 'home' | 'earn' | 'assets' | 'more';

const TABS: { key: TabName; icon: string; label: string }[] = [
  { key: 'home', icon: '\u{1F3E0}', label: 'Home' },
  { key: 'earn', icon: '\u{1F4B0}', label: 'Earn' },
  { key: 'assets', icon: '\u{1F4BC}', label: 'Assets' },
  { key: 'more', icon: '\u22EF', label: 'More' },
];

interface TabBarProps {
  activeTab: TabName;
  onTabPress: (tab: TabName) => void;
}

export default function TabBar({ activeTab, onTabPress }: TabBarProps) {
  return (
    <View style={styles.tabBarContainer}>
      <LinearGradient
        colors={['rgba(165, 165, 165, 0)', 'rgba(165, 165, 165, 0.3)']}
        style={styles.tabBarGlow}
      />
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              onPress={() => onTabPress(tab.key)}
            >
              <Text style={isActive ? styles.tabIconActive : styles.tabIcon}>
                {tab.icon}
              </Text>
              <Text style={isActive ? styles.tabLabelActive : styles.tabLabel}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
