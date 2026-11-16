import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { getGameBundle, listGames, todayString } from '@/db/repo';
import {
  DATE_RANGE_LABELS,
  NO_FILTER,
  analyzeTeam,
  filterGames,
  pct,
  perGame,
  type AnalysisGame,
  type DateRange,
  type PlayerAnalysis,
} from '@/domain/analysis';
import { periodLabel } from '@/domain/rules';
import type { BoxScoreLine } from '@/domain/stats';
import { GroupedBars, Legend, Meter } from '@/ui/charts';
import { Button, Card, Chip, Row, SectionTitle } from '@/ui/components';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';
import { useRefresh } from '@/ui/useGame';

/** 推移グラフに出す試合数（新しいほうから） */
const TREND_GAMES = 10;

const RANGES = Object.keys(DATE_RANGE_LABELS) as DateRange[];
const RESULT_LABELS = { win: '勝ち', lose: '負け', draw: '引分' } as const;
const LEGEND = [
  { label: '自チーム', color: colors.chartOwn },
  { label: '相手', color: colors.chartOpp },
];

const one = (v: number) => v.toFixed(1);
const percent = (v: number | null) => (v === null ? '-' : `${Math.round(v)}%`);
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

const SHOTS: { label: string; made: keyof BoxScoreLine; att: keyof BoxScoreLine }[] = [
  { label: '2点', made: 'fg2m', att: 'fg2a' },
  { label: '3点', made: 'fg3m', att: 'fg3a' },
  { label: 'フリースロー', made: 'ftm', att: 'fta' },
];

const AVERAGES: { label: string; key: keyof BoxScoreLine }[] = [
  { label: 'リバウンド', key: 'reb' },
  { label: 'アシスト', key: 'ast' },
  { label: 'スティール', key: 'stl' },
  { label: 'ブロック', key: 'blk' },
  { label: 'ターンオーバー', key: 'tov' },
  { label: 'ファウル', key: 'pf' },
];

type PlayerSort = 'pts' | 'fg3m' | 'reb' | 'ast' | 'pf';
const PLAYER_SORTS: { value: PlayerSort; label: string }[] = [
  { value: 'pts', label: '得点' },
  { value: 'fg3m', label: '3P' },
  { value: 'reb', label: 'リバウンド' },
  { value: 'ast', label: 'アシスト' },
  { value: 'pf', label: 'ファウル' },
];

/** 終了した試合を自チームの視点で集計して見せる */
export default function AnalysisScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [version] = useRefresh();
  const [range, setRange] = useState<DateRange>('all');
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [sort, setSort] = useState<PlayerSort>('pts');

  const analysis = useMemo(() => {
    const finished = listGames(db).filter((g) => g.game.status === 'finished');
    const games = filterGames(finished, { ...NO_FILTER, range }, todayString())
      .map(({ game }) => getGameBundle(db, game.id))
      .filter((b): b is NonNullable<typeof b> => b !== undefined) satisfies AnalysisGame[];
    return analyzeTeam(games);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  }, [version, range]);

  const n = analysis.games;
  const trend = analysis.trend.slice(-TREND_GAMES);
  const picked = trend.find((t) => t.id === selectedGame);
  const avgFor = perGame(analysis.own.pts, n);
  const avgAgainst = perGame(analysis.opp.pts, n);
  const diff = avgFor - avgAgainst;

  const players = [...analysis.players]
    .filter((p) => p.games > 0)
    .sort((a, b) => perGame(b.line[sort], b.games) - perGame(a.line[sort], a.games) || b.line[sort] - a.line[sort]);
  const playerMax = Math.max(0.1, ...players.map((p) => perGame(p.line[sort], p.games)));

  const tile = (label: string, value: string, sub?: string) => (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text num style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub !== undefined && <Text style={styles.tileSub}>{sub}</Text>}
    </View>
  );

  const playerRow = (p: PlayerAnalysis) => {
    const avg = perGame(p.line[sort], p.games);
    return (
      <View key={p.key} style={styles.player}>
        <Text num style={styles.playerNo}>
          {p.number}
        </Text>
        <View style={styles.flex}>
          <View style={styles.playerTop}>
            <Text style={styles.playerName} numberOfLines={1}>
              {p.name || `#${p.number}`}
            </Text>
            <Text style={styles.playerMeta}>
              {p.games}試合・計{p.line[sort]}
            </Text>
          </View>
          <Meter value={(avg / playerMax) * 100} color={colors.chartOwn} />
        </View>
        <Text num style={styles.playerAvg}>
          {one(avg)}
        </Text>
      </View>
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
    >
      <Text style={styles.title}>分析</Text>
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

      {n === 0 ? (
        <Text style={styles.empty}>
          {range === 'all'
            ? '終了した試合がまだありません。試合を記録すると、ここにチームの成績が出ます'
            : 'この期間に終了した試合がありません'}
        </Text>
      ) : (
        <>
          <View style={styles.tiles}>
            {tile('戦績', `${analysis.wins}-${analysis.losses}`, analysis.draws > 0 ? `勝-敗・${analysis.draws}分` : '勝-敗')}
            {tile('平均得点', one(avgFor), `失点 ${one(avgAgainst)}`)}
            {tile('得失点差', `${diff > 0 ? '+' : ''}${one(diff)}`, '1試合あたり')}
          </View>

          <SectionTitle>得点の推移</SectionTitle>
          <Card>
            <View style={styles.cardHead}>
              <Text style={styles.cardNote}>
                {trend.length < n ? `直近${trend.length}試合` : `全${n}試合`}・古い順
              </Text>
              <Legend items={LEGEND} />
            </View>
            <GroupedBars
              groups={trend.map((t) => ({ key: t.id, label: shortDate(t.date), own: t.own, opp: t.opp }))}
              selectedKey={selectedGame}
              onSelect={(key) => setSelectedGame((cur) => (cur === key ? null : key))}
            />
            {picked ? (
              <View style={styles.picked}>
                <View style={styles.flex}>
                  <Text style={styles.pickedMain} numberOfLines={1}>
                    {picked.date}　vs {picked.opponent}
                  </Text>
                  <Text style={styles.pickedSub}>
                    {picked.own} - {picked.opp}　{RESULT_LABELS[picked.result]}
                  </Text>
                </View>
                <Button title="試合を開く" small variant="secondary" onPress={() => router.push(`/games/${picked.id}`)} />
              </View>
            ) : (
              <Text style={styles.cardNote}>棒をタップすると、その試合の結果が出ます</Text>
            )}
          </Card>

          <SectionTitle>Q別の平均得点</SectionTitle>
          <Card>
            <View style={styles.cardHead}>
              <Text style={styles.cardNote}>1試合あたり</Text>
              <Legend items={LEGEND} />
            </View>
            <GroupedBars
              groups={analysis.periods.map((p) => ({ key: String(p.period), label: periodLabel(p.period), own: p.own, opp: p.opp }))}
              height={120}
              showValues
              format={(v) => (Number.isInteger(v) ? String(v) : one(v))}
            />
          </Card>

          <SectionTitle>シュート成功率</SectionTitle>
          <Card>
            {SHOTS.map((s) => {
              const own = pct(analysis.own[s.made] as number, analysis.own[s.att] as number);
              const opp = pct(analysis.opp[s.made] as number, analysis.opp[s.att] as number);
              return (
                <View key={s.label} style={styles.shot}>
                  <View style={styles.shotTop}>
                    <Text style={styles.shotLabel}>{s.label}</Text>
                    <Text style={styles.shotDetail}>
                      {analysis.own[s.made]}/{analysis.own[s.att]}本
                    </Text>
                    <Text num style={styles.shotValue}>
                      {percent(own)}
                    </Text>
                  </View>
                  <Meter value={own} color={colors.chartOwn} />
                  <Text style={styles.shotOpp}>
                    相手 {percent(opp)}（{analysis.opp[s.made]}/{analysis.opp[s.att]}本）
                  </Text>
                </View>
              );
            })}
            <Text style={styles.cardNote}>外したシュートを記録していない試合は、成功率が高く出ます</Text>
          </Card>

          <SectionTitle>1試合平均</SectionTitle>
          <Card style={styles.table}>
            <View style={[styles.tr, styles.trHead]}>
              <Text style={[styles.tdName, styles.th]}>項目</Text>
              <Text style={[styles.td, styles.th]}>自チーム</Text>
              <Text style={[styles.td, styles.th]}>相手</Text>
            </View>
            {AVERAGES.map((a) => (
              <View key={a.key} style={styles.tr}>
                <Text style={styles.tdName}>{a.label}</Text>
                <Text num style={styles.td}>
                  {one(perGame(analysis.own[a.key] as number, n))}
                </Text>
                <Text num style={styles.td}>
                  {one(perGame(analysis.opp[a.key] as number, n))}
                </Text>
              </View>
            ))}
          </Card>

          <SectionTitle>選手別（1試合平均）</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sorts}>
            <Row>
              {PLAYER_SORTS.map((s) => (
                <Chip key={s.value} label={s.label} active={sort === s.value} onPress={() => setSort(s.value)} />
              ))}
            </Row>
          </ScrollView>
          <Card>{players.map(playerRow)}</Card>
          <Text style={styles.cardNote}>試合数は、出場登録された試合の数です</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, paddingBottom: 32 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  label: { width: 34, fontSize: 12, fontWeight: '700', color: colors.sub },
  empty: { color: colors.sub, fontSize: 14, paddingVertical: 12 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, padding: 12, gap: 2 },
  tileLabel: { fontSize: 12, fontWeight: '700', color: colors.sub },
  tileValue: { fontSize: 30, lineHeight: 34, color: colors.text },
  tileSub: { fontSize: 11, color: colors.sub },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardNote: { fontSize: 12, color: colors.sub },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 10,
  },
  pickedMain: { fontSize: 13, fontWeight: '700', color: colors.text },
  pickedSub: { fontSize: 12, color: colors.sub },
  shot: { gap: 4 },
  shotTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  shotLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  shotDetail: { fontSize: 12, color: colors.sub },
  shotValue: { fontSize: 24, color: colors.text, minWidth: 52, textAlign: 'right' },
  shotOpp: { fontSize: 11, color: colors.sub },
  table: { gap: 0, paddingVertical: 6 },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  trHead: { minHeight: 28 },
  th: { fontSize: 11, fontWeight: '700', color: colors.sub },
  tdName: { flex: 1, fontSize: 14, color: colors.text },
  td: { width: 72, textAlign: 'right', fontSize: 20, color: colors.text },
  sorts: { flexGrow: 0 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  playerNo: { width: 30, fontSize: 24, color: colors.text, textAlign: 'right' },
  playerTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  playerName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  playerMeta: { fontSize: 11, color: colors.sub },
  playerAvg: { width: 44, fontSize: 24, color: colors.text, textAlign: 'right' },
});
