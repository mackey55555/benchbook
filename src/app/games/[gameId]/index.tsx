import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { WebView } from 'react-native-webview';

import { exportGame } from '@/db/backup';
import { db } from '@/db/client';
import { deleteGame, reopenGame } from '@/db/repo';
import { computeLineupStats, formatClock } from '@/domain/lineup';
import { RULES, activeEvents, computePeriodScores, computeScore, periodLabel } from '@/domain/rules';
import { buildBoxScore, describeEvent, type BoxScoreLine } from '@/domain/stats';
import type { Side } from '@/domain/types';
import { shareImage, shareJson, sharePdf } from '@/lib/share';
import { buildBoxScoreHtml } from '@/output/boxScoreHtml';
import { buildRunningScoreHtml } from '@/output/runningScoreHtml';
import { Button, Card, Chip, Row, Segmented } from '@/ui/components';
import { EventLogSheet } from '@/ui/EventLogSheet';
import { Text } from '@/ui/Text';
import { colors, fonts, sideColor } from '@/ui/theme';
import { attempt, useGame } from '@/ui/useGame';
import { showDialog } from '@/ui/dialog';

type Tab = 'running' | 'box' | 'plays' | 'periods';

const A4_RATIO = 297 / 210;

const BOX_COLUMNS: { key: string; label: string; value: (l: BoxScoreLine) => string }[] = [
  { key: 'pts', label: 'PTS', value: (l) => String(l.pts) },
  { key: 'fg2', label: '2PM-A', value: (l) => `${l.fg2m}-${l.fg2a}` },
  { key: 'fg3', label: '3PM-A', value: (l) => `${l.fg3m}-${l.fg3a}` },
  { key: 'ft', label: 'FTM-A', value: (l) => `${l.ftm}-${l.fta}` },
  { key: 'oreb', label: 'OREB', value: (l) => String(l.oreb) },
  { key: 'dreb', label: 'DREB', value: (l) => String(l.dreb) },
  { key: 'reb', label: 'REB', value: (l) => String(l.reb) },
  { key: 'ast', label: 'AST', value: (l) => String(l.ast) },
  { key: 'stl', label: 'STL', value: (l) => String(l.stl) },
  { key: 'blk', label: 'BLK', value: (l) => String(l.blk) },
  { key: 'tov', label: 'TOV', value: (l) => String(l.tov) },
  { key: 'pf', label: 'PF', value: (l) => String(l.pf) },
];

export default function GameDetailScreen() {
  const { gameId, finished } = useLocalSearchParams<{ gameId: string; finished?: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { bundle, reload } = useGame(gameId);
  const [tab, setTab] = useState<Tab>('running');
  const [boxSide, setBoxSide] = useState<Side>('A');
  const [periodFilter, setPeriodFilter] = useState<number | 'all'>('all');
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef<ComponentRef<typeof View>>(null);
  const promptedRef = useRef(false);

  const html = useMemo(() => (bundle ? buildRunningScoreHtml(bundle) : ''), [bundle]);
  const boxHtml = useMemo(() => (bundle ? buildBoxScoreHtml(bundle) : ''), [bundle]);
  const baseName = bundle
    ? `${bundle.game.date}_${bundle.game.teamAName || 'A'}_vs_${bundle.game.teamBName || 'B'}`
    : 'benchbook';

  const share = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showDialog('共有できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const shareBackup = () => share(() => shareJson(exportGame(db, gameId), baseName));

  // 試合終了直後はバックアップの書き出しを促す（SPEC 7章）
  useEffect(() => {
    if (finished !== '1' || promptedRef.current || !bundle) return;
    promptedRef.current = true;
    showDialog('試合終了', 'お疲れさまでした。バックアップ（JSON）を書き出しますか？', [
      { text: 'あとで', style: 'cancel' },
      { text: '書き出す', onPress: () => void shareBackup() },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 終了直後に一度だけ
  }, [finished, bundle]);

  if (!bundle) return null;
  const { game, events, roster, checks } = bundle;
  const total = computeScore(events);
  const maxPeriod = Math.max(game.currentPeriod, RULES.regulationPeriods);
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);
  const filterPeriod = periodFilter === 'all' ? undefined : periodFilter;

  const periodChips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
      <Row>
        <Chip label="すべて" active={periodFilter === 'all'} onPress={() => setPeriodFilter('all')} />
        {periods.map((p) => (
          <Chip key={p} label={periodLabel(p)} active={periodFilter === p} onPress={() => setPeriodFilter(p)} />
        ))}
      </Row>
    </ScrollView>
  );

  // A4のシート（HTML）を表示し、PDF・画像で共有する。ランニングスコアとボックススコアで共用
  const sheet = (sheetHtml: string, name: string, withJson: boolean) => {
    const sheetWidth = width - 24;
    return (
      <>
        <Row>
          <Button title="PDF" small variant="secondary" disabled={busy} onPress={() => share(() => sharePdf(sheetHtml, name))} />
          <Button
            title="画像"
            small
            variant="secondary"
            disabled={busy}
            onPress={() =>
              share(async () => shareImage(await captureRef(sheetRef, { format: 'png', quality: 1 })))
            }
          />
          {withJson && <Button title="JSON" small variant="secondary" disabled={busy} onPress={shareBackup} />}
        </Row>
        <View
          ref={sheetRef}
          collapsable={false}
          style={[styles.sheet, { width: sheetWidth, height: sheetWidth * A4_RATIO }]}
        >
          <WebView originWhitelist={['*']} source={{ html: sheetHtml }} style={styles.webview} scrollEnabled={false} />
        </View>
        <Text style={styles.note}>拡大して見るときはPDFで共有してください</Text>
      </>
    );
  };

  const running = () => <View style={styles.tabBody}>{sheet(html, baseName, true)}</View>;

  const box = () => {
    const team = buildBoxScore(events, roster, filterPeriod)[boxSide];
    // 出場時間と +/- は試合全体の値なので、Qで絞り込んでいないときだけ出す
    const lineup =
      filterPeriod === undefined
        ? computeLineupStats(events, roster, { ...game, finished: game.status === 'finished' })
        : null;
    const lineupCells = (rosterId: string | null) => {
      if (!lineup) return null;
      const stat = rosterId ? lineup.get(rosterId) : undefined;
      return (
        <>
          <Text style={styles.td}>{stat ? `${stat.approximate ? '約' : ''}${formatClock(stat.seconds)}` : ''}</Text>
          <Text style={styles.td}>{stat ? `${stat.plusMinus > 0 ? '+' : ''}${stat.plusMinus}` : ''}</Text>
        </>
      );
    };
    const line = (l: BoxScoreLine, isTotal = false) => (
      <View key={l.rosterId ?? 'total'} style={[styles.tr, isTotal && styles.trTotal]}>
        <Text style={[styles.td, styles.tdNo]}>{isTotal ? '' : l.number}</Text>
        <Text style={[styles.td, styles.tdName]} numberOfLines={1}>
          {isTotal ? '合計' : l.name}
        </Text>
        {BOX_COLUMNS.map((c) => (
          <Text key={c.key} style={[styles.td, isTotal && styles.bold]}>
            {c.value(l)}
          </Text>
        ))}
        {lineupCells(isTotal ? null : l.rosterId)}
      </View>
    );
    return (
      <View style={styles.tabBody}>
        {sheet(boxHtml, `${baseName}_boxscore`, false)}
        <Text style={styles.subTitle}>Q別に見る</Text>
        <Segmented
          options={[
            { value: 'A', label: `A ${game.teamAName}` },
            { value: 'B', label: `B ${game.teamBName}` },
          ]}
          value={boxSide}
          onChange={setBoxSide}
        />
        {periodChips}
        <ScrollView horizontal>
          <View>
            <View style={[styles.tr, styles.trHead]}>
              <Text style={[styles.td, styles.tdNo, styles.th]}>No.</Text>
              <Text style={[styles.td, styles.tdName, styles.th]}>選手</Text>
              {BOX_COLUMNS.map((c) => (
                <Text key={c.key} style={[styles.td, styles.th]}>
                  {c.label}
                </Text>
              ))}
              {lineup && (
                <>
                  <Text style={[styles.td, styles.th]}>MIN</Text>
                  <Text style={[styles.td, styles.th]}>+/-</Text>
                </>
              )}
            </View>
            {team.players.map((l) => line(l))}
            {line(team.total, true)}
          </View>
        </ScrollView>
      </View>
    );
  };

  const plays = () => {
    const list = activeEvents(events).filter(
      (e) => e.type !== 'L2M' && (filterPeriod === undefined || e.period === filterPeriod),
    );
    return (
      <View style={styles.tabBody}>
        {periodChips}
        <Button title="記録を修正・削除する" variant="secondary" small onPress={() => setLogOpen(true)} />
        {list.length === 0 && <Text style={styles.note}>記録がありません</Text>}
        {list.map((e, i) => (
          <Row key={e.id} style={styles.play}>
            <Text style={styles.playNo}>{i + 1}</Text>
            <Text style={styles.playPeriod}>{periodLabel(e.period)}</Text>
            <Text style={[styles.playText, e.side && { color: sideColor(e.side) }]}>
              {describeEvent(e, roster)}
            </Text>
          </Row>
        ))}
      </View>
    );
  };

  const periodScores = () => {
    const rows = computePeriodScores(events, maxPeriod);
    return (
      <View style={styles.tabBody}>
        <Card>
          <View style={[styles.tr, styles.trHead]}>
            <Text style={[styles.td, styles.tdName, styles.th]}>チーム</Text>
            {rows.map((r) => (
              <Text key={r.period} style={[styles.td, styles.th]}>
                {periodLabel(r.period)}
              </Text>
            ))}
            <Text style={[styles.td, styles.th]}>計</Text>
          </View>
          {(['A', 'B'] as const).map((side) => (
            <View key={side} style={styles.tr}>
              <Text style={[styles.td, styles.tdName, { color: sideColor(side) }]} numberOfLines={1}>
                {(side === 'A' ? game.teamAName : game.teamBName) || side}
              </Text>
              {rows.map((r) => (
                <Text key={r.period} style={styles.td}>
                  {r.score[side]}
                </Text>
              ))}
              <Text style={[styles.td, styles.bold]}>{total[side]}</Text>
            </View>
          ))}
        </Card>
        <Text style={styles.note}>
          照合：
          {rows
            .map((r) => {
              const check = checks.find((c) => c.period === r.period);
              return `${periodLabel(r.period)} ${check ? (check.matched ? '一致' : '不一致') : '未'}`;
            })
            .join('　')}
        </Text>
      </View>
    );
  };

  const confirmDelete = () =>
    showDialog('試合を削除', 'この試合の記録をすべて削除します。元に戻せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: () => {
          deleteGame(db, gameId);
          router.back();
        },
      },
    ]);

  const confirmReopen = () =>
    showDialog('試合を再開', `${periodLabel(game.currentPeriod)} の入力に戻ります。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '再開する',
        onPress: () => {
          if (attempt(() => reopenGame(db, gameId))) router.replace(`/games/${gameId}/live`);
        },
      },
    ]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: game.date }} />
      <View style={styles.header}>
        <Text style={styles.meta}>
          {[game.leagueName, game.venue].filter(Boolean).join('　') || ' '}
        </Text>
        <Row style={styles.scoreRow}>
          <Text style={[styles.teamName, { color: sideColor('A') }]} numberOfLines={2}>
            {game.teamAName || 'A'}
          </Text>
          <Text style={styles.score}>
            {total.A} - {total.B}
          </Text>
          <Text style={[styles.teamName, { color: sideColor('B') }]} numberOfLines={2}>
            {game.teamBName || 'B'}
          </Text>
        </Row>
      </View>

      <Segmented
        options={[
          { value: 'running', label: 'ランニング' },
          { value: 'box', label: 'ボックス' },
          { value: 'plays', label: 'プレー' },
          { value: 'periods', label: 'Q別' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'running' && running()}
      {tab === 'box' && box()}
      {tab === 'plays' && plays()}
      {tab === 'periods' && periodScores()}

      <View style={styles.footer}>
        {game.status === 'finished' && (
          <Button title="誤って終了した試合を再開する" variant="ghost" small onPress={confirmReopen} />
        )}
        <Button title="この試合を削除" variant="ghost" small onPress={confirmDelete} />
      </View>

      <EventLogSheet
        visible={logOpen}
        bundle={bundle}
        period={filterPeriod}
        onClose={() => setLogOpen(false)}
        onChanged={reload}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, gap: 10, paddingBottom: 60 },
  header: { alignItems: 'center', gap: 2 },
  meta: { fontSize: 12, color: colors.sub },
  scoreRow: { gap: 10 },
  teamName: { flex: 1, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  score: { fontSize: 44, lineHeight: 46, fontFamily: fonts.num, color: colors.text },
  tabBody: { gap: 10 },
  filters: { flexGrow: 0 },
  sheet: { backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  webview: { flex: 1, backgroundColor: '#fff' },
  note: { fontSize: 12, color: colors.sub },
  subTitle: { fontSize: 13, fontWeight: '700', color: colors.sub, marginTop: 8 },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.card,
  },
  trHead: { backgroundColor: colors.disabledBg },
  trTotal: { backgroundColor: colors.disabledBg },
  td: { width: 54, textAlign: 'center', fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] },
  th: { fontSize: 11, fontWeight: '700', color: colors.sub },
  tdNo: { width: 34, fontWeight: '700' },
  tdName: { width: 96, textAlign: 'left', paddingLeft: 6 },
  bold: { fontWeight: '800' },
  play: {
    minHeight: 36,
    paddingHorizontal: 10,
    backgroundColor: colors.card,
    borderRadius: 8,
  },
  playNo: { width: 30, fontSize: 12, color: colors.sub, fontVariant: ['tabular-nums'] },
  playPeriod: { width: 36, fontSize: 12, fontWeight: '700', color: colors.sub },
  playText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  footer: { marginTop: 24, gap: 4 },
});
