import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { db } from '@/db/client';
import { createTeam, ensureOwnTeam, listPlayers, listTeams } from '@/db/repo';
import { Button, Row, SectionTitle, styles as ui } from '@/ui/components';
import { Text } from '@/ui/Text';
import { colors, page } from '@/ui/theme';
import { attempt, useRefresh } from '@/ui/useGame';

export default function TeamsScreen() {
  const router = useRouter();
  const [version, bump] = useRefresh();
  const [name, setName] = useState('');

  const teams = useMemo(() => {
    ensureOwnTeam(db);
    return listTeams(db).map((team) => ({ team, count: listPlayers(db, team.id).length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  }, [version]);

  const add = () => {
    if (attempt(() => createTeam(db, name))) {
      setName('');
      bump();
    }
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {teams.map(({ team, count }) => (
        <Pressable
          key={team.id}
          accessibilityRole="button"
          onPress={() => router.push(`/teams/${team.id}`)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.name} numberOfLines={1}>
            {team.name}
          </Text>
          {team.isOwn && <Text style={styles.own}>自チーム</Text>}
          <Text style={styles.count}>{count}名 ›</Text>
        </Pressable>
      ))}

      <SectionTitle>相手チームを追加</SectionTitle>
      <Row>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="チーム名"
          placeholderTextColor={colors.sub}
          style={[ui.input, styles.flex]}
          returnKeyType="done"
          onSubmitEditing={add}
        />
        <Button title="追加" onPress={add} disabled={!name.trim()} />
      </Row>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { ...page, padding: 16, gap: 10 },
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    paddingHorizontal: 14,
    backgroundColor: colors.card,
    borderRadius: 16,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  own: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.teamA,
    backgroundColor: colors.teamABg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  count: { fontSize: 14, color: colors.sub },
});
