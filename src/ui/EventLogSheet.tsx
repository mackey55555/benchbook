import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { TEAM_EVENT_TYPES, replaceEvent, voidEvent, type GameBundle } from '@/db/repo';
import { activeEvents, compareNumbers, periodLabel } from '@/domain/rules';
import { EVENT_LABELS, describeEvent } from '@/domain/stats';
import {
  BENCH_FOUL_KINDS,
  PLAYER_FOUL_KINDS,
  type EventType,
  type FoulKind,
  type GameEvent,
  type Side,
} from '@/domain/types';

import { Button, Chip, Row, SectionTitle, Segmented } from './components';
import { Text } from './Text';
import { colors, sideColor } from './theme';
import { attempt } from './useGame';
import { DialogHost, showDialog } from './dialog';

const EDITABLE_TYPES: EventType[] = [
  'FG2_MADE',
  'FG2_MISS',
  'FG3_MADE',
  'FG3_MISS',
  'FT_MADE',
  'FT_MISS',
  'OREB',
  'DREB',
  'AST',
  'STL',
  'BLK',
  'TOV',
  'FOUL',
];

/** ファウルの種類ごとの既定FT数（シートで変更できる） */
export const DEFAULT_FT: Record<FoulKind, number> = { P: 0, T: 1, U: 2, D: 2, C: 1, B: 1 };

interface Draft {
  side: Side;
  /** undefined = 未選択、null = チーム（TOV・リバウンド）／ベンチ（ファウル） */
  rosterId: string | null | undefined;
  type: EventType;
  foulKind: FoulKind;
  ftAwarded: number;
}

/**
 * 全ログシート。選手・種類の修正（void＋同じ order_key で再挿入）と削除（void）ができる。
 * period を渡すと、そのQのイベントだけに絞り込んで開く。
 */
export function EventLogSheet(props: {
  visible: boolean;
  bundle: GameBundle;
  period?: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { visible, bundle, period, onClose, onChanged } = props;
  const [filter, setFilter] = useState<number | 'all'>(period ?? 'all');
  const [editing, setEditing] = useState<GameEvent | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  // 開くたびに絞り込みと編集状態を初期化する
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setFilter(period ?? 'all');
      setEditing(null);
    }
  }

  const events = useMemo(
    () =>
      activeEvents(bundle.events)
        .filter((e) => e.type !== 'L2M' && (filter === 'all' || e.period === filter))
        .reverse(),
    [bundle.events, filter],
  );
  const periods = useMemo(() => {
    const max = Math.max(bundle.game.currentPeriod, ...bundle.events.map((e) => e.period));
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [bundle]);

  const startEdit = (e: GameEvent) => {
    setEditing(e);
    setDraft({
      side: e.side ?? 'A',
      rosterId: e.rosterId,
      type: e.type,
      foulKind: e.foulKind ?? 'P',
      ftAwarded: e.ftAwarded ?? 0,
    });
  };

  const save = () => {
    if (!editing || !draft || draft.rosterId === undefined) return;
    const { rosterId } = draft;
    const ok = attempt(() =>
      replaceEvent(db, editing.id, {
        side: draft.side,
        rosterId,
        type: draft.type,
        foulKind: draft.type === 'FOUL' ? draft.foulKind : null,
        ftAwarded: draft.type === 'FOUL' ? draft.ftAwarded : null,
      }),
    );
    onChanged();
    if (ok) setEditing(null);
  };

  const remove = (e: GameEvent) =>
    showDialog('記録を削除', `「${describeEvent(e, bundle.roster)}」を削除します。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: () => {
          voidEvent(db, e.id);
          onChanged();
        },
      },
    ]);

  const editor = () => {
    if (!editing || !draft) return null;
    const isBench = draft.rosterId === null;
    const kinds: readonly FoulKind[] = isBench ? BENCH_FOUL_KINDS : PLAYER_FOUL_KINDS;
    const players = bundle.roster
      .filter((r) => r.side === draft.side)
      .sort((a, b) => compareNumbers(a.number, b.number));
    const update = (patch: Partial<Draft>) => {
      const next = { ...draft, ...patch };
      // チーム・ベンチで記録できるのは、チームのTOV・リバウンドと、ベンチのファウル（C/B）だけ
      if (next.rosterId === null) {
        if (next.type !== 'FOUL' && !TEAM_EVENT_TYPES.includes(next.type)) next.type = 'FOUL';
        if (next.foulKind !== 'C' && next.foulKind !== 'B') {
          next.foulKind = 'C';
          next.ftAwarded = DEFAULT_FT.C;
        }
      } else if (next.foulKind === 'C' || next.foulKind === 'B') {
        next.foulKind = 'P';
        next.ftAwarded = DEFAULT_FT.P;
      }
      setDraft(next);
    };
    return (
      <ScrollView contentContainerStyle={styles.editor}>
        <Text style={styles.editTitle}>
          修正：{periodLabel(editing.period)}　{describeEvent(editing, bundle.roster)}
        </Text>
        <SectionTitle>チーム</SectionTitle>
        <Segmented
          options={[
            { value: 'A', label: `A ${bundle.game.teamAName}` },
            { value: 'B', label: `B ${bundle.game.teamBName}` },
          ]}
          value={draft.side}
          onChange={(side) => update({ side, rosterId: side === draft.side ? draft.rosterId : undefined })}
        />
        <SectionTitle>選手</SectionTitle>
        <View style={styles.wrap}>
          {players.map((r) => (
            <Chip
              key={r.id}
              label={r.number}
              active={draft.rosterId === r.id}
              color={sideColor(draft.side)}
              onPress={() => update({ rosterId: r.id })}
            />
          ))}
          <Chip
            label="チーム・ベンチ"
            active={isBench}
            color={sideColor(draft.side)}
            onPress={() => update({ rosterId: null })}
          />
        </View>
        <SectionTitle>種類</SectionTitle>
        <View style={styles.wrap}>
          {EDITABLE_TYPES.map((t) => (
            <Chip
              key={t}
              label={EVENT_LABELS[t]}
              active={draft.type === t}
              disabled={isBench && t !== 'FOUL' && !TEAM_EVENT_TYPES.includes(t)}
              onPress={() => update({ type: t })}
            />
          ))}
        </View>
        {draft.type === 'FOUL' && (
          <>
            <SectionTitle>ファウルの種類</SectionTitle>
            <View style={styles.wrap}>
              {kinds.map((k) => (
                <Chip
                  key={k}
                  label={k}
                  active={draft.foulKind === k}
                  color={colors.danger}
                  onPress={() => update({ foulKind: k, ftAwarded: DEFAULT_FT[k] })}
                />
              ))}
            </View>
            <SectionTitle>与えたFT数</SectionTitle>
            <View style={styles.wrap}>
              {[0, 1, 2, 3].map((n) => (
                <Chip
                  key={n}
                  label={String(n)}
                  active={draft.ftAwarded === n}
                  onPress={() => update({ ftAwarded: n })}
                />
              ))}
            </View>
          </>
        )}
        <Row style={styles.editButtons}>
          <Button title="キャンセル" variant="secondary" onPress={() => setEditing(null)} style={styles.flex} />
          <Button title="保存" onPress={save} disabled={draft.rosterId === undefined} style={styles.flex} />
        </Row>
      </ScrollView>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <Row style={styles.header}>
            <Text style={styles.title}>記録ログ</Text>
            <View style={styles.flex} />
            <Button title="閉じる" small onPress={onClose} />
          </Row>
          {editing ? (
            editor()
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
                <Row>
                  <Chip label="すべて" active={filter === 'all'} onPress={() => setFilter('all')} />
                  {periods.map((p) => (
                    <Chip key={p} label={periodLabel(p)} active={filter === p} onPress={() => setFilter(p)} />
                  ))}
                </Row>
              </ScrollView>
              <ScrollView contentContainerStyle={styles.list}>
                {events.length === 0 && <Text style={styles.empty}>記録がありません</Text>}
                {events.map((e) =>
                  e.type === 'PERIOD_END' ? (
                    <Text key={e.id} style={styles.divider}>
                      ── {periodLabel(e.period)} 終了 ──
                    </Text>
                  ) : e.type === 'MARK' ? (
                    <Row key={e.id} style={[styles.item, styles.mark]}>
                      <Text style={styles.period}>{periodLabel(e.period)}</Text>
                      <Ionicons name="flag" size={16} color={colors.accentText} />
                      <Text style={[styles.desc, styles.markText]} numberOfLines={1}>
                        {describeEvent(e, bundle.roster)}
                      </Text>
                      <Button
                        title="印を外す"
                        variant="ghost"
                        small
                        onPress={() => {
                          voidEvent(db, e.id);
                          onChanged();
                        }}
                      />
                    </Row>
                  ) : (
                    <Row key={e.id} style={styles.item}>
                      <Text style={styles.period}>{periodLabel(e.period)}</Text>
                      <Text
                        style={[styles.desc, e.side && { color: sideColor(e.side) }]}
                        numberOfLines={1}
                      >
                        {describeEvent(e, bundle.roster)}
                      </Text>
                      {e.type !== 'TIMEOUT' && e.type !== 'SUB_IN' && e.type !== 'SUB_OUT' && (
                        <Button title="修正" variant="secondary" small onPress={() => startEdit(e)} />
                      )}
                      <Button title="削除" variant="ghost" small onPress={() => remove(e)} />
                    </Row>
                  ),
                )}
              </ScrollView>
            </>
          )}
        </SafeAreaView>
        <DialogHost />
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 8 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  filters: { flexGrow: 0, paddingHorizontal: 16, marginBottom: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 6 },
  empty: { color: colors.sub, paddingVertical: 16 },
  divider: { textAlign: 'center', color: colors.sub, fontSize: 12, paddingVertical: 6 },
  item: {
    minHeight: 48,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  // 「要確認」の印。前後の記録を見直す目印なので、ほかの行より目立たせる
  mark: { backgroundColor: colors.accentBg, borderColor: colors.accent, borderWidth: 2, gap: 6 },
  markText: { color: colors.accentText },
  period: { width: 36, fontSize: 12, color: colors.sub, fontWeight: '700' },
  desc: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  editor: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  editTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editButtons: { marginTop: 12 },
});
