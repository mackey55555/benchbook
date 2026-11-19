import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { teamEnabled } from '@/sync/client';
import { acceptInvite, errorMessage, useTeamState } from '@/sync/session';
import { Button, Card } from '@/ui/components';
import { showDialog } from '@/ui/dialog';
import { Text } from '@/ui/Text';
import { colors } from '@/ui/theme';

/** 招待のリンク（benchbook://join/コード）を開いたときの画面 */
export default function JoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const team = useTeamState();
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    try {
      const id = await acceptInvite(token);
      router.replace(`/team/${id}`);
    } catch (e) {
      showDialog('参加できませんでした', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Card>
        <Text style={styles.lead}>チームへの招待が届いています</Text>
        {!teamEnabled ? (
          <Text style={styles.body}>チームプランは準備中です。</Text>
        ) : !team.ready ? (
          <Text style={styles.body}>読み込んでいます…</Text>
        ) : team.userId ? (
          <>
            <Text style={styles.body}>参加すると、チームの名簿と試合がこの端末に届きます。</Text>
            <Button title={busy ? '参加しています…' : 'チームに参加する'} variant="accent" disabled={busy} onPress={() => void join()} />
          </>
        ) : (
          <>
            <Text style={styles.body}>先にサインインしてください。サインインのあと、この画面に戻ると参加できます。</Text>
            <Button title="サインインへ" onPress={() => router.push('/team')} />
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  lead: { fontSize: 17, fontWeight: '800', color: colors.text },
  body: { fontSize: 14, lineHeight: 21, color: colors.text },
});
