import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import {
  MPLUSRounded1c_500Medium,
  MPLUSRounded1c_700Bold,
  MPLUSRounded1c_800ExtraBold,
} from '@expo-google-fonts/m-plus-rounded-1c';
import { Ionicons } from '@expo/vector-icons';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { expoDb } from '@/db/client';
import { Text } from '@/ui/Text';
import { colors, fonts } from '@/ui/theme';

import migrations from '../../drizzle/migrations';
import { DialogHost } from '@/ui/dialog';

// フォントとDBの準備が終わるまでスプラッシュを出したままにする。
// 準備が一瞬で終わってもロゴが見えるよう、最低でもこの時間は表示する
const SPLASH_MIN_MS = 1500;
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * 画面の向きは画面単位で制御する。既定は縦向き、試合中入力とQ照合は横向き固定。
 */
export default function RootLayout() {
  const { success, error } = useMigrations(expoDb, migrations);
  // フォントの読み込みに失敗しても、端末標準のフォントで続行する
  const [fontsLoaded, fontError] = useFonts({
    MPLUSRounded1c_500Medium,
    MPLUSRounded1c_700Bold,
    MPLUSRounded1c_800ExtraBold,
    BarlowCondensed_700Bold,
    ...Ionicons.font,
  });
  const fontsReady = fontsLoaded || fontError !== null;
  const [minTimePassed, setMinTimePassed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMinTimePassed(true), SPLASH_MIN_MS);
    return () => clearTimeout(timer);
  }, []);
  const ready = (success || error !== undefined) && fontsReady && minTimePassed;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // Stack.Screen の orientation は画面本体にしか効かず、iOSではアラートを出すたびに
  // 端末の向きへ回転してしまう。アプリ全体の向きも画面に合わせて固定する。
  const pathname = usePathname();
  const landscape = /\/(live|check)$/.test(pathname);
  useEffect(() => {
    ScreenOrientation.lockAsync(
      landscape
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => undefined);
  }, [landscape]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>データベースの準備に失敗しました</Text>
        <Text style={styles.errorBody}>{error.message}</Text>
      </View>
    );
  }
  if (!success || !fontsReady) return <View style={styles.center} />;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          orientation: 'portrait',
          headerBackTitle: '戻る',
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.heavy, color: colors.text },
          headerBackTitleStyle: { fontFamily: fonts.bold },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ title: 'ホーム', headerShown: false }} />
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
      <DialogHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  errorTitle: { fontSize: 17, fontWeight: '700' },
  errorBody: { fontSize: 13, color: colors.sub },
});
