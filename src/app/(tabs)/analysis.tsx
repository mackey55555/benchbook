import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  type TeamAnalysis,
} from '@/domain/analysis';
import { periodLabel } from '@/domain/rules';
import { sharePdf } from '@/lib/share';
import { buildFullReportHtml, buildPlayersReportHtml, buildTeamReportHtml } from '@/output/analysisHtml';
import { GroupedBars, Legend, Meter } from '@/ui/charts';
import { Button, Card, Chip, Row, SectionTitle, Segmented } from '@/ui/components';
import { showDialog } from '@/ui/dialog';
import { ShareSheet } from '@/ui/ShareSheet';
import { StatTable } from '@/ui/StatTable';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';
import { useAnalysis } from '@/ui/useAnalysis';

/** 推移グラフに出す試合数（新しいほうから） */
const TREND_GAMES = 10;
/** 推移グラフで選べる項目 */
const TREND_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf', 'fg3m', 'fg2p', 'fg3p', 'ftp'];

const RANGES = Object.keys(DATE_RANGE_LABELS) as DateRange[];
const RESULT_LABELS = { win: '勝ち', lose: '負け', draw: '引分' } as const;
const LEGEND = [
  { label: '自チーム', color: colors.chartOwn },
  { label: '相手', color: colors.chartOpp },
];
const MODES: { value: StatMode; label: string }[] = [
  { value: 'avg', label: '1試合平均' },
  { value: 'total', label: '合計' },
];
const SHOTS = [
  { label: '2点', made: 'fg2m', att: 'fg2a' },
  { label: '3点', made: 'fg3m', att: 'fg3a' },
  { label: 'フリースロー', made: 'ftm', att: 'fta' },
] as const;

const one = (v: number) => v.toFixed(1);
const percent = (v: number | null) => (v === null ? '-' : `${Math.round(v)}%`);
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

type Axis = 'team' | 'players';

/** 終了した試合を自チームの視点で集計して見せる。チームと選手の2軸 */
export default function AnalysisScreen() {
  const insets = useSafeAreaInsets();
  const [axis, setAxis] = useState<Axis>('team');
  const [range, setRange] = useState<DateRange>('all');
  const [mode, setMode] = useState<StatMode>('avg');
  const [sortKey, setSortKey] = useState('pts');
  const [shareOpen, setShareOpen] = useState(false);
  const analysis = useAnalysis(range);

  // 共有用のシートは、いま見ている軸・期間・平均／合計・並び順で作る
  const shareHtml = useMemo(() => {
    if (!shareOpen) return '';
    const options = { rangeLabel: DATE_RANGE_LABELS[range], mode };
    return axis === 'team'
      ? buildTeamReportHtml(analysis, options)
      : buildPlayersReportHtml(analysis, { ...options, sortKey });
  }, [shareOpen, axis, analysis, range, mode, sortKey]);
  const [exporting, setExporting] = useState(false);

  // 期間の全内容（チーム成績・選手の比較表・選手1人ずつのまとめ）を1つのPDFにして共有する
  const exportAll = async () => {
    setExporting(true);
    try {
      const html = buildFullReportHtml(analysis, { rangeLabel: DATE_RANGE_LABELS[range], mode, sortKey });
      await sharePdf(html, `${analysis.teamName || 'benchbook'}_成績まとめ_${DATE_RANGE_LABELS[range]}`);
    } catch (e) {
      showDialog('出力できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const shareMenu = () =>
    showDialog('共有', `期間：${DATE_RANGE_LABELS[range]}（${analysis.games}試合）`, [
      { text: axis === 'team' ? 'チーム成績を共有' : '選手の比較表を共有', onPress: () => setShareOpen(true) },
      { text: '全内容を1つのPDFで出力', onPress: () => void exportAll() },
      { text: 'キャンセル', style: 'cancel' },
    ]);

  const shareName = `${analysis.teamName || 'benchbook'}_${axis === 'team' ? 'チーム成績' : '選手成績'}_${DATE_RANGE_LABELS[range]}`;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
    >
      <Row>
        <Text style={[styles.title, styles.flex]}>分析</Text>
        {analysis.games > 0 && <Button title={exporting ? '出力中…' : '共有'} small variant="secondary" disabled={exporting} onPress={shareMenu} />}
      </Row>
      <Segmented
        options={[
          { value: 'team', label: 'チーム' },
          { value: 'players', label: '選手' },
        ]}
        value={axis}
        onChange={setAxis}
      />
      <Row>
        <Text style={styles.label}>期間</Text>
        {RANGES.map((r) => (
          <Chip key={r} label={DATE_RANGE_LABELS[r]} active={range === r} onPress={() => setRange(r)} />
        ))}
      </Row>

      {analysis.games === 0 ? (
        <Text style={styles.empty}>
          {range === 'all'
            ? '終了した試合がまだありません。試合を記録すると、ここに成績が出ます'
            : 'この期間に終了した試合がありません'}
        </Text>
      ) : (
        <>
          <Row>
            <Text style={styles.count}>{analysis.games}試合の成績</Text>
            <View style={styles.flex} />
            <Segmented options={MODES} value={mode} onChange={setMode} style={styles.modes} />
          </Row>
          {axis === 'team' ? (
            <TeamView key={range} analysis={analysis} mode={mode} />
          ) : (
            <PlayersView analysis={analysis} mode={mode} range={range} sortKey={sortKey} onSort={setSortKey} />
          )}
        </>
      )}
      <ShareSheet visible={shareOpen} html={shareHtml} name={shareName} onClose={() => setShareOpen(false)} />
    </ScrollView>
  );
}

function TeamView({ analysis, mode }: { analysis: TeamAnalysis; mode: StatMode }) {
  const router = useRouter();
  const [metricKey, setMetricKey] = useState('pts');
  const [selectedGame, setSelectedGame] = useState<string | null>(null);

  const n = analysis.games;
  const metric = statColumn(metricKey);
  const trend = analysis.trend.slice(-TREND_GAMES);
  const picked = trend.find((t) => t.id === selectedGame);
  const avgFor = perGame(analysis.own.pts, n);
  const avgAgainst = perGame(analysis.opp.pts, n);
  const diff = avgFor - avgAgainst;
  const fmt = (v: number | null) => formatStat(metric, v, 'total');

  const tile = (label: string, value: string, sub: string) => (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text num style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileSub}>{sub}</Text>
    </View>
  );

  return (
    <>
      <View style={styles.tiles}>
        {tile('戦績', `${analysis.wins}-${analysis.losses}`, analysis.draws > 0 ? `勝-敗・${analysis.draws}分` : '勝-敗')}
        {tile('平均得点', one(avgFor), `失点 ${one(avgAgainst)}`)}
        {tile('得失点差', `${diff > 0 ? '+' : ''}${one(diff)}`, '1試合あたり')}
      </View>

      <SectionTitle>試合ごとの推移</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        <Row>
          {TREND_KEYS.map((k) => (
            <Chip key={k} label={statColumn(k).name} active={metricKey === k} onPress={() => setMetricKey(k)} />
          ))}
        </Row>
      </ScrollView>
      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardNote}>
            {metric.name}・{trend.length < n ? `直近${trend.length}試合` : `全${n}試合`}
          </Text>
          <Legend items={LEGEND} />
        </View>
        <GroupedBars
          groups={trend.map((t) => ({
            key: t.id,
            label: shortDate(t.date),
            own: metric.get(t.ownLine) ?? 0,
            opp: metric.get(t.oppLine) ?? 0,
          }))}
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
              <Text style={styles.pickedSub}>
                {metric.name} {fmt(metric.get(picked.ownLine))}（相手 {fmt(metric.get(picked.oppLine))}）・{picked.own}-
                {picked.opp} {RESULT_LABELS[picked.result]}
              </Text>
            </View>
            <Button title="試合を開く" small variant="secondary" onPress={() => router.push(`/games/${picked.id}`)} />
          </View>
        ) : (
          <Text style={styles.cardNote}>棒をタップすると、その試合の値が出ます</Text>
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
        {SHOTS.map((s) => (
          <View key={s.label} style={styles.shot}>
            <View style={styles.shotTop}>
              <Text style={styles.shotLabel}>{s.label}</Text>
              <Text style={styles.shotDetail}>
                {analysis.own[s.made]}/{analysis.own[s.att]}本
              </Text>
              <Text num style={styles.shotValue}>
                {percent(pct(analysis.own[s.made], analysis.own[s.att]))}
              </Text>
            </View>
            <Meter value={pct(analysis.own[s.made], analysis.own[s.att])} color={colors.chartOwn} />
            <Text style={styles.shotOpp}>
              相手 {percent(pct(analysis.opp[s.made], analysis.opp[s.att]))}（{analysis.opp[s.made]}/{analysis.opp[s.att]}本）
            </Text>
          </View>
        ))}
        <Text style={styles.cardNote}>外したシュートを記録していない試合は、成功率が高く出ます</Text>
      </Card>

      <SectionTitle>全項目（{mode === 'avg' ? '1試合平均' : '合計'}）</SectionTitle>
      <Card style={styles.table}>
        <View style={[styles.tr, styles.trHead]}>
          <Text style={[styles.tdName, styles.th]}>項目</Text>
          <Text style={[styles.td, styles.th]}>自チーム</Text>
          <Text style={[styles.td, styles.th]}>相手</Text>
        </View>
        {STAT_COLUMNS.map((c) => (
          <View key={c.key} style={styles.tr}>
            <Text style={styles.tdName}>{c.name}</Text>
            <Text num style={styles.td}>
              {formatStat(c, statValue(c, analysis.own, n, mode), mode)}
            </Text>
            <Text num style={styles.td}>
              {formatStat(c, statValue(c, analysis.opp, n, mode), mode)}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
}

function PlayersView(props: {
  analysis: TeamAnalysis;
  mode: StatMode;
  range: DateRange;
  sortKey: string;
  onSort: (key: string) => void;
}) {
  const { analysis, mode, range, sortKey, onSort } = props;
  const router = useRouter();
  const sortCol = statColumn(sortKey);
  // 値の大きい順。成功率が出せない選手（試投なし）は最後に回す
  const value = (p: TeamAnalysis['players'][number]) => statValue(sortCol, p.line, p.games, mode) ?? -1;
  const players = [...analysis.players].sort((a, b) => value(b) - value(a) || b.line.pts - a.line.pts);

  return (
    <>
      <Text style={styles.cardNote}>
        見出しをタップすると、その項目の多い順に並びます。選手をタップすると詳細を開きます
      </Text>
      <StatTable
        rows={players.map((p) => ({
          key: p.key,
          games: p.games,
          line: p.line,
          lead: String(p.games),
          head: (
            <View style={styles.playerHead}>
              <Text num style={styles.playerNo}>
                {p.number}
              </Text>
              <Text style={styles.playerName} numberOfLines={1}>
                {p.name || '名前なし'}
              </Text>
            </View>
          ),
        }))}
        columns={STAT_COLUMNS}
        mode={mode}
        headLabel="選手"
        leadLabel="試合"
        sortKey={sortKey}
        onSort={onSort}
        onPressRow={(key) => router.push({ pathname: '/players/[key]', params: { key, range } })}
      />
      <Text style={styles.cardNote}>試合数は、出場登録された試合の数です</Text>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, paddingBottom: 32 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  label: { width: 34, fontSize: 12, fontWeight: '700', color: colors.sub },
  count: { fontSize: 13, fontWeight: '700', color: colors.sub },
  modes: { width: 190 },
  empty: { color: colors.sub, fontSize: 14, paddingVertical: 12 },
  chips: { flexGrow: 0 },
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
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerNo: { width: 24, fontSize: 22, color: colors.text, textAlign: 'right' },
  playerName: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.text },
});
