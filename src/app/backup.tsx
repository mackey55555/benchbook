import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { exportAll, importBackup, parseBackup } from '@/db/backup';
import { db } from '@/db/client';
import { RepoError } from '@/db/repo';
import { pickJsonText, shareJson } from '@/lib/share';
import { Stack } from 'expo-router';

import { Button, Card, SectionTitle } from '@/ui/components';
import { HelpButton } from '@/ui/HelpButton';
import { Text } from '@/ui/Text';
import { colors, page } from '@/ui/theme';
import { showDialog } from '@/ui/dialog';

export default function BackupScreen() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      showDialog(
        e instanceof RepoError ? '読み込めませんでした' : 'エラー',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const exportEverything = () =>
    run(async () => {
      const stamp = new Date().toISOString().slice(0, 10);
      await shareJson(exportAll(db), `benchbook-backup-${stamp}`);
    });

  const importFile = () =>
    run(async () => {
      const text = await pickJsonText();
      if (text === null) return;
      const result = importBackup(db, parseBackup(text));
      setMessage(
        `読み込みました：試合 ${result.games}件（記録 ${result.events}件）、チーム ${result.teams}件、選手 ${result.players}名` +
          (result.skippedGames ? `\nすでにある試合 ${result.skippedGames}件は変更していません` : ''),
      );
    });

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerRight: () => <HelpButton topic="backup" /> }} />
      <SectionTitle>書き出し</SectionTitle>
      <Card>
        <Text style={styles.body}>
          すべての試合・チーム・選手を1つのJSONファイルにして共有します。ファイルアプリやクラウドに保存してください。
        </Text>
        <Button title="全データを書き出す" onPress={exportEverything} disabled={busy} />
        <Text style={styles.note}>試合1件だけを書き出すときは、試合詳細の「JSON」を使います。</Text>
      </Card>

      <SectionTitle>読み込み</SectionTitle>
      <Card>
        <Text style={styles.body}>
          書き出したJSON（全データ・試合単位のどちらも可）を読み込みます。端末にないデータだけを追加し、すでにある試合は上書きしません。
        </Text>
        <Button title="JSONファイルを選ぶ" variant="secondary" onPress={importFile} disabled={busy} />
        {message && <Text style={styles.result}>{message}</Text>}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { ...page, padding: 16, gap: 10 },
  body: { fontSize: 14, color: colors.text, lineHeight: 20 },
  note: { fontSize: 12, color: colors.sub },
  result: { fontSize: 14, color: colors.ok, lineHeight: 20 },
});
