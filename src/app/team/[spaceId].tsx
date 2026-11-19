import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import {
  createInvite,
  deleteTeam,
  errorMessage,
  isSubscribed,
  inviteLink,
  leaveTeam,
  listMembers,
  removeMember,
  renameTeam,
  setTeamSlot,
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
              ? 'いまは利用できません。下の「契約」を確かめてください。'
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

      {owner && !space.complimentary && <SlotCard spaceId={space.id} busy={busy} run={run} />}

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

/** 契約の枠を、このチームに割り当てる・外す（運営者だけに出す） */
function SlotCard(props: { spaceId: string; busy: boolean; run: (action: () => Promise<void>) => Promise<void> }) {
  const team = useTeamState();
  const [now] = useState(() => Date.now());
  const space = team.spaces.find((s) => s.id === props.spaceId);
  if (!space) return null;
  const subscribed = isSubscribed(team.subscription, now);
  const used = team.spaces.filter((s) => s.role === 'owner' && s.slotAssigned && !s.complimentary).length;
  const tier = subscribed ? (team.subscription?.tier ?? 0) : 0;
  return (
    <>
      <SectionTitle>契約</SectionTitle>
      <Card>
        {!subscribed ? (
          <Text style={styles.body}>チームプランの契約がありません。契約すると、このチームをメンバー全員で使えます。</Text>
        ) : space.slotAssigned ? (
          <>
            <Text style={styles.body}>
              {space.active
                ? `このチームに、契約の枠を割り当てています（${used} / ${tier} チーム）。`
                : `枠を割り当てていますが、契約のチーム数（${tier}）を超えているため、いまは使えません。ほかのチームの割り当てを外すと使えます。`}
            </Text>
            <Button
              title="割り当てを外す"
              variant="secondary"
              small
              disabled={props.busy}
              onPress={() =>
                showDialog('割り当てを外しますか？', 'メンバー全員が、このチームを開けなくなります。内容は消えず、もう一度割り当てれば戻ります。', [
                  { text: 'キャンセル', style: 'cancel' },
                  { text: '外す', style: 'destructive', onPress: () => void props.run(() => setTeamSlot(space.id, false)) },
                ])
              }
            />
          </>
        ) : (
          <>
            <Text style={styles.body}>
              契約は {tier} チーム分で、いま {used} チームに割り当てています。
              {used >= tier ? 'このチームで使うには、ほかのチームの割り当てを外すか、契約のチーム数を増やしてください。' : ''}
            </Text>
            <Button
              title="このチームに割り当てる"
              disabled={props.busy || used >= tier}
              onPress={() => void props.run(() => setTeamSlot(space.id, true))}
            />
          </>
        )}
      </Card>
    </>
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
