import React, { useMemo } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useRewards } from '../hooks/useRewards';
import RewardBadgeCard from './RewardBadgeCard';
import ActivateCashflowIdCard from './ActivateCashflowIdCard';
import type { TaskWithProgress } from '../types/rewards';

interface Props {
  onSelectTask?: (task: TaskWithProgress) => void;
}

export default function RewardsHomeSection({ onSelectTask }: Props) {
  const { colors } = useTheme();
  const { tasks, cashflowId, loading } = useRewards();

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

  // Section is hidden only when there are no tasks AND no activation state to show.
  if (!loading && ordered.length === 0 && cashflowId.activated) return null;

  return (
    <View style={styles.container}>
      {!cashflowId.activated && !loading && (
        <ActivateCashflowIdCard feeLamports={cashflowId.feeLamports} />
      )}
      {loading ? (
        <ActivityIndicator size="small" color={colors.accentBlueDark} style={styles.loader} />
      ) : ordered.length > 0 ? (
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  listWrapper: {
    marginHorizontal: -14,
  },
  listContent: {
    paddingHorizontal: 14,
  },
  loader: {
    marginVertical: 24,
  },
});
