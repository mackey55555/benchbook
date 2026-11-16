import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { db } from '@/db/client';
import { cancelPeriodEnd, confirmPeriod, isPeriodEnded, recordMismatch } from '@/db/repo';
import {
  RULES,
  computeScore,
  computeScoreThrough,
  computeTeamFouls,
  periodLabel,
  remainingTimeouts,
} from '@/domain/rules';
import type { Side } from '@/domain/types';
import { Button } from '@/ui/components';
import { buildRunningScoreHtml } from '@/output/runningScoreHtml';
import { EventLogSheet } from '@/ui/EventLogSheet';
import { Text } from '@/ui/Text';
import { colors, fonts, sideColor } from '@/ui/theme';
import { TopSheet } from '@/ui/TopSheet';
import { attempt, useGame } from '@/ui/useGame';
import { showDialog } from '@/ui/dialog';

/** Q終了時の照合。オフィシャル席の公式記録と数字を突き合わせる（SPEC 5-5） */
export default function CheckScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const { bundle, reload } = useGame(gameId);
  const [logOpen, setLogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetHtml = useMemo(() => (bundle && sheetOpen ? buildRunningScoreHtml(bundle) : ''), [bundle, sheetOpen]);
  useKeepAwake();
  const { height } = useWindowDimensions();

  const status = bundle?.game.status;
  const period = bundle?.game.currentPeriod ?? 1;
  const ended = bundle ? isPeriodEnded(bundle.events, period) : false;
  useEffect(() => {
    if (status === 'prep') router.replace(`/games/${gameId}/prep`);
    else if (status === 'finished') router.replace(`/games/${gameId}`);
    else if (status === 'live' && !ended) router.replace(`/games/${gameId}/live`);
  }, [status, ended, gameId, router]);

  if (!bundle || status !== 'live' || !ended) return <View style={styles.screen} />;
  const { game, events } = bundle;
  const total = computeScoreThrough(events, period);
  const inPeriod = computeScore(events, period);

  const proceed = (endTied: boolean) => {
    let outcome: ReturnType<typeof confirmPeriod> | undefined;
    if (!attempt(() => (outcome = confirmPeriod(db, gameId, period, '', { endTied })))) return;
    router.replace(outcome === 'finished' ? `/games/${gameId}?finished=1` : `/games/${gameId}/live`);
  };

  // 第4Q以降が同点のときは、延長に進むか、同点のまま終えるかを選ぶ（引き分けのある大会・練習試合のため）
  const confirm = () => {
    const tied = period >= RULES.regulationPeriods && total.A === total.B;
    if (!tied) return proceed(false);
    showDialog(`${total.A} - ${total.B} の同点です`, 'どちらにしますか？', [
      { text: `延長（${periodLabel(period + 1)}）に進む`, onPress: () => proceed(false) },
      { text: '同点のまま試合終了', onPress: () => proceed(true) },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  };

  const fix = () => {
    recordMismatch(db, gameId, period);
    reload();
    setLogOpen(true);
  };

  const back = () =>
    showDialog('Q終了を取り消す', `${periodLabel(period)} の入力に戻ります。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '入力に戻る',
        onPress: () => {
          cancelPeriodEnd(db, gameId, period);
          router.replace(`/games/${gameId}/live`);
        },
      },
    ]);

  const column = (side: Side) => (
    <View style={styles.column}>
      <Text style={[styles.team, { color: sideColor(side) }]} numberOfLines={1}>
        {side} {(side === 'A' ? game.teamAName : game.teamBName) || `チーム${side}`}
      </Text>
      <Text style={[styles.score, { color: sideColor(side) }]}>{total[side]}</Text>
      <Text style={styles.sub}>
        {periodLabel(period)} の得点 {inPeriod[side]}
      </Text>
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>チームファウル</Text>
          <Text style={styles.statValue}>{computeTeamFouls(events, side, period)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>TO残数</Text>
          <Text style={styles.statValue}>{remainingTimeouts(events, side, period)}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>{periodLabel(period)} 終了　オフィシャルの記録と照合してください</Text>
      <View style={styles.body}>
        {column('A')}
        <View style={styles.actions}>
          <Button title="一致" variant="accent" onPress={confirm} style={styles.match} />
          <Button title="修正する" variant="secondary" onPress={fix} />
          <Button title="ランニングスコアを見る" variant="secondary" small onPress={() => setSheetOpen(true)} />
          <Button title="Q終了を取り消す" variant="ghost" small onPress={back} />
        </View>
        {column('B')}
      </View>
      <EventLogSheet
        visible={logOpen}
        bundle={bundle}
        period={period}
        onClose={() => setLogOpen(false)}
        onChanged={reload}
      />
      <TopSheet visible={sheetOpen} title="ランニングスコア（現在まで）" onClose={() => setSheetOpen(false)}>
        <View style={[styles.sheet, { height: height - 130 }]}>
          {sheetOpen && <WebView originWhitelist={['*']} source={{ html: sheetHtml }} style={styles.webview} />}
        </View>
      </TopSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.text, paddingVertical: 8 },
  body: { flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 12, paddingBottom: 8 },
  column: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  team: { fontSize: 17, fontWeight: '800' },
  score: { fontSize: 96, lineHeight: 98, fontFamily: fonts.num },
  sub: { fontSize: 14, color: colors.sub },
  stats: { flexDirection: 'row', gap: 20, marginTop: 8 },
  stat: { alignItems: 'center' },
  statLabel: { fontSize: 12, color: colors.sub },
  statValue: { fontSize: 40, lineHeight: 42, fontFamily: fonts.num, color: colors.text },
  actions: { width: 190, justifyContent: 'center', gap: 8 },
  match: { minHeight: 64 },
  sheet: { borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card },
  webview: { flex: 1, backgroundColor: colors.card },
});
