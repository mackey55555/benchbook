# CLAUDE.md — Benchbook

社会人バスケの公式戦で、マネージャーがベンチ側の控えスコアをiPhoneで記録するアプリ。
仕様の正は `docs/SPEC.md`。実装前に必ず該当章を読むこと。仕様と矛盾する判断が必要になったら、実装せずに質問する。

## 進め方

- `docs/SPEC.md` 8章のチェックポイント（CP0〜CP7）単位で進める。1セッション＝1CP＝1PR
- 各CPの完了条件を満たしたら、そこで止めてレビューを依頼する。次のCPに勝手に進まない
- CPの途中で仕様の穴を見つけたら、実装を止めて質問する（推測で埋めない）

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
- expo-haptics / expo-keep-awake / expo-screen-orientation / expo-print / expo-sharing
- EAS Build（`preview` プロファイル、iOS ad hoc）/ EAS Update（channel `preview`、runtimeVersion fingerprint）
- バンドルID：`jp.arti-lab.benchbook`

## テスト

- `src/domain/` は単体テスト必須。CP1・CP2はテストを先に書いてから実装する
- ルール（SPEC 3章）を変更したら、対応するテストを必ず追加・更新する

## OTA

- `checkAutomatically: NEVER`。更新の確認は、進行中の試合がないときのホーム画面でのみ行う
- ネイティブ依存を追加する変更はOTAで配れない。PRの説明に「要再ビルド」と明記する

## やらないこと

- ゲームクロック・選手交代の管理、サーバー同期、複数端末同時入力（SPEC 1章の非スコープ参照）
- 新しい依存パッケージの追加は、理由をPRに書く
