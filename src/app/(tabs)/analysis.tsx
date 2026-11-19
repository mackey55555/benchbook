import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DATE_RANGE_LABELS,
  STAT_COLUMNS,
  TEAM_STAT_COLUMNS,
  formatStat,
  pct,
  perGame,
  statColumn,
  statValue,
  type DateRange,
  type StatMode,
  type TeamAnalysis,
} from '@/domain/analysis';
import { formatClock } from '@/domain/lineup';
import { periodLabel } from '@/domain/rules';
import { sharePdf } from '@/lib/share';
import { buildFullReportHtml, buildPlayersReportHtml, buildTeamReportHtml } from '@/output/analysisHtml';
import { GroupedBars, Legend, Meter } from '@/ui/charts';
import { Button, Card, Chip, Row, SectionTitle, Segmented } from '@/ui/components';
import { showDialog } from '@/ui/dialog';
import { HelpButton } from '@/ui/HelpButton';
import { ShareSheet } from '@/ui/ShareSheet';
import { StatTable } from '@/ui/StatTable';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';
import { paywallEnabled } from '@/sync/client';
import { FREE_ANALYSIS_GAMES, useAnalysis, useAnalysisLimit } from '@/ui/useAnalysis';

/** 推移グラフに出す試合数（新しいほうから） */
const TREND_GAMES = 10;
/** 推移グラフで選べる項目 */
const TREND_KEYS = ['pts', 'fg3m', 'fg3p', 'fg2p', 'ftp', 'pf', 'reb', 'tov', 'ast', 'stl', 'blk'];

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
// 40分換算は選手の比較にだけ出す（チームは1試合がほぼ40分なので、平均と変わらない）
const PLAYER_MODES: { value: StatMode; label: string }[] = [...MODES, { value: 'per40', label: '40分換算' }];
/** 5人の組み合わせを出す行数 */
const UNIT_ROWS = 8;
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
  // チームの画面には40分換算が無いので、選手の画面で選んでいたら1試合平均で見せる
  const teamMode: StatMode = mode === 'per40' ? 'avg' : mode;
  const [sortKey, setSortKey] = useState('pts');
  const [shareOpen, setShareOpen] = useState(false);
  const analysis = useAnalysis(range);
  const limit = useAnalysisLimit();
  const router = useRouter();
  const rangeLabel = limit.limited ? `直近${FREE_ANALYSIS_GAMES}試合` : DATE_RANGE_LABELS[range];

  // 共有用のシートは、いま見ている軸・期間・平均／合計・並び順で作る
  const shareHtml = useMemo(() => {
    if (!shareOpen) return '';
    const options = { rangeLabel, mode };
    return axis === 'team'
      ? buildTeamReportHtml(analysis, options)
      : buildPlayersReportHtml(analysis, { ...options, sortKey });
  }, [shareOpen, axis, analysis, rangeLabel, mode, sortKey]);
  const [exporting, setExporting] = useState(false);

  // 期間の全内容（チーム成績・選手の比較表・選手1人ずつのまとめ）を1つのPDFにして共有する
  const exportAll = async () => {
    setExporting(true);
    try {
      const html = buildFullReportHtml(analysis, { rangeLabel, mode, sortKey });
      await sharePdf(html, `${analysis.teamName || 'benchbook'}_成績まとめ_${rangeLabel}`);
    } catch (e) {
      showDialog('出力できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const shareMenu = () =>
    showDialog('共有', `期間：${rangeLabel}（${analysis.games}試合）`, [
      { text: axis === 'team' ? 'チーム成績を共有' : '選手の比較表を共有', onPress: () => setShareOpen(true) },
      // 全内容のまとめPDFは、チームプランの機能
      ...(limit.limited ? [] : [{ text: '全内容を1つのPDFで出力', onPress: () => void exportAll() }]),
      { text: 'キャンセル', style: 'cancel' },
    ]);

  const shareName = `${analysis.teamName || 'benchbook'}_${axis === 'team' ? 'チーム成績' : '選手成績'}_${rangeLabel}`;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
    >
      <Row>
        <Text style={[styles.title, styles.flex]}>分析</Text>
        <HelpButton topic="analysis" />
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
      {!limit.limited && (
        <Row>
          <Text style={styles.label}>期間</Text>
          {RANGES.map((r) => (
            <Chip key={r} label={DATE_RANGE_LABELS[r]} active={range === r} onPress={() => setRange(r)} />
          ))}
        </Row>
      )}

      {analysis.games === 0 ? (
        <Text style={styles.empty}>
          {range === 'all' || limit.limited
            ? '終了した試合がまだありません。試合を記録すると、ここに成績が出ます'
            : 'この期間に終了した試合がありません'}
        </Text>
      ) : (
        <>
          <Row>
            <Text style={styles.count}>
              {limit.limited ? `直近${analysis.games}試合の成績` : `${analysis.games}試合の成績`}
            </Text>
            <View style={styles.flex} />
            <Segmented
              options={axis === 'players' ? PLAYER_MODES : MODES}
              value={axis === 'players' ? mode : teamMode}
              onChange={setMode}
              style={axis === 'players' ? styles.modesWide : styles.modes}
            />
          </Row>
          {axis === 'team' ? (
            <TeamView key={range} analysis={analysis} mode={teamMode} />
          ) : (
            <PlayersView
              analysis={analysis}
              mode={mode}
              range={range}
              sortKey={sortKey}
              onSort={setSortKey}
              locked={limit.limited}
            />
          )}
          {limit.limited ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>
                無料で見られるのは、直近{FREE_ANALYSIS_GAMES}試合の分析です
                {limit.totalGames > FREE_ANALYSIS_GAMES ? `（記録は${limit.totalGames}試合あります）` : ''}
              </Text>
              <Text style={styles.noticeBody}>
                チームプランでは、シーズンを通した分析、選手ごとのページ、全内容のまとめPDFが使えて、メンバー全員が同じ成績を見られます。試合の記録と、試合ごとのスコアシートの共有は、無料のまま使えます。
              </Text>
              <Button title="チームプランを見る" small onPress={() => router.push('/team')} />
            </View>
          ) : (
            !paywallEnabled && (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>分析は、いまはすべて無料で使えます</Text>
                <Text style={styles.noticeBody}>
                  今後チームプラン（有料）を始めたあとは、無料で見られる分析は直近3試合までになる予定です。試合の記録と、試合ごとのスコアシートの共有は、その後も無料で使えます。
                </Text>
              </View>
            )
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

      <SectionTitle>時間帯別の平均得点</SectionTitle>
      <Card>
        {analysis.timedGames > 0 ? (
          <>
            <View style={styles.cardHead}>
              <Text style={styles.cardNote}>時計を使った{analysis.timedGames}試合の平均</Text>
              <Legend items={LEGEND} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.bands}>
                <GroupedBars
                  groups={analysis.bands.map((b) => ({
                    key: b.key,
                    label: b.label.replace(' 前半', '前').replace(' 後半', '後').replace(' 残り2分', '終盤'),
                    own: Math.round((b.own / analysis.timedGames) * 10) / 10,
                    opp: Math.round((b.opp / analysis.timedGames) * 10) / 10,
                  }))}
                  height={120}
                  showValues
                  format={(v) => (Number.isInteger(v) ? String(v) : one(v))}
                />
              </View>
            </ScrollView>
            <Text style={styles.cardNote}>各Qを前半・後半に分けた得点です。「Q4終盤」は残り2分（Q4後の内数）</Text>
          </>
        ) : (
          <Text style={styles.cardNote}>
            試合中に時計を動かすと、Qの前半・後半や終盤の得点がここに出ます（4つのQすべてで時計を使った試合が対象）
          </Text>
        )}
      </Card>

      <SectionTitle>5人の組み合わせ</SectionTitle>
      <Card style={styles.table}>
        {analysis.units.length > 0 ? (
          <>
            <View style={[styles.tr, styles.trHead]}>
              <Text style={[styles.tdUnit, styles.th]}>コート上の5人</Text>
              <Text style={[styles.tdSmall, styles.th]}>MIN</Text>
              <Text style={[styles.tdSmall, styles.th]}>得点</Text>
              <Text style={[styles.tdSmall, styles.th]}>失点</Text>
              <Text style={[styles.tdSmall, styles.th]}>+/-</Text>
            </View>
            {analysis.units.slice(0, UNIT_ROWS).map((u) => {
              const pm = u.pointsFor - u.pointsAgainst;
              return (
                <View key={u.key} style={styles.tr}>
                  <Text num style={styles.tdUnit} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {u.numbers.map((no) => `#${no}`).join(' ')}
                  </Text>
                  <Text num style={styles.tdSmall}>
                    {u.approximate ? '約' : ''}
                    {formatClock(u.seconds)}
                  </Text>
                  <Text num style={styles.tdSmall}>{u.pointsFor}</Text>
                  <Text num style={styles.tdSmall}>{u.pointsAgainst}</Text>
                  <Text num style={[styles.tdSmall, styles.bold]}>
                    {pm > 0 ? '+' : ''}
                    {pm}
                  </Text>
                </View>
              );
            })}
            <Text style={[styles.cardNote, styles.unitNote]}>
              出場時間の長い順（期間の合計）。先発と交代を記録した試合の分です
            </Text>
          </>
        ) : (
          <Text style={[styles.cardNote, styles.unitNote]}>
            先発を選んで交代を記録すると、どの5人のときに点差が開いたかがここに出ます
          </Text>
        )}
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
        {TEAM_STAT_COLUMNS.map((c) => (
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
  /** 無料の範囲のとき。選手ごとのページは開かない */
  locked: boolean;
}) {
  const { analysis, mode, range, sortKey, onSort, locked } = props;
  const router = useRouter();
  const sortCol = statColumn(sortKey);
  // 値の大きい順。成功率が出せない選手（試投なし）は最後に回す
  const value = (p: TeamAnalysis['players'][number]) => statValue(sortCol, p.line, p.games, mode) ?? -1;
  const players = [...analysis.players].sort((a, b) => value(b) - value(a) || b.line.pts - a.line.pts);

  return (
    <>
      <Text style={styles.cardNote}>
        見出しをタップすると、その項目の多い順に並びます。
        {locked ? '選手ごとのページは、チームプランで使えます' : '選手をタップすると詳細を開きます'}
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
        onPressRow={(key) =>
          locked
            ? showDialog('選手ごとのページ', '試合ごとの推移や成功率をまとめた選手のページは、チームプランで使えます。', [
                { text: '閉じる', style: 'cancel' },
                { text: 'チームプランを見る', onPress: () => router.push('/team') },
              ])
            : router.push({ pathname: '/players/[key]', params: { key, range } })
        }
      />
      <Text style={styles.cardNote}>
        試合数は、出場登録された試合の数です。MIN（出場時間）と +/- は、先発と交代を記録した試合の分だけを集計します
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, paddingBottom: 32 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  label: { width: 34, fontSize: 12, fontWeight: '700', color: colors.sub },
  count: { fontSize: 13, fontWeight: '700', color: colors.sub },
  bands: { minWidth: 560 },
  tdUnit: { flex: 1, minWidth: 0, fontSize: 15, color: colors.text, paddingLeft: 12 },
  tdSmall: { width: 52, textAlign: 'center', fontSize: 14, color: colors.text },
  bold: { fontWeight: '800' },
  unitNote: { padding: 12 },
  modes: { width: 190 },
  modesWide: { width: 270 },
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
  notice: { backgroundColor: colors.accentBg, borderRadius: radius.lg, padding: 14, gap: 4, marginTop: 8 },
  noticeTitle: { fontSize: 13, fontWeight: '800', color: colors.accentInk },
  noticeBody: { fontSize: 12, lineHeight: 18, color: colors.accentInk },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerNo: { width: 24, fontSize: 22, color: colors.text, textAlign: 'right' },
  playerName: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.text },
});
