import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  DATE_RANGE_LABELS,
  STAT_COLUMNS,
  formatStat,
  pct,
  perGame,
  statColumn,
  statValue,
  type DateRange,
  type StatMode,
} from '@/domain/analysis';
import { buildPlayerReportHtml } from '@/output/analysisHtml';
import { GroupedBars, Meter } from '@/ui/charts';
import { Button, Card, Chip, Row, SectionTitle, Segmented } from '@/ui/components';
import { ShareSheet } from '@/ui/ShareSheet';
import { StatTable } from '@/ui/StatTable';
import { Text } from '@/ui/Text';
import { colors, radius, page } from '@/ui/theme';
import { useAnalysis, useAnalysisLimit } from '@/ui/useAnalysis';

/** 推移グラフに出す試合数（新しいほうから） */
const TREND_GAMES = 10;
const TREND_KEYS = ['pts', 'fg3m', 'fg3p', 'fg2p', 'ftp', 'pf', 'reb', 'tov', 'ast', 'stl', 'blk'];
const HERO_KEYS = ['pts', 'reb', 'ast'];
const RANGES = Object.keys(DATE_RANGE_LABELS) as DateRange[];
const RESULT_LABELS = { win: '勝', lose: '負', draw: '分' } as const;
const MODES: { value: StatMode; label: string }[] = [
  { value: 'avg', label: '1試合平均' },
  { value: 'total', label: '合計' },
  { value: 'per40', label: '40分換算' },
];
const SHOTS = [
  { label: '2点', made: 'fg2m', att: 'fg2a' },
  { label: '3点', made: 'fg3m', att: 'fg3a' },
  { label: 'フリースロー', made: 'ftm', att: 'fta' },
] as const;
/** 試合ログの列（成功率は試投数が少なく意味が薄いので出さない） */
const LOG_COLUMNS = STAT_COLUMNS.filter((c) => c.kind !== 'pct');

const percent = (v: number | null) => (v === null ? '-' : `${Math.round(v)}%`);
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 選手1人の成績のまとめ。期間の合計・平均、シュート成功率、試合ごとの推移、試合ログ */
export default function PlayerScreen() {
  const params = useLocalSearchParams<{ key: string; range?: string }>();
  const router = useRouter();
  const [range, setRange] = useState<DateRange>(
    RANGES.includes(params.range as DateRange) ? (params.range as DateRange) : 'all',
  );
  const [mode, setMode] = useState<StatMode>('avg');
  const [metricKey, setMetricKey] = useState('pts');
  const [selectedGame, setSelectedGame] = useState<string | null>(null);

  const analysis = useAnalysis(range);
  const limit = useAnalysisLimit();
  // 期間内に試合が無くても氏名と背番号を出せるよう、全期間からも探す
  const everything = useAnalysis('all');
  const player = analysis.players.find((p) => p.key === params.key);
  const identity = player ?? everything.players.find((p) => p.key === params.key);

  const [shareOpen, setShareOpen] = useState(false);
  const shareHtml = useMemo(
    () =>
      shareOpen && player
        ? buildPlayerReportHtml(player, { rangeLabel: DATE_RANGE_LABELS[range], teamName: analysis.teamName })
        : '',
    [shareOpen, player, range, analysis.teamName],
  );

  const metric = statColumn(metricKey);
  const trend = (player?.log ?? []).slice(-TREND_GAMES);
  const picked = trend.find((t) => t.gameId === selectedGame);
  const fmt = (v: number | null) => formatStat(metric, v, 'total');

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: identity ? identity.name || `#${identity.number}` : '選手' }} />
      {limit.limited ? (
        <Text style={styles.empty}>選手ごとのページは、チームプランで使えます</Text>
      ) : !identity ? (
        <Text style={styles.empty}>この選手の記録が見つかりません</Text>
      ) : (
        <>
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <Text num style={styles.heroNo}>
                {identity.number}
              </Text>
              <View style={styles.flex}>
                <Text style={styles.heroName} numberOfLines={1}>
                  {identity.name || '名前なし'}
                </Text>
                <Text style={styles.heroSub}>
                  {DATE_RANGE_LABELS[range]}・{player?.games ?? 0}試合
                </Text>
              </View>
            </View>
            {player && (
              <View style={styles.heroStats}>
                {HERO_KEYS.map((k) => {
                  const c = statColumn(k);
                  return (
                    <View key={k} style={styles.heroStat}>
                      <Text style={styles.heroLabel}>{c.name}</Text>
                      <Text num style={styles.heroValue}>
                        {perGame(c.get(player.line) ?? 0, player.games).toFixed(1)}
                      </Text>
                      <Text style={styles.heroTotal}>計 {c.get(player.line)}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <Row>
            <Text style={styles.label}>期間</Text>
            {RANGES.map((r) => (
              <Chip
                key={r}
                label={DATE_RANGE_LABELS[r]}
                active={range === r}
                onPress={() => {
                  setRange(r);
                  setSelectedGame(null);
                }}
              />
            ))}
          </Row>

          {!player ? (
            <Text style={styles.empty}>この期間に出場登録された試合がありません</Text>
          ) : (
            <>
              <Row>
                <SectionTitle>成績</SectionTitle>
                <View style={styles.flex} />
                <Button title="共有" small variant="secondary" onPress={() => setShareOpen(true)} />
                <Segmented options={MODES} value={mode} onChange={setMode} style={styles.modes} />
              </Row>
              <View style={styles.grid}>
                {STAT_COLUMNS.map((c) => (
                  <View key={c.key} style={styles.stat}>
                    <Text style={styles.statLabel} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text num style={styles.statValue}>
                      {formatStat(c, statValue(c, player.line, player.games, mode), mode)}
                    </Text>
                  </View>
                ))}
              </View>

              <SectionTitle>シュート成功率</SectionTitle>
              <Card>
                {SHOTS.map((s) => (
                  <View key={s.label} style={styles.shot}>
                    <View style={styles.shotTop}>
                      <Text style={styles.shotLabel}>{s.label}</Text>
                      <Text style={styles.note}>
                        {player.line[s.made]}/{player.line[s.att]}本
                      </Text>
                      <Text num style={styles.shotValue}>
                        {percent(pct(player.line[s.made], player.line[s.att]))}
                      </Text>
                    </View>
                    <Meter value={pct(player.line[s.made], player.line[s.att])} color={colors.chartOwn} />
                  </View>
                ))}
              </Card>

              <SectionTitle>試合ごとの推移</SectionTitle>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                <Row>
                  {TREND_KEYS.map((k) => (
                    <Chip key={k} label={statColumn(k).name} active={metricKey === k} onPress={() => setMetricKey(k)} />
                  ))}
                </Row>
              </ScrollView>
              <Card>
                <Text style={styles.note}>
                  {metric.name}・{trend.length < player.games ? `直近${trend.length}試合` : `全${player.games}試合`}
                </Text>
                <GroupedBars
                  groups={trend.map((t) => ({ key: t.gameId, label: shortDate(t.date), own: metric.get(t.line) ?? 0 }))}
                  format={(v) => (metric.kind === 'pct' ? `${v}%` : String(v))}
                  selectedKey={selectedGame}
                  onSelect={(key) => setSelectedGame((cur) => (cur === key ? null : key))}
                />
                {picked ? (
                  <View style={styles.picked}>
                    <View style={styles.flex}>
                      <Text style={styles.pickedMain} numberOfLines={1}>
                        {picked.date}　vs {picked.opponent}
                      </Text>
                      <Text style={styles.note}>
                        {metric.name} {fmt(metric.get(picked.line))}
                      </Text>
                    </View>
                    <Button
                      title="試合を開く"
                      small
                      variant="secondary"
                      onPress={() => router.push(`/games/${picked.gameId}`)}
                    />
                  </View>
                ) : (
                  <Text style={styles.note}>棒をタップすると、その試合の値が出ます</Text>
                )}
              </Card>

              <SectionTitle>試合ごとの成績</SectionTitle>
              <StatTable
                rows={[...player.log].reverse().map((g) => ({
                  key: g.gameId,
                  games: 1,
                  line: g.line,
                  head: (
                    <View>
                      <Text style={styles.logDate}>
                        {shortDate(g.date)}　{RESULT_LABELS[g.result]}
                      </Text>
                      <Text style={styles.logOpp} numberOfLines={1}>
                        {g.opponent}
                      </Text>
                    </View>
                  ),
                }))}
                columns={LOG_COLUMNS}
                mode="total"
                headLabel="試合"
                headWidth={112}
                onPressRow={(gameId) => router.push(`/games/${gameId}`)}
              />
              <Text style={styles.note}>
                新しい順。行をタップすると、その試合を開きます。出場時間と +/- は、先発と交代を記録した試合だけに出ます
              </Text>
            </>
          )}
        </>
      )}
      <ShareSheet
        visible={shareOpen}
        html={shareHtml}
        name={`${identity?.number ?? ''}_${identity?.name || '選手'}_${DATE_RANGE_LABELS[range]}`}
        onClose={() => setShareOpen(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { ...page, padding: 20, gap: 12, paddingBottom: 40 },
  flex: { flex: 1, minWidth: 0 },
  empty: { color: colors.sub, fontSize: 14, paddingVertical: 12 },
  label: { width: 34, fontSize: 12, fontWeight: '700', color: colors.sub },
  note: { fontSize: 12, color: colors.sub },
  hero: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: 20, gap: 16 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroNo: { fontSize: 64, lineHeight: 66, color: colors.accent, minWidth: 56, textAlign: 'center' },
  heroName: { fontSize: 22, fontWeight: '800', color: colors.primaryText },
  heroSub: { fontSize: 13, color: colors.onInkSub },
  heroStats: { flexDirection: 'row', gap: 8 },
  heroStat: { flex: 1, backgroundColor: colors.inkSoft, borderRadius: radius.md, padding: 10, alignItems: 'center' },
  heroLabel: { fontSize: 11, fontWeight: '700', color: colors.onInkSub },
  heroValue: { fontSize: 34, lineHeight: 38, color: colors.primaryText },
  heroTotal: { fontSize: 11, color: colors.onInkSub },
  modes: { width: 250 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '31.5%', flexGrow: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: 10, gap: 2 },
  statLabel: { fontSize: 11, fontWeight: '700', color: colors.sub },
  statValue: { fontSize: 24, lineHeight: 28, color: colors.text },
  shot: { gap: 4 },
  shotTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  shotLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  shotValue: { fontSize: 24, color: colors.text, minWidth: 52, textAlign: 'right' },
  chips: { flexGrow: 0 },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 10,
  },
  pickedMain: { fontSize: 13, fontWeight: '700', color: colors.text },
  logDate: { fontSize: 12, fontWeight: '700', color: colors.text },
  logOpp: { fontSize: 11, color: colors.sub },
});
