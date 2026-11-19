import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { clockSeconds, isClockRunning, type ClockState } from '@/domain/clock';
import { formatClock, type LineupConfig } from '@/domain/lineup';
import { periodLabel } from '@/domain/rules';

import { Text } from './Text';
import { colors } from './theme';

/**
 * 入力画面の上部に置く時計。タップで動かす・止める、長押しで時間を直す。
 * 動いている間だけ自分で描き直すので、入力画面全体は描き直さない。
 */
export function GameClock(props: {
  game: ClockState & Pick<LineupConfig, 'periodMinutes' | 'otMinutes'>;
  period: number;
  onToggle: () => void;
  onEdit: () => void;
  /** 動いている間に残り0になったとき */
  onExpire: () => void;
}) {
  const { game, period, onToggle, onEdit, onExpire } = props;
  const running = isClockRunning(game, period);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [running]);

  const seconds = clockSeconds(game, period, game, now);
  const expired = running && seconds === 0;
  useEffect(() => {
    if (expired) onExpire();
  }, [expired, onExpire]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${periodLabel(period)} 残り${formatClock(seconds)} ${running ? '時計を止める' : '時計を動かす'}`}
      accessibilityHint="長押しで時間を直す"
      onPress={onToggle}
      onLongPress={onEdit}
      delayLongPress={350}
      hitSlop={6}
      style={({ pressed }) => [styles.pill, running && styles.pillRunning, pressed && styles.pressed]}
    >
      <Text style={[styles.period, running && styles.onAccent]}>{periodLabel(period)}</Text>
      <Text num style={[styles.time, running && styles.onAccent]}>
        {formatClock(seconds)}
      </Text>
      <Ionicons name={running ? 'pause' : 'play'} size={15} color={running ? colors.accentText : colors.primaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: colors.inkSoft,
  },
  pillRunning: { backgroundColor: colors.accent },
  pressed: { opacity: 0.6 },
  period: { fontSize: 13, fontWeight: '800', color: colors.accent },
  // 桁が変わっても幅が動かないよう、幅を固定する
  time: { width: 62, textAlign: 'center', fontSize: 26, lineHeight: 30, color: colors.primaryText },
  onAccent: { color: colors.accentText },
});
