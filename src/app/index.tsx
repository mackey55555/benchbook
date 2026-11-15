import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { db } from '@/db/client';
import { createGame, getLiveGame, isPeriodEnded, listEvents, listGames } from '@/db/repo';
import type { Game } from '@/db/schema';
import { periodLabel } from '@/domain/rules';
import { Button, Card, Row, SectionTitle } from '@/ui/components';
import { colors } from '@/ui/theme';
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

const STATUS_LABEL: Record<Game['status'], string> = { prep: '準備中', live: '進行中', finished: '終了' };

export default function HomeScreen() {
  const router = useRouter();
  const [version] = useRefresh();
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

  const newGame = () => {
    const game = createGame(db);
    router.push(`/games/${game.id}/prep`);
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="進行中の試合を再開"
          onPress={() => openGame(live.game)}
          style={({ pressed }) => [styles.resume, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.resumeLabel}>進行中の試合を再開</Text>
          <Text style={styles.resumeTeams} numberOfLines={1}>
            {live.game.teamAName || 'A'} vs {live.game.teamBName || 'B'}
          </Text>
          <Text style={styles.resumeScore}>
            {live.score.A} - {live.score.B}　{periodLabel(live.game.currentPeriod)}
          </Text>
        </Pressable>
      )}

      <Button title="＋ 新規試合" onPress={newGame} />
      <Row>
        <Button title="チーム管理" variant="secondary" onPress={() => router.push('/teams')} style={styles.flex} />
        <Button title="バックアップ" variant="secondary" onPress={() => router.push('/backup')} style={styles.flex} />
      </Row>

      <SectionTitle>試合一覧</SectionTitle>
      {games.length === 0 && <Text style={styles.empty}>まだ試合がありません</Text>}
      {games.map(({ game, score }) => (
        <Pressable
          key={game.id}
          accessibilityRole="button"
          onPress={() => openGame(game)}
          style={({ pressed }) => [styles.gameRow, pressed && { opacity: 0.6 }]}
        >
          <View style={styles.flex}>
            <Text style={styles.gameDate}>
              {game.date}
              {game.leagueName ? `　${game.leagueName}` : ''}
            </Text>
            <Text style={styles.gameTeams} numberOfLines={1}>
              {game.teamAName || 'A'} vs {game.teamBName || 'B'}
            </Text>
          </View>
          {game.status !== 'prep' && (
            <Text style={styles.gameScore}>
              {score.A} - {score.B}
            </Text>
          )}
          <Text style={[styles.status, game.status === 'live' && styles.statusLive]}>
            {STATUS_LABEL[game.status]}
          </Text>
        </Pressable>
      ))}

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
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  flex: { flex: 1 },
  update: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.okBg,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.ok,
  },
  updateTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  updateBody: { fontSize: 12, color: colors.sub },
  resume: { backgroundColor: colors.primary, borderRadius: 14, padding: 18, gap: 4 },
  resumeLabel: { color: colors.primaryText, fontSize: 14, fontWeight: '700' },
  resumeTeams: { color: colors.primaryText, fontSize: 18, fontWeight: '600' },
  resumeScore: { color: colors.primaryText, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  empty: { color: colors.sub, fontSize: 14, paddingVertical: 12 },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    minHeight: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  gameDate: { fontSize: 12, color: colors.sub },
  gameTeams: { fontSize: 16, fontWeight: '600', color: colors.text },
  gameScore: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.text },
  status: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.sub,
    backgroundColor: colors.disabledBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  statusLive: { color: colors.ok, backgroundColor: colors.okBg },
  info: { fontSize: 12, color: colors.sub },
});
