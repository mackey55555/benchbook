import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { getLiveGame } from '@/db/repo';
import { switchSpace, syncNow, useTeamState } from '@/sync/session';

import { showDialog } from './dialog';
import { Text } from './Text';
import { colors, radius } from './theme';

/**
 * 記録の置き場所（個人／チーム）の切り替え。チームに入っているときだけホームに出す。
 * 下に同期の状態を1行で出す。
 */
export function SpaceSwitcher() {
  const team = useTeamState();
  if (!team.userId || team.spaces.length === 0) return null;

  const choose = (spaceId: string | null) => {
    if (spaceId === team.spaceId) return;
    if (getLiveGame(db)) {
      showDialog('試合の途中です', '進行中の試合を終えてから、切り替えてください。');
      return;
    }
    switchSpace(spaceId);
  };

  const lapsed = team.spaces.some((s) => s.id === team.spaceId && !s.active);
  const status = team.spaceId === null
    ? '個人の記録は、この端末の中だけに保存されます'
    : lapsed
      ? 'このチームは、いま契約がありません。自分が記録した試合だけを表示しています'
    : team.syncing
      ? '同期しています…'
      : team.syncError
        ? `同期できていません：${team.syncError}`
        : team.pending > 0
          ? `まだ送っていない変更が ${team.pending} 件あります`
          : 'チームと同期済み';

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <SpaceChip label="個人" icon="person" active={team.spaceId === null} onPress={() => choose(null)} />
        {team.spaces.map((s) => (
          <SpaceChip
            key={s.id}
            label={s.name}
            icon={s.active ? 'people' : 'lock-closed'}
            active={team.spaceId === s.id}
            onPress={() => choose(s.id)}
          />
        ))}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${status}。タップで同期する`}
        disabled={team.spaceId === null || lapsed || team.syncing}
        onPress={() => void syncNow()}
        hitSlop={8}
        style={styles.statusRow}
      >
        <Text style={[styles.status, team.spaceId !== null && Boolean(team.syncError) && styles.statusError]} numberOfLines={2}>
          {status}
        </Text>
        {team.spaceId !== null && !lapsed && !team.syncing && <Ionicons name="refresh" size={14} color={colors.sub} />}
      </Pressable>
    </View>
  );
}

function SpaceChip(props: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const fg = props.active ? colors.primaryText : props.disabled ? colors.disabled : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.active, disabled: props.disabled }}
      accessibilityLabel={props.disabled ? `${props.label}（いまは使えません）` : props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.chip, props.active && styles.chipActive, pressed && styles.pressed]}
    >
      <Ionicons name={props.icon} size={15} color={fg} />
      <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  chips: { gap: 8 },
  pressed: { opacity: 0.6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    maxWidth: 220,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { fontSize: 12, color: colors.sub, flexShrink: 1 },
  statusError: { color: colors.dangerInk },
});
