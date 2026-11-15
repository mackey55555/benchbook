import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

/**
 * 画面の向きは画面単位で制御する。
 * 既定は縦向き。横向き固定にしたい画面（試合中入力など）は
 * <Stack.Screen name="..." options={{ orientation: 'landscape' }} /> を追加する。
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ orientation: 'portrait' }}>
        <Stack.Screen name="index" options={{ title: 'Benchbook' }} />
      </Stack>
    </>
  );
}
