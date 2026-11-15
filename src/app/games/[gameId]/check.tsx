import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { cancelPeriodEnd, confirmPeriod, isPeriodEnded, recordMismatch } from '@/db/repo';
import {
  computeScore,
  computeScoreThrough,
  computeTeamFouls,
  periodLabel,
  remainingTimeouts,
} from '@/domain/rules';
import type { Side } from '@/domain/types';
import { Button } from '@/ui/components';
import { EventLogSheet } from '@/ui/EventLogSheet';
import { colors, sideColor } from '@/ui/theme';
import { attempt, useGame } from '@/ui/useGame';

/** Q終了時の照合。オフィシャル席の公式記録と数字を突き合わせる（SPEC 5-5） */
export default function CheckScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const { bundle, reload } = useGame(gameId);
  const [logOpen, setLogOpen] = useState(false);
  useKeepAwake();

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

  const confirm = () => {
    let outcome: ReturnType<typeof confirmPeriod> | undefined;
    if (!attempt(() => (outcome = confirmPeriod(db, gameId, period)))) return;
    if (outcome === 'finished') {
      router.replace(`/games/${gameId}?finished=1`);
    } else if (outcome === 'overtime') {
      Alert.alert('同点のため延長', `${periodLabel(period + 1)} を開始します。`, [
        { text: 'OK', onPress: () => router.replace(`/games/${gameId}/live`) },
      ]);
    } else {
      router.replace(`/games/${gameId}/live`);
    }
  };

  const fix = () => {
    recordMismatch(db, gameId, period);
    reload();
    setLogOpen(true);
  };

  const back = () =>
    Alert.alert('Q終了を取り消す', `${periodLabel(period)} の入力に戻ります。`, [
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
          <Button title="一致" onPress={confirm} style={styles.match} />
          <Button title="修正する" variant="secondary" onPress={fix} />
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
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  team: { fontSize: 17, fontWeight: '800' },
  score: { fontSize: 84, lineHeight: 92, fontWeight: '900', fontVariant: ['tabular-nums'] },
  sub: { fontSize: 14, color: colors.sub },
  stats: { flexDirection: 'row', gap: 20, marginTop: 8 },
  stat: { alignItems: 'center' },
  statLabel: { fontSize: 12, color: colors.sub },
  statValue: { fontSize: 36, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  actions: { width: 170, justifyContent: 'center', gap: 12 },
  match: { minHeight: 72 },
});
