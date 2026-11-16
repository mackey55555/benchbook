import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatStat, statValue, type StatColumn, type StatMode } from '@/domain/analysis';
import type { BoxScoreLine } from '@/domain/stats';

import { Text } from './Text';
import { colors, radius } from './theme';

export interface StatRow {
  key: string;
  /** 左端の固定列に出す内容（選手名、日付など） */
  head: ReactNode;
  line: BoxScoreLine;
  /** 1試合平均の分母 */
  games: number;
  /** 項目の前に出す値（試合数など） */
  lead?: string;
}

const ROW_HEIGHT = 46;
const HEAD_HEIGHT = 34;

/**
 * 成績の表。左端の列は固定で、項目は横にスクロールする。
 * sortKey / onSort を渡すと、見出しをタップして並べ替えられる（並べ替え自体は呼び出し側で行う）。
 */
export function StatTable(props: {
  rows: StatRow[];
  columns: readonly StatColumn[];
  mode: StatMode;
  headLabel: string;
  headWidth?: number;
  leadLabel?: string;
  sortKey?: string;
  onSort?: (key: string) => void;
  onPressRow?: (key: string) => void;
}) {
  const { rows, columns, mode, headLabel, headWidth = 108, leadLabel, sortKey, onSort, onPressRow } = props;
  return (
    <View style={styles.table}>
      <View style={[styles.fixed, { width: headWidth }]}>
        <View style={[styles.headCell, styles.headRow]}>
          <Text style={styles.th}>{headLabel}</Text>
        </View>
        {rows.map((r) => (
          <Pressable
            key={r.key}
            accessibilityRole={onPressRow ? 'button' : undefined}
            disabled={!onPressRow}
            onPress={() => onPressRow?.(r.key)}
            style={({ pressed }) => [styles.headCell, styles.row, pressed && styles.pressed]}
          >
            {r.head}
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
        <View>
          <View style={[styles.cells, styles.headRow]}>
            {leadLabel !== undefined && <Text style={[styles.cell, styles.th]}>{leadLabel}</Text>}
            {columns.map((c) => {
              const active = sortKey === c.key;
              return onSort ? (
                <Pressable
                  key={c.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}で並べ替え`}
                  accessibilityState={{ selected: active }}
                  onPress={() => onSort(c.key)}
                  style={[styles.cell, styles.sortCell, active && styles.sortActive]}
                >
                  <Text style={[styles.th, active && styles.thActive]}>{c.label}</Text>
                </Pressable>
              ) : (
                <Text key={c.key} style={[styles.cell, styles.th]}>
                  {c.label}
                </Text>
              );
            })}
          </View>
          {rows.map((r) => (
            <Pressable
              key={r.key}
              disabled={!onPressRow}
              onPress={() => onPressRow?.(r.key)}
              accessible={false}
              style={({ pressed }) => [styles.cells, styles.row, pressed && styles.pressed]}
            >
              {r.lead !== undefined && (
                <Text num style={[styles.cell, styles.value]}>
                  {r.lead}
                </Text>
              )}
              {columns.map((c) => (
                <Text num key={c.key} style={[styles.cell, styles.value, sortKey === c.key && styles.valueActive]}>
                  {formatStat(c, statValue(c, r.line, r.games, mode), mode)}
                </Text>
              ))}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  table: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' },
  fixed: { borderRightWidth: 1, borderRightColor: colors.line },
  pressed: { opacity: 0.6 },
  headRow: { height: HEAD_HEIGHT, backgroundColor: colors.disabledBg },
  row: { height: ROW_HEIGHT, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  headCell: { justifyContent: 'center', paddingLeft: 12, paddingRight: 6 },
  cells: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  cell: { width: 46, textAlign: 'center' },
  sortCell: { height: HEAD_HEIGHT - 8, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  sortActive: { backgroundColor: colors.primary },
  th: { fontSize: 11, fontWeight: '700', color: colors.sub },
  thActive: { color: colors.primaryText },
  value: { fontSize: 18, color: colors.mute },
  valueActive: { color: colors.text, fontSize: 21 },
});
