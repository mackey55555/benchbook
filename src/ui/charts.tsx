import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors } from './theme';

/** 軸の上限を、きりのよい数に切り上げる */
export function niceMax(value: number): number {
  if (value <= 0) return 10;
  const steps = [1, 2, 2.5, 5, 10];
  const base = 10 ** Math.floor(Math.log10(value));
  for (const s of steps) if (s * base >= value) return s * base;
  return 10 * base;
}

export function Legend(props: { items: { label: string; color: string }[] }) {
  return (
    <View style={styles.legend}>
      {props.items.map((i) => (
        <View key={i.label} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: i.color }]} />
          <Text style={styles.legendText}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

export interface BarGroup {
  key: string;
  label: string;
  own: number;
  /** 省くと自チームだけの1系列になる */
  opp?: number;
}

/**
 * 自チームと相手を並べた縦棒グラフ。軸は1本で0から始める。
 * showValues を付けると棒の上に数値を出す（項目が少ないとき用）。
 * onSelect を渡すと、棒をタップしてその項目の詳細を出せる。
 */
export function GroupedBars(props: {
  groups: BarGroup[];
  height?: number;
  showValues?: boolean;
  format?: (v: number) => string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  const { groups, height = 140, showValues, format = String, selectedKey, onSelect } = props;
  const max = niceMax(Math.max(1, ...groups.flatMap((g) => [g.own, g.opp ?? 0])));
  const ticks = [max, max / 2, 0];
  const bar = (value: number, color: string) => (
    <View style={styles.barSlot}>
      {showValues && <Text style={styles.barValue}>{format(value)}</Text>}
      <View style={[styles.bar, { height: Math.max(value > 0 ? 2 : 0, (value / max) * height), backgroundColor: color }]} />
    </View>
  );
  const describe = (g: BarGroup) =>
    g.opp === undefined ? `${g.label} ${format(g.own)}` : `${g.label} 自チーム${format(g.own)} 相手${format(g.opp)}`;
  return (
    <View style={styles.chart}>
      <View style={[styles.axis, { height: height + 14 }]}>
        {ticks.map((t) => (
          <Text key={t} style={styles.tick}>
            {format(t)}
          </Text>
        ))}
      </View>
      <View style={styles.flex}>
        <View style={{ height }}>
          {ticks.map((t) => (
            <View key={t} style={[styles.grid, { bottom: (t / max) * height }, t === 0 && styles.baseline]} />
          ))}
          <View style={styles.plot}>
            {groups.map((g) => {
              const selected = selectedKey === g.key;
              const content = (
                <View style={[styles.pair, selectedKey != null && !selected && styles.dim]}>
                  {bar(g.own, colors.chartOwn)}
                  {g.opp !== undefined && bar(g.opp, colors.chartOpp)}
                </View>
              );
              return onSelect ? (
                <Pressable
                  key={g.key}
                  accessibilityRole="button"
                  accessibilityLabel={describe(g)}
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(g.key)}
                  style={styles.group}
                >
                  {content}
                </Pressable>
              ) : (
                <View
                  key={g.key}
                  accessible
                  accessibilityLabel={describe(g)}
                  style={styles.group}
                >
                  {content}
                </View>
              );
            })}
          </View>
        </View>
        <View style={styles.labels}>
          {groups.map((g) => (
            <Text key={g.key} style={[styles.groupLabel, selectedKey === g.key && styles.groupLabelActive]}
              numberOfLines={1}
              ellipsizeMode="clip"
            >
              {g.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

/** 0〜100% の横棒。value が null（試投なし）のときは空の棒にする */
export function Meter(props: { value: number | null; color: string }) {
  return (
    <View style={styles.meterTrack}>
      {props.value !== null && props.value > 0 && (
        <View style={[styles.meterFill, { width: `${Math.min(100, props.value)}%`, backgroundColor: props.color }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  legend: { flexDirection: 'row', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 12, color: colors.sub },
  chart: { flexDirection: 'row', gap: 6 },
  // 目盛りの文字（高さ14）の中心を目盛り線に合わせるため、上下に7ずつはみ出させる
  axis: { width: 26, justifyContent: 'space-between', alignItems: 'flex-end', marginTop: -7 },
  tick: { fontSize: 10, lineHeight: 14, color: colors.sub },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  baseline: { height: 1, backgroundColor: colors.disabled },
  plot: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  group: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  pair: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  dim: { opacity: 0.35 },
  barSlot: { alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: 12, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barValue: { fontSize: 10, lineHeight: 13, color: colors.text, marginBottom: 2 },
  labels: { flexDirection: 'row', marginTop: 4 },
  groupLabel: { flex: 1, textAlign: 'center', fontSize: 9, color: colors.sub },
  groupLabelActive: { color: colors.text, fontWeight: '800' },
  meterTrack: { height: 10, borderRadius: 5, backgroundColor: colors.disabledBg, overflow: 'hidden' },
  meterFill: { height: 10, borderRadius: 5 },
});
