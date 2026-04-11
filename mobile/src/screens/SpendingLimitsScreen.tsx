import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import { ArrowLeft, Gauge } from 'lucide-react-native';
import BottomSheet from '../components/BottomSheet';
import { getSpendingLimitInfo, updateSpendingLimit, type SpendingLimitInfo } from '../services/squadsService';
import { getVault } from '../services/vaultStorage';
import { logScreenView } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../contexts/ToastContext';

interface SpendingLimitsScreenProps {
  onNavigate: (screen: string) => void;
  onBack: () => void;
}

const LAMPORTS_PER_SOL = 1_000_000_000;
const MIN_LIMIT = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
const MAX_LIMIT = 10 * LAMPORTS_PER_SOL;   // 10 SOL

const PRESET_AMOUNTS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

function lamportsToSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  // Remove trailing zeros
  return sol.toFixed(sol % 1 === 0 ? 0 : sol * 100 % 1 === 0 ? 2 : 4);
}

export default function SpendingLimitsScreen({ onNavigate, onBack }: SpendingLimitsScreenProps) {
  const { colors } = useTheme();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<SpendingLimitInfo | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => { logScreenView('SpendingLimitsScreen'); }, []);

  const fetchInfo = useCallback(async () => {
    try {
      const vault = await getVault();
      if (!vault) return;
      const result = await getSpendingLimitInfo(vault.multisigAddress);
      setInfo(result);
    } catch (err: any) {
      console.warn('[SpendingLimitsScreen] fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const handleUpdate = useCallback(async () => {
    if (!selectedAmount) return;
    setUpdating(true);
    try {
      const vault = await getVault();
      if (!vault) throw new Error('No vault found');
      await updateSpendingLimit(vault.multisigAddress, selectedAmount);
      showToast('Spending limit updated', undefined, 'success');
      setSheetVisible(false);
      setSelectedAmount(null);
      setLoading(true);
      await fetchInfo();
    } catch (err: any) {
      console.error('[SpendingLimitsScreen] update error:', err);
      showToast(err.message || 'Failed to update spending limit', 'error');
    } finally {
      setUpdating(false);
    }
  }, [selectedAmount, fetchInfo, showToast]);

  const openSheet = useCallback(() => {
    if (info) {
      setSelectedAmount(info.amount);
    }
    setSheetVisible(true);
  }, [info]);

  const periodLabel = (period: number) => {
    switch (period) {
      case 0: return 'One-time';
      case 1: return 'Daily';
      case 2: return 'Weekly';
      case 3: return 'Monthly';
      default: return 'Unknown';
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={colors.moreGradient as [string, string]}
        style={[styles.headerGradient, Platform.OS === 'android' && { paddingBottom: 16 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <TouchableOpacity onPress={onBack} style={[styles.backButton, { top: insets.top + 8 }]} activeOpacity={0.7}>
          <ArrowLeft size={24} color="#fff" />
        </TouchableOpacity>
        <SafeAreaView edges={['top']} style={styles.header}>
          <View style={[styles.headerContent, Platform.OS === 'android' && { paddingTop: 4, paddingBottom: 4 }]}>
            <Text style={styles.title}>Spending Limits</Text>
            <Text style={styles.subtitle}>
              Control how much you spend on fees.
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.textSecondary} style={{ marginTop: 40 }} />
        ) : !info?.exists ? (
          <View style={styles.section}>
            <View style={[styles.infoCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                No spending limit configured for this vault.
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/* Current Limit */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Current Limit</Text>

              <View style={[styles.limitCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
                <View style={[styles.limitIconCircle, { backgroundColor: '#E67E22' }]}>
                  <Gauge size={22} color="#fff" />
                </View>
                <View style={styles.limitInfo}>
                  <Text style={[styles.limitAmount, { color: colors.textPrimary }]}>
                    {lamportsToSol(info.amount)} SOL
                  </Text>
                  <Text style={[styles.limitPeriod, { color: colors.textSecondary }]}>
                    {periodLabel(info.period)} limit
                  </Text>
                </View>
              </View>
            </View>

            {/* Remaining */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Remaining Today</Text>

              <View style={[styles.limitCard, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
                <View style={styles.remainingContent}>
                  <Text style={[styles.remainingAmount, { color: colors.textPrimary }]}>
                    {lamportsToSol(info.remainingAmount)} SOL
                  </Text>
                  <View style={[styles.progressBarBg, { backgroundColor: colors.inputBackground }]}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          backgroundColor: info.remainingAmount > 0 ? '#19C394' : colors.accentRed,
                          width: `${info.amount > 0 ? Math.min((info.remainingAmount / info.amount) * 100, 100) : 0}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.remainingDetail, { color: colors.textTertiary }]}>
                    {lamportsToSol(info.remainingAmount)} of {lamportsToSol(info.amount)} SOL remaining
                  </Text>
                </View>
              </View>
            </View>

            {/* Change Button */}
            <View style={styles.section}>
              <TouchableOpacity
                style={[styles.changeButton, { backgroundColor: colors.primaryButton }]}
                onPress={openSheet}
                activeOpacity={0.7}
              >
                <Text style={[styles.changeButtonText, { color: colors.primaryButtonText }]}>
                  Change Spending Limit
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      {/* Amount Selection Bottom Sheet */}
      <BottomSheet visible={sheetVisible} onClose={() => { if (!updating) setSheetVisible(false); }}>
        <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Select Spending Limit</Text>
        <Text style={[styles.sheetDesc, { color: colors.textSecondary }]}>
          Set a daily transaction fee limit for your vault. Once reached, transactions pause until the next day.
        </Text>

        <View style={styles.amountGrid}>
          {PRESET_AMOUNTS.map((sol) => {
            const lamports = sol * LAMPORTS_PER_SOL;
            const isSelected = selectedAmount === lamports;
            return (
              <TouchableOpacity
                key={sol}
                style={[
                  styles.amountPill,
                  { backgroundColor: isSelected ? colors.primaryButton : colors.inputBackground },
                ]}
                onPress={() => setSelectedAmount(lamports)}
                activeOpacity={0.7}
                disabled={updating}
              >
                <Text
                  style={[
                    styles.amountPillText,
                    { color: isSelected ? colors.primaryButtonText : colors.textPrimary },
                  ]}
                >
                  {sol} SOL
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[
            styles.confirmButton,
            {
              backgroundColor: selectedAmount && selectedAmount !== info?.amount
                ? colors.primaryButton
                : colors.disabledButton,
            },
          ]}
          onPress={handleUpdate}
          activeOpacity={0.7}
          disabled={updating || !selectedAmount || selectedAmount === info?.amount}
        >
          {updating ? (
            <ActivityIndicator size="small" color={colors.primaryButtonText} />
          ) : (
            <Text style={[styles.confirmButtonText, { color: colors.primaryButtonText }]}>
              {selectedAmount === info?.amount ? 'Current Limit' : 'Update Limit'}
            </Text>
          )}
        </TouchableOpacity>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerGradient: {
    paddingBottom: 40,
  },
  header: {},
  backButton: {
    position: 'absolute',
    top: 8,
    left: 16,
    zIndex: 1,
    padding: 4,
  },
  headerContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    lineHeight: 18,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  section: {
    paddingHorizontal: 14,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  infoCard: {
    borderRadius: 14,
    padding: 20,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  infoText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  limitCard: {
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  limitIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  limitInfo: {
    flex: 1,
  },
  limitAmount: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  limitPeriod: {
    fontSize: 13,
  },
  remainingContent: {
    flex: 1,
    padding: 4,
  },
  remainingAmount: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  remainingDetail: {
    fontSize: 12,
  },
  changeButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  changeButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  sheetDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  amountGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  amountPill: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    minWidth: 90,
    alignItems: 'center',
  },
  amountPillText: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
