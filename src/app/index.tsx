import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback, useMemo, useState } from 'react';
import { AppState, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { createGame, deleteGame, getLiveGame, isPeriodEnded, listEvents, listGames } from '@/db/repo';
import type { Game } from '@/db/schema';
import { periodLabel } from '@/domain/rules';
import { Button, Card, SectionTitle } from '@/ui/components';
import { Text } from '@/ui/Text';
import { showDialog } from '@/ui/dialog';
import { colors, radius } from '@/ui/theme';
import { useRefresh } from '@/ui/useGame';

// 開発ビルド・Expo Go では expo-updates が無効で、確認APIは reject される
const canCheckUpdate = Updates.isEnabled && !__DEV__;

// 起動直後に一度だけ、進行中の試合へ直接戻る（SPEC 7章）
let resumedOnLaunch = false;
// OTAの自動確認は、ホームを開いたとき・アプリに戻ったときに行う。通信を繰り返さないよう間隔を空ける
const AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let lastAutoCheckAt = 0;
// 取得済みの更新（再読み込みで適用できる）。画面を行き来しても案内を出し続ける
let updateReady = false;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [version, refresh] = useRefresh();
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(updateReady);
  const [applying, setApplying] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  const games = useMemo(() => listGames(db), [version]);
  const live = games.find((g) => g.game.status === 'live');

  const openGame = useCallback(
    (game: Game, replace = false) => {
      const go = replace ? router.replace : router.push;
      if (game.status === 'prep') go(`/games/${game.id}/prep`);
      else if (game.status === 'finished') go(`/games/${game.id}`);
      else if (isPeriodEnded(listEvents(db, game.id), game.currentPeriod)) go(`/games/${game.id}/check`);
      else go(`/games/${game.id}/live`);
    },
    [router],
  );

  // 更新があれば取得まで済ませ、ホーム上部に案内を出す。適用は利用者が「更新する」を押したとき。
  // 進行中の試合があるときは確認しない（SPEC 7章）
  const checkForUpdate = useCallback(async (manual: boolean) => {
    if (!canCheckUpdate) return;
    setBusy(true);
    if (manual) setUpdateStatus('更新を確認中…');
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        if (manual) setUpdateStatus('最新です');
        return;
      }
      setUpdateStatus('更新をダウンロード中…');
      await Updates.fetchUpdateAsync();
      updateReady = true;
      setReady(true);
      setUpdateStatus(null);
    } catch (e) {
      // オフラインでも全機能が動くこと。自動確認の失敗は黙って無視する
      if (manual) setUpdateStatus(`確認できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const current = getLiveGame(db);
      if (current && !resumedOnLaunch) {
        resumedOnLaunch = true;
        openGame(current);
        return;
      }
      resumedOnLaunch = true;
      const autoCheck = () => {
        if (updateReady || getLiveGame(db)) return;
        if (Date.now() - lastAutoCheckAt < AUTO_CHECK_INTERVAL_MS) return;
        lastAutoCheckAt = Date.now();
        void checkForUpdate(false);
      };
      autoCheck();
      // ホームを開いたままアプリに戻ったときも確認する
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') autoCheck();
      });
      return () => sub.remove();
    }, [openGame, checkForUpdate]),
  );

  const applyUpdate = async () => {
    setApplying(true);
    try {
      await Updates.reloadAsync();
    } catch (e) {
      setApplying(false);
      setUpdateStatus(`更新できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 一覧の長押しで、間違って作った試合などを消せる
  const gameMenu = (game: Game) =>
    showDialog(`${game.teamAName || 'A'} vs ${game.teamBName || 'B'}`, game.date, [
      { text: '開く', onPress: () => openGame(game) },
      {
        text: 'この試合を削除',
        style: 'destructive',
        onPress: () =>
          showDialog('試合を削除', 'この試合の記録をすべて削除します。元に戻せません。', [
            { text: 'キャンセル', style: 'cancel' },
            {
              text: '削除',
              style: 'destructive',
              onPress: () => {
                deleteGame(db, game.id);
                refresh();
              },
            },
          ]),
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);

  const newGame = () => {
    const game = createGame(db);
    router.push(`/games/${game.id}/prep`);
  };

  const badge = ({ game, score }: (typeof games)[number]) => {
    if (game.status === 'prep') return { label: '準備', bg: colors.accentBg, fg: colors.accentInk };
    if (game.status === 'live') return { label: '試合中', bg: colors.accent, fg: colors.accentText };
    if (score.A === score.B) return { label: '引分', bg: colors.disabledBg, fg: colors.mute };
    const other = game.ownSide === 'A' ? 'B' : 'A';
    return score[game.ownSide] > score[other]
      ? { label: '勝ち', bg: colors.okBg, fg: colors.ok }
      : { label: '負け', bg: colors.disabledBg, fg: colors.mute };
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}
    >
      <View style={styles.header}>
        <Image source={require('../../assets/mark.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        <Text style={styles.wordmark}>Benchbook</Text>
      </View>

      {ready && (
        <View style={styles.update}>
          <View style={styles.flex}>
            <Text style={styles.updateTitle}>最新版があります</Text>
            <Text style={styles.updateBody}>
              {live ? '試合が終わってから更新してください' : '記録したデータはそのまま残ります'}
            </Text>
          </View>
          {!live && (
            <Button title={applying ? '更新中…' : '更新する'} small disabled={applying} onPress={() => void applyUpdate()} />
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

      <View style={styles.tiles}>
        {(
          [
            { label: '新規試合', icon: 'add', bg: colors.accentBg, onPress: newGame },
            { label: 'チーム', icon: 'people-outline', bg: colors.teamABg, onPress: () => router.push('/teams') },
            { label: 'バックアップ', icon: 'share-outline', bg: colors.teamBBg, onPress: () => router.push('/backup') },
          ] as const
        ).map((t) => (
          <Pressable
            key={t.label}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            onPress={t.onPress}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.6 }]}
          >
            <View style={[styles.tileIcon, { backgroundColor: t.bg }]}>
              <Ionicons name={t.icon} size={22} color={colors.text} />
            </View>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.listHead}>
        <SectionTitle>これまでの試合</SectionTitle>
        {games.length > 0 && <Text style={styles.listHint}>長押しで削除</Text>}
      </View>
      {games.length === 0 && (
        <Text style={styles.empty}>まだ試合がありません。「新規試合」から始めましょう</Text>
      )}
      {games.map((row) => {
        const { game, score } = row;
        const b = badge(row);
        return (
          <Pressable
            key={game.id}
            accessibilityRole="button"
            onPress={() => openGame(game)}
            onLongPress={() => gameMenu(game)}
            accessibilityHint="長押しで削除などのメニュー"
            style={({ pressed }) => [styles.gameRow, pressed && { opacity: 0.6 }]}
          >
            <View style={[styles.badge, { backgroundColor: b.bg }]}>
              <Text style={[styles.badgeText, { color: b.fg }]}>{b.label}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.gameDate} numberOfLines={1}>
                {game.date}
                {game.leagueName ? `・${game.leagueName}` : ''}
              </Text>
              <Text style={styles.gameTeams} numberOfLines={1}>
                {game.teamAName || 'A'} vs {game.teamBName || 'B'}
              </Text>
            </View>
            {game.status === 'prep' ? (
              <Ionicons name="chevron-forward" size={20} color={colors.sub} />
            ) : (
              <Text num style={styles.gameScore}>
                {score.A}-{score.B}
              </Text>
            )}
          </Pressable>
        );
      })}

      <SectionTitle>アプリ情報</SectionTitle>
      <Card>
        <Text style={styles.info}>バージョン {Constants.expoConfig?.version ?? '-'}</Text>
        <Text style={styles.info} selectable>
          OTA {!Updates.isEnabled ? '無効（開発ビルド）' : Updates.isEmbeddedLaunch ? 'ビルド同梱' : '適用済み'}　
          {Updates.updateId ?? '-'}
        </Text>
        <Text style={styles.info}>
          channel {Updates.channel ?? '-'}　{Updates.createdAt?.toLocaleString('ja-JP') ?? ''}
        </Text>
        {live ? (
          <Text style={styles.info}>試合中は更新を確認しません</Text>
        ) : (
          <Button
            title="更新を確認"
            variant="secondary"
            small
            disabled={!canCheckUpdate || busy || ready}
            onPress={() => void checkForUpdate(true)}
          />
        )}
        {updateStatus && <Text style={styles.info}>{updateStatus}</Text>}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14, paddingBottom: 40 },
  flex: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
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
  tiles: { flexDirection: 'row', gap: 10 },
  tile: {
    flex: 1,
    height: 96,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tileIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  listHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  listHint: { fontSize: 12, color: colors.sub },
  empty: { color: colors.sub, fontSize: 14, paddingVertical: 12 },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 68,
  },
  badge: { width: 52, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 13, fontWeight: '800' },
  gameDate: { fontSize: 12, color: colors.sub },
  gameTeams: { fontSize: 15, fontWeight: '700', color: colors.text },
  gameScore: { fontSize: 26, color: colors.text },
  info: { fontSize: 12, color: colors.sub },
});
