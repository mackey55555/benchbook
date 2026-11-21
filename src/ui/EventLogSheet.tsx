import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import {
  TEAM_EVENT_TYPES,
  addEvent,
  insertEvent,
  insertPeriod,
  replaceEvent,
  setEventClock,
  voidEvent,
  type GameBundle,
  type InsertPosition,
} from '@/db/repo';
import { clockDigitsLabel, parseClockDigits, periodSeconds } from '@/domain/lineup';
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
  /** 残り時間のテンキー入力（"632" → 6:32、空は時刻なし） */
  clock: string;
}

/**
 * 編集シートの用途。
 * - edit：記録の内容と残り時間を直す
 * - time：残り時間だけを直す（タイムアウト・交代）
 * - insert：付け忘れた記録を、選んだ場所に足す（at が null のときは末尾に足す）
 */
type Target =
  | { kind: 'edit'; event: GameEvent }
  | { kind: 'time'; event: GameEvent }
  | { kind: 'insert'; at: InsertPosition | null; period: number };

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'];
const isSub = (e: GameEvent) => e.type === 'SUB_IN' || e.type === 'SUB_OUT';
const clockDigits = (seconds: number | null) =>
  seconds === null ? '' : `${Math.floor(seconds / 60)}${String(seconds % 60).padStart(2, '0')}`.replace(/^0+(?=\d)/, '');

/**
 * 全ログシート。選手・種類・残り時間の修正（void＋同じ order_key で再挿入）、削除（void）、
 * 付け忘れた記録の途中への追加ができる。
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
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** 追加する場所を選んでいる */
  const [placing, setPlacing] = useState(false);

  // 開くたびに絞り込みと編集状態を初期化する
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setFilter(period ?? 'all');
      setTarget(null);
      setPlacing(false);
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

  const startEdit = (e: GameEvent, kind: 'edit' | 'time') => {
    setTarget({ kind, event: e });
    setDraft({
      side: e.side ?? 'A',
      rosterId: e.rosterId,
      type: e.type,
      foulKind: e.foulKind ?? 'P',
      ftAwarded: e.ftAwarded ?? 0,
      clock: clockDigits(e.clockSeconds),
    });
  };

  const startInsert = (at: InsertPosition | null, insertInto: number) => {
    setPlacing(false);
    setTarget({ kind: 'insert', at, period: insertInto });
    setDraft({ side: 'A', rosterId: undefined, type: 'FG2_MADE', foulKind: 'P', ftAwarded: 0, clock: '' });
  };

  const targetPeriod = target ? (target.kind === 'insert' ? target.period : target.event.period) : 1;
  const clockSeconds = draft ? parseClockDigits(draft.clock, periodSeconds(targetPeriod, bundle.game)) : null;

  const save = () => {
    if (!target || !draft || clockSeconds === undefined) return;
    if (target.kind !== 'time' && draft.rosterId === undefined) return;
    const { rosterId } = draft;
    const content = {
      side: draft.side,
      rosterId: rosterId ?? null,
      type: draft.type,
      foulKind: draft.type === 'FOUL' ? draft.foulKind : null,
      ftAwarded: draft.type === 'FOUL' ? draft.ftAwarded : null,
      clockSeconds,
    };
    const ok = attempt(() => {
      if (target.kind === 'time') setEventClock(db, target.event.id, clockSeconds);
      else if (target.kind === 'edit') replaceEvent(db, target.event.id, content);
      else if (target.at) insertEvent(db, { gameId: bundle.game.id, ...content }, target.at);
      else addEvent(db, { gameId: bundle.game.id, period: target.period, ...content });
    });
    onChanged();
    if (ok) setTarget(null);
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
    if (!target || !draft) return null;
    const full = target.kind !== 'time';
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
          {target.kind === 'insert'
            ? `追加：${periodLabel(target.period)} の記録`
            : `${full ? '修正' : '時間の修正'}：${periodLabel(target.event.period)}　${describeEvent(target.event, bundle.roster)}`}
        </Text>
        {full && (
          <>
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
          </>
        )}
        <SectionTitle>残り時間（任意）</SectionTitle>
        <Row style={styles.clockRow}>
          <Text num style={[styles.clock, clockSeconds === undefined && { color: colors.danger }]}>
            {clockDigitsLabel(draft.clock)}
          </Text>
          <View style={[styles.wrap, styles.flex]}>
            {KEYPAD.map((k) => (
              <Pressable
                key={k}
                accessibilityRole="button"
                accessibilityLabel={k === '⌫' ? '1文字消す' : `残り時間 ${k}`}
                onPress={() => update({ clock: k === '⌫' ? draft.clock.slice(0, -1) : (draft.clock + k).slice(0, 4) })}
                style={({ pressed }) => [styles.key, pressed && styles.pressed]}
              >
                <Text num style={styles.keyText}>{k}</Text>
              </Pressable>
            ))}
          </View>
        </Row>
        <Text style={[styles.hint, clockSeconds === undefined && { color: colors.danger }]}>
          {clockSeconds === undefined
            ? `残り時間が正しくありません（${periodLabel(targetPeriod)} は ${periodSeconds(targetPeriod, bundle.game) / 60}分まで）`
            : `そのQの残り時間です（例：6分32秒 → 632）。空にすると、時刻なしになります。${
                target.kind !== 'insert' && isSub(target.event) ? '同時に記録した交代は、まとめて直します。' : ''
              }時間を直しても、記録の順番は変わりません。`}
        </Text>
        <Row style={styles.editButtons}>
          <Button title="キャンセル" variant="secondary" onPress={() => setTarget(null)} style={styles.flex} />
          <Button
            title={target.kind === 'insert' ? '追加' : '保存'}
            onPress={save}
            disabled={(full && draft.rosterId === undefined) || clockSeconds === undefined}
            style={styles.flex}
          />
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
            {!target && (
              <Button
                title={placing ? '追加をやめる' : '記録を追加'}
                variant={placing ? 'secondary' : 'accent'}
                small
                onPress={() => setPlacing((v) => !v)}
              />
            )}
            <Button title="閉じる" small onPress={onClose} />
          </Row>
          {target ? (
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
                {placing && (
                  <Text style={styles.hint}>
                    付け忘れた記録を入れる場所を選んでください。上が新しい記録、下が古い記録です。
                  </Text>
                )}
                {events.length === 0 &&
                  (placing ? (
                    slot('empty', () => startInsert(null, filter === 'all' ? bundle.game.currentPeriod : filter))
                  ) : (
                    <Text style={styles.empty}>記録がありません</Text>
                  ))}
                {events.map((e, i) => (
                  <View key={e.id} style={styles.entry}>
                    {slotAfter(e, events[i - 1])}
                    {row(e)}
                    {placing &&
                      i === events.length - 1 &&
                      slot('first', () => startInsert({ eventId: e.id, place: 'before' }, insertPeriod(e, 'before')))}
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </SafeAreaView>
        <DialogHost />
      </SafeAreaProvider>
    </Modal>
  );

  function slot(key: string, onPress: () => void) {
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel="ここに記録を追加"
        onPress={onPress}
        style={({ pressed }) => [styles.slot, pressed && styles.pressed]}
      >
        <Ionicons name="add-circle" size={18} color={colors.accentText} />
        <Text style={styles.slotText}>ここに追加</Text>
      </Pressable>
    );
  }

  /** e の直後（画面では1つ上）に入れる場所。newer は、画面で1つ上にある記録 */
  function slotAfter(e: GameEvent, newer: GameEvent | undefined) {
    if (!placing) return null;
    // 1回の交代の出入りの間には入れない
    if (newer && isSub(e) && isSub(newer) && e.createdAt === newer.createdAt && e.side === newer.side) return null;
    const into = insertPeriod(e, 'after');
    // 最後のピリオドの終了より後ろには入れない
    if (into > periods.length) return null;
    return slot('after', () => startInsert({ eventId: e.id, place: 'after' }, into));
  }

  function row(e: GameEvent) {
    return (
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
                      {!placing && (
                        <Button
                          title="印を外す"
                          variant="ghost"
                          small
                          onPress={() => {
                            voidEvent(db, e.id);
                            onChanged();
                          }}
                        />
                      )}
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
                      {!placing && (
                        <>
                          {e.type === 'TIMEOUT' || isSub(e) ? (
                            <Button title="時間" variant="secondary" small onPress={() => startEdit(e, 'time')} />
                          ) : (
                            <Button title="修正" variant="secondary" small onPress={() => startEdit(e, 'edit')} />
                          )}
                          <Button title="削除" variant="ghost" small onPress={() => remove(e)} />
                        </>
                      )}
                    </Row>
                  )
    );
  }
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
  entry: { gap: 6 },
  hint: { fontSize: 12, lineHeight: 18, color: colors.sub },
  slot: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  slotText: { fontSize: 14, fontWeight: '800', color: colors.accentText },
  pressed: { opacity: 0.5 },
  clockRow: { alignItems: 'center', gap: 12 },
  clock: { minWidth: 84, textAlign: 'center', fontSize: 30, color: colors.text },
  key: {
    width: 44,
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { fontSize: 20, color: colors.text },
});
