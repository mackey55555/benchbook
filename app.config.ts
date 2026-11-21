import type { ExpoConfig } from 'expo/config';

/**
 * EASプロジェクトID。`eas init` 実行後に表示されるIDをここに貼る。
 * 空のままだと EAS Update のURLが設定されず、OTAは無効になる（ローカル開発は可能）。
 */
const EAS_PROJECT_ID = '2642f196-97ed-456b-a675-797478cb9ea3';

// 手元のAndroidエミュレータで動作確認するときだけ `BENCHBOOK_ANDROID=1` を付ける。
// 配布対象はiPhoneのみで、通常のビルド・OTAの設定（fingerprint）には影響しない。
const withAndroid = process.env.BENCHBOOK_ANDROID === '1';

const config: ExpoConfig = {
  name: 'Benchbook',
  slug: 'benchbook',
  version: '1.0.0',
  scheme: 'benchbook',
  platforms: withAndroid ? ['ios', 'android'] : ['ios'],
  ...(withAndroid ? { android: { package: 'jp.artilab.benchbook' } } : {}),
  // アプリ全体では向きを固定しない。画面ごとの向きは expo-router の
  // Stack.Screen options.orientation で制御する（src/app/_layout.tsx 参照）。
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'jp.arti-lab.benchbook',
    supportsTablet: true,
    // iPadでも、試合中の入力画面を横向きに固定する。分割表示（Split View）では向きを固定できないため、全画面で動かす
    requireFullScreen: true,
    // チームプランのサインイン（Appleでサインイン）
    usesAppleSignIn: true,
    // チームへの招待リンク（https://arti-lab.jp/products/benchbook/join/…）を、アプリで直接開く
    associatedDomains: ['applinks:arti-lab.jp'],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-sharing',
    'expo-screen-orientation',
    'expo-font',
    'expo-apple-authentication',
    'expo-web-browser',
    // 濃紺の地に、アイコンとロゴをまとめた画像を中央に置く
    ['expo-splash-screen', { backgroundColor: '#16203a', image: './assets/splash.png', imageWidth: 260 }],
  ],
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
