import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { db } from '@/db/client';
import {
  addPlayer,
  deletePlayer,
  deleteTeam,
  getTeam,
  listPlayers,
  renameTeam,
  updatePlayer,
} from '@/db/repo';
import { Button, CommitInput, Row, SectionTitle, styles as ui } from '@/ui/components';
import { colors } from '@/ui/theme';
import { attempt, useRefresh } from '@/ui/useGame';

export default function TeamScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const router = useRouter();
  const [version, bump] = useRefresh();
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  const team = useMemo(() => getTeam(db, teamId), [teamId, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  const players = useMemo(() => listPlayers(db, teamId), [teamId, version]);

  if (!team) return null;

  const run = (action: () => void) => {
    attempt(action);
    bump();
  };

  const add = () => {
    if (attempt(() => addPlayer(db, teamId, { number, name }))) {
      setNumber('');
      setName('');
    }
    bump();
  };

  const confirmDeleteTeam = () =>
    Alert.alert('チームを削除', `「${team.name}」と選手マスタを削除します。過去の試合記録は残ります。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: () => {
          if (attempt(() => deleteTeam(db, teamId))) router.back();
        },
      },
    ]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: team.isOwn ? '自チーム' : '相手チーム' }} />
      <SectionTitle>チーム名</SectionTitle>
      <CommitInput value={team.name} onCommit={(v) => run(() => renameTeam(db, teamId, v))} />

      <SectionTitle>選手（背番号・氏名・有効）</SectionTitle>
      {players.length === 0 && <Text style={styles.empty}>選手が登録されていません</Text>}
      {players.map((p) => (
        <Row key={p.id}>
          <CommitInput
            value={p.number}
            onCommit={(v) => run(() => updatePlayer(db, p.id, { number: v }))}
            keyboardType="number-pad"
            maxLength={2}
            style={styles.number}
            accessibilityLabel="背番号"
          />
          <CommitInput
            value={p.name}
            onCommit={(v) => run(() => updatePlayer(db, p.id, { name: v }))}
            placeholder="氏名"
            style={styles.flex}
            accessibilityLabel="氏名"
          />
          <Switch
            value={p.isActive}
            onValueChange={(v) => run(() => updatePlayer(db, p.id, { isActive: v }))}
            accessibilityLabel="有効"
          />
          <Button
            title="削除"
            variant="ghost"
            small
            onPress={() =>
              Alert.alert('選手を削除', `#${p.number} ${p.name} を選手マスタから削除します。`, [
                { text: 'キャンセル', style: 'cancel' },
                { text: '削除', style: 'destructive', onPress: () => run(() => deletePlayer(db, p.id)) },
              ])
            }
          />
        </Row>
      ))}

      <SectionTitle>選手を追加</SectionTitle>
      <Row>
        <TextInput
          value={number}
          onChangeText={setNumber}
          placeholder="番号"
          placeholderTextColor={colors.sub}
          keyboardType="number-pad"
          maxLength={2}
          style={[ui.input, styles.number]}
        />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="氏名（任意）"
          placeholderTextColor={colors.sub}
          style={[ui.input, styles.flex]}
          returnKeyType="done"
          onSubmitEditing={add}
        />
        <Button title="追加" onPress={add} disabled={!number.trim()} />
      </Row>

      {!team.isOwn && (
        <View style={styles.danger}>
          <Button title="このチームを削除" variant="ghost" onPress={confirmDeleteTeam} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 60 },
  flex: { flex: 1 },
  number: { width: 60, textAlign: 'center' },
  empty: { color: colors.sub, fontSize: 14 },
  danger: { marginTop: 24 },
});
