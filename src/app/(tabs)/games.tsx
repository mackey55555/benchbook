import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { listGames, todayString } from '@/db/repo';
import {
  DATE_RANGE_LABELS,
  NO_FILTER,
  filterGames,
  type DateRange,
  type GameFilter,
  type GameResult,
} from '@/domain/analysis';
import { Button, Chip, Row, styles as ui } from '@/ui/components';
import { GameRow } from '@/ui/GameRow';
import { Text } from '@/ui/Text';
import { colors } from '@/ui/theme';
import { useRefresh } from '@/ui/useGame';

/** 一度に出す件数。最下部の「さらに読み込む」で同じ数ずつ増やす */
const PAGE_SIZE = 20;

const RANGES = Object.keys(DATE_RANGE_LABELS) as DateRange[];
const RESULTS: { value: 'all' | GameResult; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'win', label: '勝ち' },
  { value: 'lose', label: '負け' },
  { value: 'draw', label: '引分' },
];

export default function GamesScreen() {
  const insets = useSafeAreaInsets();
  const [version, refresh] = useRefresh();
  const [filter, setFilter] = useState<GameFilter>(NO_FILTER);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  const all = useMemo(() => listGames(db), [version]);
  const matched = useMemo(() => filterGames(all, filter, todayString()), [all, filter]);
  const shown = matched.slice(0, limit);
  const filtered = filter.range !== 'all' || filter.result !== 'all' || filter.query.trim() !== '';

  // 条件を変えたら、表示件数は最初の1ページに戻す
  const change = (patch: Partial<GameFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(PAGE_SIZE);
  };

  const header = (
    <View style={styles.head}>
      <Text style={styles.title}>試合</Text>
      <TextInput
        value={filter.query}
        onChangeText={(query) => change({ query })}
        placeholder="チーム名・大会名でさがす"
        placeholderTextColor={colors.sub}
        accessibilityLabel="チーム名・大会名でさがす"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={ui.input}
      />
      <Row>
        <Text style={styles.label}>期間</Text>
        {RANGES.map((r) => (
          <Chip key={r} label={DATE_RANGE_LABELS[r]} active={filter.range === r} onPress={() => change({ range: r })} />
        ))}
      </Row>
      <Row>
        <Text style={styles.label}>勝敗</Text>
        {RESULTS.map((r) => (
          <Chip key={r.value} label={r.label} active={filter.result === r.value} onPress={() => change({ result: r.value })} />
        ))}
      </Row>
      <View style={styles.countRow}>
        <Text style={styles.count}>
          {matched.length}件{filtered ? `（全${all.length}件）` : ''}
        </Text>
        {all.length > 0 && <Text style={styles.count}>長押しで削除</Text>}
      </View>
    </View>
  );

  return (
    <FlatList
      data={shown}
      keyExtractor={(row) => row.game.id}
      renderItem={({ item }) => <GameRow row={item} onChanged={refresh} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Text style={styles.empty}>
          {all.length === 0 ? 'まだ試合がありません' : '条件に合う試合がありません'}
        </Text>
      }
      ListFooterComponent={
        matched.length > shown.length ? (
          <Button
            title={`さらに読み込む（残り${matched.length - shown.length}件）`}
            variant="secondary"
            onPress={() => setLimit((n) => n + PAGE_SIZE)}
          />
        ) : undefined
      }
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 10, paddingBottom: 32 },
  head: { gap: 10 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  label: { width: 34, fontSize: 12, fontWeight: '700', color: colors.sub },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  count: { fontSize: 12, color: colors.sub },
  empty: { color: colors.sub, fontSize: 14, paddingVertical: 12 },
});
