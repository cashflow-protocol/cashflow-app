import React, { useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useRewards } from '../hooks/useRewards';
import RewardBadgeCard from './RewardBadgeCard';
import type { TaskWithProgress } from '../types/rewards';

interface Props {
  onSelectTask?: (task: TaskWithProgress) => void;
}

export default function RewardsHomeSection({ onSelectTask }: Props) {
  const { colors } = useTheme();
  const { tasks, loading } = useRewards();

  // Sort: claimable first, then in_progress, then mint_pending, then minted; tie-break by sortOrder.
  const ordered = useMemo(() => {
    const rank: Record<string, number> = {
      claimable: 0,
      mint_pending: 1,
      in_progress: 2,
      minted: 3,
    };
    return [...tasks].sort((a, b) => {
      const r = (rank[a.status] ?? 4) - (rank[b.status] ?? 4);
      if (r !== 0) return r;
      return a.sortOrder - b.sortOrder;
    });
  }, [tasks]);

  const claimableCount = ordered.filter((t) => t.status === 'claimable').length;

  if (!loading && ordered.length === 0) return null;

  return (
    <View style={styles.container}>
      {claimableCount > 0 && (
        <View style={styles.header}>
          <View style={[styles.claimablePill, { backgroundColor: colors.accentGreen }]}>
            <Text style={styles.claimablePillText}>
              {claimableCount} claimable
            </Text>
          </View>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="small" color={colors.accentBlueDark} style={styles.loader} />
      ) : (
        <View style={styles.listWrapper}>
          <FlatList
            horizontal
            data={ordered}
            keyExtractor={(t) => t.slug}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            renderItem={({ item }) => (
              <RewardBadgeCard task={item} onPress={() => onSelectTask?.(item)} />
            )}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  listWrapper: {
    marginHorizontal: -14,
  },
  claimablePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  claimablePillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 14,
  },
  loader: {
    marginVertical: 24,
  },
});
