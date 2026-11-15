# CLAUDE.md — Benchbook

社会人バスケの公式戦で、マネージャーがベンチ側の控えスコアをiPhoneで記録するアプリ。
仕様の正は `docs/SPEC.md`。実装前に必ず該当章を読むこと。仕様と矛盾する判断が必要になったら、実装せずに質問する。

## 進め方

- MVP（CP0〜CP7）は一通り実装済み。以降は実機で画面を見ながら詳細を詰める進め方（2026-11-15〜）
- 仕様の穴や未決事項は妥当な既定値で実装を進め、置いた前提をPRの説明に一覧で書く
- 実機ビルドやApple/EASのログインなど、人にしかできない作業だけ手順にして渡す

## コマンド

- `npm run typecheck` / `npm run lint` / `npm test`
- スキーマ変更後：`npx drizzle-kit generate --name <名前>`（`drizzle/` に追加。既存のマイグレーションは書き換えない）
- Androidエミュレータでの動作確認：`BENCHBOOK_ANDROID=1 npx expo run:android`（配布対象はiPhoneのみ）

## アーキテクチャの原則

- **ルール判定はすべて `src/domain/` の純粋関数に置く。** UIコンポーネントの中でファウル数・TO残数・退場判定を計算しない
- **集計値は保存しない。** 得点・ファウル数は `game_events` から都度導出する（イベントソーシング）
- **イベントは物理削除しない。** 取消は `voided_at`、修正は void＋同じ `order_key` で新イベント挿入
- **書き込み完了 → UI反映の順。** SQLiteのトランザクション完了前に画面を更新しない
- **通信なしで全機能が動くこと。** サーバー・外部APIを追加しない
- ランニングスコアの描画はHTML 1実装で、画面（WebView）とPDF（expo-print）で共用する

## 技術スタック

- Expo（最新SDK）+ expo-router + TypeScript（strict）
- expo-sqlite + Drizzle ORM（マイグレーションは前方互換のみ）
- expo-haptics / expo-keep-awake / expo-screen-orientation / expo-print / expo-sharing / expo-file-system
- react-native-webview（ランニングスコア表示）/ react-native-view-shot（画像共有）
- EAS Build（`preview` プロファイル、iOS ad hoc）/ EAS Update（channel `preview`、runtimeVersion fingerprint）
- バンドルID：`jp.arti-lab.benchbook`

## テスト

- `src/domain/` は単体テスト必須。CP1・CP2はテストを先に書いてから実装する
- ルール（SPEC 3章）を変更したら、対応するテストを必ず追加・更新する

## OTA

- `checkAutomatically: NEVER`。更新の確認は、進行中の試合がないときのホーム画面でのみ行う（自動。取得後は「更新する」の案内を出す）
- ネイティブ依存を追加する変更はOTAで配れない。PRの説明に「要再ビルド」と明記する

## やらないこと

- アプリ内でゲームクロックを動かすこと、サーバー同期、複数端末同時入力（SPEC 1章の非スコープ参照）
- 新しい依存パッケージの追加は、理由をPRに書く
