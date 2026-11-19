# チームプランの提出に向けた掲載内容

チームプラン（サインイン、サーバーとの同期、サブスクリプション）を入れたバージョンを審査に出すときに、
App Store Connect に入れる内容をまとめる。いまの掲載内容は [listing.md](listing.md)。

## 提出の順番

1. 本番のビルドを作る（`eas build --profile production --platform ios`）。本番の環境変数に、接続先と RevenueCat のキーを入れてから。
2. App Store Connect で新しいバージョンを作り、下の内容を入れる。
3. バージョンの「アプリ内課金とサブスクリプション」に、商品10個を追加する（初めてのサブスクリプションは、アプリのバージョンと一緒に審査に出す）。
4. 審査に提出する。

## 商品（サブスクリプション）の審査用の情報

商品10個それぞれに、同じ内容を入れる。

- **スクリーンショット**：契約の画面（設定 → チームプラン → 料金を見て契約する）を iPhone で撮ったもの。10個とも同じ画像でよい。
- **審査メモ**（英語）：

```
This subscription unlocks the "Team Plan" for N team(s): every member of the team sees the same games and stats, synced through our server. Only the team owner pays; members join for free.

Where to find it: Settings tab (設定) > チームプラン (Team Plan) > sign in with Apple > create a team under "チームを作る" > tap "料金を見て契約する". The purchase screen lets you choose the number of teams (1-5) and monthly or yearly billing. All ten products are offered on this one screen and belong to the same subscription group.
```

N は商品のチーム数に合わせる（1〜5）。

## アプリの審査メモ（英語）

[listing.md](listing.md) の審査メモを、次の内容に差し替える。

```
The app still works fully offline with no account. To try the basic flow: tap "新規試合" (New game) on the home screen, add a few jersey numbers for each team, then tap "試合開始" (Start). The live input screen is landscape-only by design.

New in this version: an optional Team Plan (auto-renewable subscription).

SIGN-IN
Sign-in is only needed for the Team Plan. It uses Sign in with Apple or Google, so no demo account is required; please sign in with any Apple ID. Path: Settings tab (設定) > チームプラン.

SUBSCRIPTION
After signing in, enter a team name under "チームを作る" and tap "作る". Then tap "料金を見て契約する" to open the purchase screen. Choose the number of teams (1-5) and monthly or yearly. The same screen has "購入を復元" (Restore purchases), "契約の管理・解約" (Manage subscription), "利用規約" (Terms of Use) and "プライバシーポリシー" (Privacy Policy).

WHAT THE SUBSCRIPTION DOES
A subscribed team is shared by all of its members: games recorded by anyone are synced to every member's device, with season stats for the whole team. Members are invited with a link (team screen > "メンバーを招待") and do not pay. Without a subscription, analysis on the personal space covers the latest 3 games; recording games and sharing score sheets remain free.

ACCOUNT DELETION
Settings (設定) > チームプラン > "アカウントを削除" at the bottom. This deletes the account and its teams from our server and revokes the Sign in with Apple token.
```

## 掲載文の変更

- **価格**：無料（アプリ内課金あり）。
- **説明文**に足す段落：

```
■ チームプラン（任意・有料）
メンバー全員で、同じ記録と成績を見られます。だれかが記録した試合が全員のアプリに届き、シーズンを通した分析や選手ごとのページが使えます。
料金を払うのはチームの運営者だけで、メンバーは何人でも無料で参加できます。
・1チーム：月額980円／年額9,800円（2〜5チームの契約もあります）
・契約は自動で更新されます。更新日の24時間前までに解約しなければ、同じ期間で更新されます。
・解約は、iPhone の「設定」→ Apple Account →「サブスクリプション」から行えます。
・1台で記録して、試合ごとのスコアシートを共有する使い方は、これまでどおり無料です。

利用規約：https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
プライバシーポリシー：https://arti-lab.jp/products/benchbook/privacy
```

自動更新のサブスクリプションがあるアプリは、利用規約とプライバシーポリシーへのリンクを掲載文に入れる決まりがある（審査の指針 3.1.2）。
利用規約は Apple の標準のものを使う。

## プライバシー表示の変更

いまは「データの収集なし」。チームプランを入れたバージョンでは、次のように申告する。
どれも「ユーザに関連付けられる」「トラッキングには使わない」。使用目的はすべて「アプリの機能」。

| 区分 | データ | 何のことか |
|---|---|---|
| 連絡先情報 | メールアドレス | サインインしたアカウントのメールアドレス |
| 連絡先情報 | 名前 | メンバーに見せる名前 |
| ユーザコンテンツ | その他のユーザコンテンツ | チームに送った試合の記録、選手の背番号と名前 |
| ID | ユーザID | アカウントのID（契約の持ち主を見分けるのにも使う） |
| 購入 | 購入履歴 | チームプランの契約の状態（RevenueCat 経由） |

- 表示はアプリ単位なので、チームプランを使わない人にも同じ表示が出る。
- 広告、分析用の計測、位置情報は使っていない。
- 区分の当てはめは Apple の定義と照らして決めたが、法律や審査の専門家の確認は受けていない。

## 年齢制限

4+ のまま。年齢制限の質問で、アプリ内課金の有無を聞かれたら「あり」と答える。

## 提出前の確認

- [ ] 本番の環境変数：`EXPO_PUBLIC_SUPABASE_URL`、`EXPO_PUBLIC_SUPABASE_KEY`、`EXPO_PUBLIC_REVENUECAT_IOS_KEY`、`EXPO_PUBLIC_PAYWALL=1`
- [ ] Apple のキー（Sign in with Apple）をサーバーに設定し、アカウントの削除で連携が解除されることを確かめる
- [ ] 商品10個に、審査用のスクリーンショットとメモを入れる
- [ ] 製品サイトの招待ページとプライバシーポリシーを公開する（arti-lab.jp の PR #4）
- [ ] 2台での招待と参加、解約、チーム数を減らす変更を実機で確かめる
