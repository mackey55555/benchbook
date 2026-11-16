import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { deleteGame, isPeriodEnded, listEvents, type GameSummary } from '@/db/repo';
import type { Game } from '@/db/schema';
import { gameResult } from '@/domain/analysis';

import { showDialog } from './dialog';
import { Text } from './Text';
import { colors, radius } from './theme';

/** 試合の状態に合った画面を開く */
export function useOpenGame(): (game: Game) => void {
  const router = useRouter();
  return useCallback(
    (game: Game) => {
      if (game.status === 'prep') router.push(`/games/${game.id}/prep`);
      else if (game.status === 'finished') router.push(`/games/${game.id}`);
      else if (isPeriodEnded(listEvents(db, game.id), game.currentPeriod)) router.push(`/games/${game.id}/check`);
      else router.push(`/games/${game.id}/live`);
    },
    [router],
  );
}

function badgeOf({ game, score }: GameSummary) {
  if (game.status === 'prep') return { label: '準備', bg: colors.accentBg, fg: colors.accentInk };
  if (game.status === 'live') return { label: '試合中', bg: colors.accent, fg: colors.accentText };
  const result = gameResult(game.ownSide, score);
  if (result === 'win') return { label: '勝ち', bg: colors.okBg, fg: colors.ok };
  return { label: result === 'lose' ? '負け' : '引分', bg: colors.disabledBg, fg: colors.mute };
}

/** 試合一覧の1行。タップで開き、長押しで削除などのメニューを出す */
export function GameRow(props: { row: GameSummary; onChanged: () => void }) {
  const { row, onChanged } = props;
  const { game, score } = row;
  const openGame = useOpenGame();
  const b = badgeOf(row);

  // 間違って作った試合などを消せる
  const menu = () =>
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
                onChanged();
              },
            },
          ]),
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="長押しで削除などのメニュー"
      onPress={() => openGame(game)}
      onLongPress={menu}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.badge, { backgroundColor: b.bg }]}>
        <Text style={[styles.badgeText, { color: b.fg }]}>{b.label}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.date} numberOfLines={1}>
          {game.date}
          {game.leagueName ? `・${game.leagueName}` : ''}
        </Text>
        <Text style={styles.teams} numberOfLines={1}>
          {game.teamAName || 'A'} vs {game.teamBName || 'B'}
        </Text>
      </View>
      {game.status === 'prep' ? (
        <Ionicons name="chevron-forward" size={20} color={colors.sub} />
      ) : (
        <Text num style={styles.score}>
          {score.A}-{score.B}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  row: {
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
  date: { fontSize: 12, color: colors.sub },
  teams: { fontSize: 15, fontWeight: '700', color: colors.text },
  score: { fontSize: 26, color: colors.text },
});
