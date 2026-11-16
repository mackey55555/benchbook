import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { AppState, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { createGame, getLiveGame, listGames } from '@/db/repo';
import { periodLabel } from '@/domain/rules';
import { applyUpdate, checkForUpdate, useUpdateState } from '@/ui/appUpdate';
import { Button, SectionTitle } from '@/ui/components';
import { GameRow, useOpenGame } from '@/ui/GameRow';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';
import { useRefresh } from '@/ui/useGame';

// 起動直後に一度だけ、進行中の試合へ直接戻る（SPEC 7章）
let resumedOnLaunch = false;
/** ホームに出す試合の数。それ以前は「試合」タブで見る */
const RECENT_COUNT = 5;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [version, refresh] = useRefresh();
  const update = useUpdateState();
  const openGame = useOpenGame();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  const games = useMemo(() => listGames(db), [version]);
  const live = games.find((g) => g.game.status === 'live');
  const recent = games.slice(0, RECENT_COUNT);

  useFocusEffect(
    useCallback(() => {
      const current = getLiveGame(db);
      if (current && !resumedOnLaunch) {
        resumedOnLaunch = true;
        openGame(current);
        return;
      }
      resumedOnLaunch = true;
      // 更新があれば取得まで済ませ、上部に案内を出す。進行中の試合があるときは確認しない（SPEC 7章）
      const autoCheck = () => {
        if (!getLiveGame(db)) void checkForUpdate(false);
      };
      autoCheck();
      // ホームを開いたままアプリに戻ったときも確認する
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') autoCheck();
      });
      return () => sub.remove();
    }, [openGame]),
  );

  const newGame = () => {
    const game = createGame(db);
    router.push(`/games/${game.id}/prep`);
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
    >
      <View style={styles.header}>
        <Image source={require('../../../assets/mark.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        <Text style={styles.wordmark}>Benchbook</Text>
      </View>

      {update.ready && (
        <View style={styles.update}>
          <View style={styles.flex}>
            <Text style={styles.updateTitle}>最新版があります</Text>
            <Text style={styles.updateBody}>
              {live ? '試合が終わってから更新してください' : '記録したデータはそのまま残ります'}
            </Text>
          </View>
          {!live && (
            <Button
              title={update.applying ? '更新中…' : '更新する'}
              small
              disabled={update.applying}
              onPress={() => void applyUpdate()}
            />
          )}
        </View>
      )}

      {live && (
        <View style={styles.resume}>
          <View style={styles.resumeTop}>
            <View style={styles.dot} />
            <Text style={styles.resumeLabel}>進行中の試合</Text>
            <Text style={styles.resumePeriod}>{periodLabel(live.game.currentPeriod)}</Text>
          </View>
          <View style={styles.resumeScores}>
            <View style={styles.flex}>
              <Text style={styles.resumeTeam} numberOfLines={1}>
                {live.game.teamAName || 'チームA'}
              </Text>
              <Text num style={styles.resumeScore}>
                {live.score.A}
              </Text>
            </View>
            <Text num style={styles.resumeSep}>
              -
            </Text>
            <View style={[styles.flex, styles.right]}>
              <Text style={styles.resumeTeam} numberOfLines={1}>
                {live.game.teamBName || 'チームB'}
              </Text>
              <Text num style={styles.resumeScore}>
                {live.score.B}
              </Text>
            </View>
          </View>
          <Button title="入力に戻る" variant="accent" onPress={() => openGame(live.game)} />
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="新規試合"
        onPress={newGame}
        style={({ pressed }) => [styles.newGame, pressed && styles.pressed]}
      >
        <View style={styles.newGameIcon}>
          <Ionicons name="add" size={26} color={colors.text} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.newGameTitle}>新規試合</Text>
          <Text style={styles.newGameBody}>メンバーを登録して記録を始める</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.sub} />
      </Pressable>

      <View style={styles.listHead}>
        <SectionTitle>直近の試合</SectionTitle>
        {games.length > RECENT_COUNT && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate('/games')}
            hitSlop={12}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={styles.more}>すべて見る（{games.length}）</Text>
          </Pressable>
        )}
      </View>
      {games.length === 0 && <Text style={styles.empty}>まだ試合がありません。「新規試合」から始めましょう</Text>}
      {recent.map((row) => (
        <GameRow key={row.game.id} row={row} onChanged={refresh} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14, paddingBottom: 32 },
  flex: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  pressed: { opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  mark: { width: 36, height: 36, borderRadius: 10 },
  wordmark: { fontSize: 26, fontWeight: '800', color: colors.text },
  update: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.accentBg,
    borderRadius: radius.lg,
    padding: 16,
  },
  updateTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  updateBody: { fontSize: 12, color: colors.sub },
  resume: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: 20, gap: 12 },
  resumeTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  resumeLabel: { flex: 1, color: colors.onInkAccent, fontSize: 13, fontWeight: '700' },
  resumePeriod: {
    color: colors.primaryText,
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: colors.inkSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  resumeScores: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resumeTeam: { color: colors.primaryText, fontSize: 14, fontWeight: '700' },
  resumeScore: { color: colors.primaryText, fontSize: 60, lineHeight: 64 },
  resumeSep: { color: colors.onInkMute, fontSize: 30 },
  newGame: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    minHeight: 76,
  },
  newGameIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newGameTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  newGameBody: { fontSize: 12, color: colors.sub },
  listHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  more: { fontSize: 13, fontWeight: '700', color: colors.text, textDecorationLine: 'underline' },
  empty: { color: colors.sub, fontSize: 14, paddingVertical: 12 },
});
