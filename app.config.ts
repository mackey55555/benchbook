import type { ExpoConfig } from 'expo/config';

/**
 * EASプロジェクトID。`eas init` 実行後に表示されるIDをここに貼る。
 * 空のままだと EAS Update のURLが設定されず、OTAは無効になる（ローカル開発は可能）。
 */
const EAS_PROJECT_ID = '2642f196-97ed-456b-a675-797478cb9ea3';

const config: ExpoConfig = {
  name: 'Benchbook',
  slug: 'benchbook',
  version: '1.0.0',
  scheme: 'benchbook',
  platforms: ['ios'],
  // アプリ全体では向きを固定しない。画面ごとの向きは expo-router の
  // Stack.Screen options.orientation で制御する（src/app/_layout.tsx 参照）。
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'jp.arti-lab.benchbook',
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: ['expo-router', 'expo-sqlite', 'expo-sharing', 'expo-screen-orientation'],
  experiments: {
    typedRoutes: true,
  },
  // ネイティブ構成が変わったビルドには古いOTAを配信しない（SPEC 7章）
  runtimeVersion: {
    policy: 'fingerprint',
  },
  updates: {
    // 自動では更新を確認しない。確認はホーム画面から明示的に行う（SPEC 7章）
    checkAutomatically: 'NEVER',
    ...(EAS_PROJECT_ID ? { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } : {}),
  },
  extra: {
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
};

export default config;
