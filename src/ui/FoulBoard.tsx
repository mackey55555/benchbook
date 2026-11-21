import { ScrollView, StyleSheet, View } from 'react-native';

import { RULES, computeTeamFouls, foulNotation, isInBonus, periodLabel, timeoutsByPeriod } from '@/domain/rules';
import type { TeamState } from '@/domain/stats';
import type { GameEvent, Side } from '@/domain/types';

import { Text } from './Text';
import { z } from './device';
import { colors, sideColor } from './theme';

const CELLS = RULES.foulOutAt;

/** スコアシートと同じく、第1Q・第3Qのファウルは赤、それ以外は濃紺で書く */
const periodColor = (period: number) => (period === 1 || period === 3 ? colors.danger : colors.text);

function FoulCells(props: { list: readonly { kind: string; ftAwarded: number; period: number }[] }) {
  return (
    <View style={styles.cells}>
      {Array.from({ length: CELLS }, (_, i) => {
        const f = props.list[i];
        return (
          <View key={i} style={[styles.cell, f && styles.cellFilled]}>
            {f && (
              <Text style={[styles.cellText, { color: periodColor(f.period) }]}>
                {foulNotation(f.kind as never, f.ftAwarded)}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function TeamColumn(props: {
  side: Side;
  name: string;
  team: TeamState;
  events: readonly GameEvent[];
  period: number;
}) {
  const { side, name, team, events, period } = props;
  const timeouts = timeoutsByPeriod(events, side);
  const firstHalf = (timeouts.get(1) ?? 0) + (timeouts.get(2) ?? 0);
  const secondHalf = (timeouts.get(3) ?? 0) + (timeouts.get(4) ?? 0);
  return (
    <View style={styles.column}>
      <Text style={[styles.team, { color: sideColor(side) }]} numberOfLines={1}>
        {side} {name}
      </Text>
      <View style={styles.summary}>
        {Array.from({ length: RULES.regulationPeriods }, (_, i) => i + 1).map((p) => {
          // 延長は第4Qの累計を継続する
          const scope = p === RULES.regulationPeriods ? Math.max(p, period) : p;
          const count = p <= period ? computeTeamFouls(events, side, scope) : 0;
          return (
            <View key={p} style={[styles.periodBox, p > period && styles.periodFuture]}>
              <Text style={styles.periodLabel}>{periodLabel(p)}</Text>
              <Text num style={[styles.periodCount, isInBonus(count) && { color: colors.danger }]}>
                {count}
              </Text>
            </View>
          );
        })}
        <View style={styles.periodBox}>
          <Text style={styles.periodLabel}>TO</Text>
          <Text style={styles.toText}>
            前{firstHalf} 後{secondHalf}
          </Text>
        </View>
      </View>
      {team.players.map((p) => {
        const out = p.status === 'fouledOut' || p.status === 'disqualified';
        return (
          <View key={p.roster.id} style={[styles.row, p.status === 'warning' && styles.rowWarn, out && styles.rowOut]}>
            <Text num style={styles.number}>
              {p.roster.number}
            </Text>
            <Text style={styles.name} numberOfLines={1}>
              {out ? (p.status === 'fouledOut' ? '退場　' : '失格　') : ''}
              {p.roster.name}
            </Text>
            <FoulCells list={p.fouls.list} />
          </View>
        );
      })}
      <View style={[styles.row, team.coach.disqualified && styles.rowOut]}>
        <Text style={styles.benchLabel} numberOfLines={1}>
          HC・ベンチ{team.coach.disqualified ? '　失格' : ''}
        </Text>
        <FoulCells list={team.coach.list} />
      </View>
    </View>
  );
}

/** ファウル状況。スコアシートの選手欄と同じ並び（背番号・氏名・ファウル5マス）で見せる */
export function FoulBoard(props: {
  names: Record<Side, string>;
  teams: Record<Side, TeamState>;
  events: readonly GameEvent[];
  period: number;
}) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      {(['A', 'B'] as const).map((side) => (
        <TeamColumn
          key={side}
          side={side}
          name={props.names[side]}
          team={props.teams[side]}
          events={props.events}
          period={props.period}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body: { flexDirection: 'row', gap: 14, paddingBottom: 4 },
  column: { flex: 1, minWidth: z(0), gap: 3 },
  team: { fontSize: z(14), fontWeight: '800' },
  summary: { flexDirection: 'row', gap: 4, marginBottom: 2 },
  periodBox: {
    flex: 1,
    height: z(40),
    borderRadius: 10,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodFuture: { opacity: 0.45 },
  periodLabel: { fontSize: z(10), fontWeight: '700', color: colors.sub },
  periodCount: { fontSize: z(20), lineHeight: z(22), color: colors.text },
  toText: { fontSize: z(11), fontWeight: '800', color: colors.text },
  row: {
    height: z(26),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 3,
    borderRadius: 8,
    backgroundColor: colors.card,
  },
  rowWarn: { backgroundColor: colors.warnBg },
  rowOut: { backgroundColor: colors.dangerBg },
  number: { width: z(24), fontSize: z(18), lineHeight: z(20), textAlign: 'center', color: colors.text },
  name: { flex: 1, minWidth: z(0), fontSize: z(12), fontWeight: '700', color: colors.text },
  benchLabel: { flex: 1, minWidth: z(0), fontSize: z(12), fontWeight: '700', color: colors.sub },
  cells: { flexDirection: 'row', gap: 2 },
  cell: {
    width: z(26),
    height: z(20),
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { borderColor: colors.disabled, backgroundColor: colors.card },
  cellText: { fontSize: z(11), fontWeight: '800' },
});
