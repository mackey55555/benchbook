import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { adjustStat, type GameBundle } from '@/db/repo';
import { FIX_STATS, FIX_STAT_LABELS, countFixStats, type FixStat } from '@/domain/analysis';
import {
  RULES,
  compareNumbers,
  computeScore,
  computeScoreThrough,
  computeTeamFouls,
  periodLabel,
  pointsOf,
} from '@/domain/rules';
import type { Side } from '@/domain/types';

import { Button, Chip, Row, Segmented } from './components';
import { DialogHost } from './dialog';
import { Text } from './Text';
import { colors, radius, sideBg, sideColor } from './theme';
import { attempt } from './useGame';

interface Cell {
  side: Side;
  rosterId: string;
  stat: FixStat;
}

const STAT_NAMES: Record<FixStat, string> = {
  FG2_MADE: '2点',
  FG3_MADE: '3点',
  FT_MADE: 'フリースロー',
  FOUL: 'ファウル',
};

/**
 * 選手別の修正表。オフィシャルの記録と見比べて、得点の成功数とファウル数を1件ずつ増減する。
 * マスを選び、下の「−1」「＋1」で直す。順番や種類まで直すときはログを使う。
 */
export function QuickFixSheet(props: {
  visible: boolean;
  bundle: GameBundle;
  /** 開いたときに表示するQ */
  period: number;
  /** Qを切り替えられるようにする（試合後の修正用） */
  choosePeriod?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenLog: () => void;
}) {
  const { visible, bundle, choosePeriod, onClose, onChanged, onOpenLog } = props;
  const { game, events, roster } = bundle;
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [period, setPeriod] = useState(props.period);
  const [side, setSide] = useState<Side>(game.ownSide);
  const [cell, setCell] = useState<Cell | null>(null);

  // 開くたびにQと選択を初期化する
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPeriod(props.period);
      setCell(null);
    }
  }

  const counts = useMemo(() => countFixStats(events, period), [events, period]);
  const inPeriod = computeScore(events, period);
  const through = computeScoreThrough(events, period);
  const periods = Array.from({ length: Math.max(game.currentPeriod, RULES.regulationPeriods) }, (_, i) => i + 1);

  const selected = cell ? roster.find((r) => r.id === cell.rosterId) : undefined;
  const selectedCount = cell ? (counts.get(cell.rosterId)?.[cell.stat] ?? 0) : 0;

  const adjust = (delta: 1 | -1) => {
    if (!cell) return;
    const ok = attempt(() =>
      adjustStat(db, { gameId: game.id, period, side: cell.side, rosterId: cell.rosterId, type: cell.stat, delta }),
    );
    // 書き込み完了後に画面へ反映する
    onChanged();
    if (ok) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const table = (s: Side) => {
    const players = roster.filter((r) => r.side === s).sort((a, b) => compareNumbers(a.number, b.number));
    return (
      <View key={s} style={styles.team}>
        <View style={[styles.teamHead, { backgroundColor: sideBg(s) }]}>
          <Text style={[styles.teamName, { color: sideColor(s) }]} numberOfLines={1}>
            {s} {(s === 'A' ? game.teamAName : game.teamBName) || `チーム${s}`}
          </Text>
          <Text style={styles.teamMeta}>
            {periodLabel(period)} <Text num style={styles.teamNum}>{inPeriod[s]}</Text>点　累計{' '}
            <Text num style={styles.teamNum}>{through[s]}</Text>　TF{' '}
            <Text num style={styles.teamNum}>{computeTeamFouls(events, s, period)}</Text>
          </Text>
        </View>
        <View style={styles.tr}>
          <Text style={[styles.no, styles.th]}>番号</Text>
          {FIX_STATS.map((stat) => (
            <Text key={stat} style={[styles.cellHead, styles.th]}>
              {FIX_STAT_LABELS[stat]}
            </Text>
          ))}
          <Text style={[styles.pts, styles.th]}>得点</Text>
        </View>
        <ScrollView>
          {players.map((p) => {
            const row = counts.get(p.id);
            const pts = FIX_STATS.reduce((sum, stat) => sum + (row?.[stat] ?? 0) * pointsOf(stat), 0);
            return (
              <View key={p.id} style={styles.tr}>
                <View style={styles.no}>
                  <Text num style={styles.noText}>
                    {p.number}
                  </Text>
                  {p.name !== '' && (
                    <Text style={styles.name} numberOfLines={1}>
                      {p.name}
                    </Text>
                  )}
                </View>
                {FIX_STATS.map((stat) => {
                  const n = row?.[stat] ?? 0;
                  const active = cell?.rosterId === p.id && cell.stat === stat;
                  return (
                    <Pressable
                      key={stat}
                      accessibilityRole="button"
                      accessibilityLabel={`${s} ${p.number}番 ${STAT_NAMES[stat]} ${n}`}
                      accessibilityState={{ selected: active }}
                      onPress={() => setCell(active ? null : { side: s, rosterId: p.id, stat })}
                      style={[
                        styles.cell,
                        landscape && styles.cellCompact,
                        stat === 'FOUL' && styles.cellFoul,
                        active && styles.cellActive,
                      ]}
                    >
                      <Text num style={[styles.cellText, n === 0 && styles.cellZero, active && styles.cellTextActive]}>
                        {n}
                      </Text>
                    </Pressable>
                  );
                })}
                <Text num style={styles.pts}>
                  {pts}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  // 選んだマスの現在値と、増減のボタン。横向きでは表を広く使うため、見出しの行に入れる
  const controls = (
    <>
      {cell && selected ? (
        <View style={[styles.barInfo, !landscape && styles.flex]}>
          <Text style={styles.barMain} numberOfLines={1}>
            {cell.side} #{selected.number} の{STAT_NAMES[cell.stat]}
          </Text>
          <Text num style={styles.barNum}>
            {selectedCount}
          </Text>
        </View>
      ) : (
        <Text style={[styles.barHint, !landscape && styles.flex]} numberOfLines={2}>
          直したいマスをタップ
        </Text>
      )}
      {cell ? (
        <>
          <Button
            title="−1"
            variant="secondary"
            small={landscape}
            disabled={selectedCount === 0}
            onPress={() => adjust(-1)}
            style={styles.step}
          />
          <Button title="＋1" variant="accent" small={landscape} onPress={() => adjust(1)} style={styles.step} />
        </>
      ) : (
        <Button title="ログで直す" variant="ghost" small onPress={onOpenLog} />
      )}
    </>
  );

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
            <Text style={styles.title}>得点・ファウルを直す</Text>
            {!choosePeriod && <Text style={styles.periodFixed}>{periodLabel(period)}</Text>}
            <View style={styles.flex} />
            {landscape && controls}
            <Button title="閉じる" small onPress={onClose} />
          </Row>
          {choosePeriod && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
              <Row>
                {periods.map((p) => (
                  <Chip
                    key={p}
                    label={periodLabel(p)}
                    active={period === p}
                    onPress={() => {
                      setPeriod(p);
                      setCell(null);
                    }}
                  />
                ))}
              </Row>
            </ScrollView>
          )}
          {!landscape && (
            <Segmented
              style={styles.sides}
              options={(['A', 'B'] as const).map((s) => ({
                value: s,
                label: (s === 'A' ? game.teamAName : game.teamBName) || `チーム${s}`,
              }))}
              value={side}
              onChange={(s) => {
                setSide(s);
                setCell(null);
              }}
            />
          )}
          <View style={styles.body}>{landscape ? [table('A'), table('B')] : table(side)}</View>
          {!landscape && <Row style={styles.bar}>{controls}</Row>}
        </SafeAreaView>
        <DialogHost />
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  header: { paddingHorizontal: 16, paddingVertical: 6 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  periodFixed: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.accentText,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  filters: { flexGrow: 0, paddingHorizontal: 16, marginBottom: 8 },
  sides: { marginHorizontal: 16, marginBottom: 8 },
  body: { flex: 1, flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingBottom: 8 },
  team: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, overflow: 'hidden' },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 36 },
  teamName: { flex: 1, fontSize: 14, fontWeight: '800' },
  teamMeta: { fontSize: 12, color: colors.text },
  teamNum: { fontSize: 18, color: colors.text },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  th: { fontSize: 11, fontWeight: '700', color: colors.sub, textAlign: 'center' },
  no: { width: 64, flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  noText: { fontSize: 22, color: colors.text, minWidth: 24, textAlign: 'right' },
  name: { flex: 1, fontSize: 10, color: colors.sub },
  cellHead: { flex: 1 },
  cell: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cellCompact: { minHeight: 34 },
  cellFoul: { backgroundColor: colors.dangerBg },
  cellActive: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  cellText: { fontSize: 24, color: colors.text },
  cellZero: { color: colors.sub },
  cellTextActive: { color: colors.text },
  pts: { width: 36, fontSize: 20, color: colors.text, textAlign: 'center' },
  bar: { paddingHorizontal: 16, paddingVertical: 8, gap: 10, minHeight: 68 },
  barInfo: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  barMain: { fontSize: 16, fontWeight: '800', color: colors.text },
  barNum: { fontSize: 26, color: colors.text },
  barHint: { fontSize: 14, color: colors.sub },
  step: { minWidth: 72 },
});
