import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import {
  createInvite,
  deleteTeam,
  errorMessage,
  inviteLink,
  leaveTeam,
  listMembers,
  removeMember,
  renameTeam,
  switchSpace,
  syncNow,
  useTeamState,
  type Member,
} from '@/sync/session';
import { Button, Card, CommitInput, Row, SectionTitle } from '@/ui/components';
import { showDialog } from '@/ui/dialog';
import { Text } from '@/ui/Text';
import { colors } from '@/ui/theme';

/** チーム1つの画面。状態、メンバー、招待、退出・削除 */
export default function TeamScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const team = useTeamState();
  const space = team.spaces.find((s) => s.id === spaceId);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMembers = useCallback(() => {
    listMembers(spaceId)
      .then(setMembers)
      .catch(() => setMembers(null));
  }, [spaceId]);
  useEffect(loadMembers, [loadMembers, space?.memberCount]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showDialog('確認してください', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!space) {
    return (
      <View style={styles.container}>
        <Text style={styles.note}>このチームは見つかりません。</Text>
      </View>
    );
  }
  const owner = space.role === 'owner';

  const invite = () =>
    run(async () => {
      const token = await createInvite(space.id);
      await Share.share({
        message:
          `Benchbook のチーム「${space.name}」への招待です。\n` +
          `アプリを入れてから、下のリンクを開いてください（14日間有効）。\n${inviteLink(token)}\n\n` +
          `開けないときは、アプリの「設定 → チームプラン → 招待で入る」に、次のコードを貼ってください。\n${token}`,
      });
    });

  const confirmRemove = (m: Member) =>
    showDialog(`${m.name || '名前のないメンバー'} を外しますか？`, 'この人の端末から、チームの内容が見えなくなります。記録した試合はチームに残ります。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '外す',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await removeMember(space.id, m.userId);
            await syncNow();
            loadMembers();
          }),
      },
    ]);

  const confirmLeave = () =>
    showDialog('このチームを抜けますか？', 'この端末から、チームの内容が見えなくなります。記録した試合はチームに残ります。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '抜ける',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await leaveTeam(space.id);
            router.back();
          }),
      },
    ]);

  const confirmDelete = () =>
    showDialog(`「${space.name}」を削除しますか？`, 'メンバー全員が、このチームを開けなくなります。元に戻せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await deleteTeam(space.id);
            router.back();
          }),
      },
    ]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Card>
        {owner ? (
          <CommitInput value={space.name} maxLength={60} onCommit={(v) => v.trim() && void run(() => renameTeam(space.id, v))} />
        ) : (
          <Text style={styles.name}>{space.name}</Text>
        )}
        <Text style={styles.body}>
          {owner ? 'あなたは運営者です。' : 'あなたはメンバーです。'}
          {space.active
            ? '記録した試合と名簿が、メンバー全員に届きます。'
            : owner
              ? 'いまは利用できません。チームプランの契約が必要です（契約の機能は準備中です）。'
              : 'いまは利用できません。運営者の契約が切れています。'}
        </Text>
        {space.active && team.spaceId !== space.id && (
          <Button
            title="このチームを開く"
            variant="accent"
            onPress={() => {
              switchSpace(space.id);
              router.dismissAll();
              router.navigate('/');
            }}
          />
        )}
        {team.spaceId === space.id && <Text style={styles.note}>いま、このチームを開いています。</Text>}
      </Card>

      <SectionTitle>メンバー（{space.memberCount}人）</SectionTitle>
      <Card>
        {members === null && <Text style={styles.note}>読み込んでいます…</Text>}
        {members?.map((m) => (
          <Row key={m.userId} style={styles.member}>
            <Text style={styles.memberName} numberOfLines={1}>
              {m.name || '（名前なし）'}
              {m.userId === team.userId ? '（あなた）' : ''}
            </Text>
            <Text style={styles.role}>{m.role === 'owner' ? '運営者' : 'メンバー'}</Text>
            {owner && m.role !== 'owner' && (
              <Button title="外す" variant="dangerSoft" small disabled={busy} onPress={() => confirmRemove(m)} />
            )}
          </Row>
        ))}
        {space.active && <Button title="メンバーを招待する" disabled={busy} onPress={invite} />}
        <Text style={styles.note}>招待は、メンバーならだれでも送れます。受け取った人は、サインインするとチームに入れます。</Text>
      </Card>

      <View style={styles.footer}>
        {owner ? (
          <Button title="このチームを削除" variant="ghost" small disabled={busy} onPress={confirmDelete} />
        ) : (
          <Button title="このチームを抜ける" variant="ghost" small disabled={busy} onPress={confirmLeave} />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  name: { fontSize: 18, fontWeight: '800', color: colors.text },
  body: { fontSize: 14, lineHeight: 21, color: colors.text },
  note: { fontSize: 13, color: colors.sub },
  member: { minHeight: 44, alignItems: 'center' },
  memberName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  role: { fontSize: 12, color: colors.sub },
  footer: { marginTop: 12, alignItems: 'center' },
});
