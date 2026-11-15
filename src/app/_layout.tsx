import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { expoDb } from '@/db/client';
import { colors } from '@/ui/theme';

import migrations from '../../drizzle/migrations';

/**
 * 画面の向きは画面単位で制御する。既定は縦向き、試合中入力とQ照合は横向き固定。
 */
export default function RootLayout() {
  const { success, error } = useMigrations(expoDb, migrations);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>データベースの準備に失敗しました</Text>
        <Text style={styles.errorBody}>{error.message}</Text>
      </View>
    );
  }
  if (!success) return <View style={styles.center} />;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          orientation: 'portrait',
          headerBackTitle: '戻る',
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Benchbook' }} />
        <Stack.Screen name="teams/index" options={{ title: 'チーム管理' }} />
        <Stack.Screen name="teams/[teamId]" options={{ title: 'チーム' }} />
        <Stack.Screen name="backup" options={{ title: 'バックアップ' }} />
        <Stack.Screen name="games/[gameId]/prep" options={{ title: '試合準備' }} />
        <Stack.Screen name="games/[gameId]/index" options={{ title: '試合詳細' }} />
        <Stack.Screen
          name="games/[gameId]/live"
          options={{ orientation: 'landscape', headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="games/[gameId]/check"
          options={{ orientation: 'landscape', headerShown: false, gestureEnabled: false }}
        />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  errorTitle: { fontSize: 17, fontWeight: '700' },
  errorBody: { fontSize: 13, color: colors.sub },
});
