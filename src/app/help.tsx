import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { createPracticeGame, getLiveGame } from '@/db/repo';
import { PRACTICE_GAME_ID } from '@/domain/practice';
import { teamEnabled } from '@/sync/client';
import { Button } from '@/ui/components';
import { showDialog } from '@/ui/dialog';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;

interface Section {
  /** 画面の「？」から開くときの目印（/help?topic=…） */
  key: string;
  title: string;
  icon: IconName;
  steps: string[];
}

const SECTIONS: Section[] = [
  {
    key: 'start',
    title: '試合を始める',
    icon: 'add-circle-outline',
    steps: [
      'ホームの「新規試合」をタップします。',
      '日付、大会名、相手チームの名前を入れます。大会名と会場は空でもかまいません。',
      '両チームの背番号を登録します。自チームは「設定 → チーム・選手」に登録しておくと、毎回自動で入ります。人数が多いチームは、「保存済みチームから読み込む」で今日来ている選手だけを選べます。',
      '相手の番号が全員分かっていなくても始められます。試合中に「＋番号」で足せます。',
      '「試合開始」をタップすると、入力画面（横向き）に変わります。',
    ],
  },
  {
    key: 'input',
    title: '試合中の入力（得点・リバウンドなど）',
    icon: 'basketball-outline',
    steps: [
      'まず選手の番号をタップし、次に真ん中のボタンをタップします。これで1件記録されます。記録すると選手の選択は外れるので、毎回、番号から選び直します。',
      '2P・3P・FT は、○が成功、×が失敗です。成功だけ記録しても使えますが、失敗も記録すると成功率が正しく出ます。',
      'OR はオフェンスリバウンド、DR はディフェンスリバウンド、AST はアシスト、STL はスティール、TOV はターンオーバー、BLK はブロックです。使わない項目は押さなくてかまいません。',
      '24秒オーバーなどのチームのターンオーバーや、選手につかないチームリバウンドは、番号の下の「チーム」（または上のチーム名）をタップしてから「TOV」「OR」「DR」をタップします。',
      '押し間違えたら「取り消す」で直前の1件を消せます。もっと前の記録は「ログ」から直せます。',
      '「今のは何番だった？」と迷ったら、旗の「印」をタップしておきます。ログのその位置に目印が残るので、あとで前後を見直せます。続けてもう一度タップすると外れます。',
      '右上の「スコア」で、いまのランニングスコアをいつでも開けます。オフィシャルの記録とずれたときの確認に使えます。',
      '入力画面を離れても記録は消えません。ホームの「入力に戻る」で続きから再開できます。',
    ],
  },
  {
    key: 'foul',
    title: 'ファウルとタイムアウト',
    icon: 'hand-left-outline',
    steps: [
      '番号をタップしてから「FOUL」をタップすると、ふつうのファウル（パーソナル・フリースローなし）が記録されます。',
      'フリースローがつくファウルや、種類の違うファウルは、「FOUL」を長押しします。種類（P＝パーソナル、T＝テクニカル、U＝アンスポーツマンライク、D＝ディスクォリファイング）と、フリースローの数を選んで「記録」をタップします。',
      'コーチやベンチのファウルは、「チーム」をタップしてから「FOUL」をタップし、種類（C＝コーチ自身、B＝ベンチ）を選びます。',
      '番号の右上の「F2」などが、その選手のファウルの数です。4つで黄色、5つで退場の表示になります。',
      '「TF」はそのQのチームファウルです。4つたまると「次からFT」と出ます。',
      'タイムアウトは「TO」をタップします。選手を選ぶ必要はありません。残りの回数もここに出ます。',
      '右上の「ファウル状況」で、全員のファウルとタイムアウトをまとめて確認できます。',
    ],
  },
  {
    key: 'clock',
    title: '時計（使う場合だけ）',
    icon: 'timer-outline',
    steps: [
      '入力画面の上の真ん中に、残り時間の時計があります。タップで動き、もう一度タップで止まります。会場の時計に合わせて操作します。',
      '時間がずれたら、時計を長押しします。テンキーで残り時間を入れて（例：6分32秒 → 632）、「合わせる」をタップします。',
      '時計を動かしたQでは、得点・ファウル・交代などの記録に、そのときの残り時間が自動でつきます。ログやプレー一覧で、何分に何があったかが分かります。',
      '交代にも残り時間が自動で入るので、出場時間が正確になります。',
      '時計は使わなくてもかまいません。一度も動かさなければ、記録に時間はつきません。途中でやめるときは、長押しして「使わない」をタップします。',
      'この時計は手元の目安です。公式の時間は、会場の時計にしたがってください。',
    ],
  },
  {
    key: 'sub',
    title: '選手の交代（使う場合だけ）',
    icon: 'swap-horizontal-outline',
    steps: [
      '試合前に先発の5人を選んでおくと、コートにいる選手が枠つきで表示されます。',
      '交代のときは「交代」をタップし、交代後にコートにいる5人を選びます。残り時間は、分かるときだけ入れます（時計を動かしていれば自動で入ります）。',
      '交代を使っているチームでは、コートに出ていない選手の番号はタップしても選ばれません（押し間違いを防ぐためです）。出ていない選手にどうしても記録するときは、番号を長押しします。',
      '交代を記録すると、出場時間と、出ているあいだの得失点差（＋/−）が集計されます。',
      '交代を使わなくても、得点やファウルの記録はできます。その場合、出場時間と ＋/− は空欄になります。',
    ],
  },
  {
    key: 'check',
    title: 'Qの終わりと、第4Q・延長',
    icon: 'checkmark-done-outline',
    steps: [
      '「Q1 終了」をタップすると、得点・チームファウル・タイムアウトの確認画面になります。',
      'オフィシャルの記録と見比べて、合っていれば「一致」をタップします。次のQに進みます。',
      '違っていたら「修正する」をタップします。選手ごとの表でマスを選び、「−1」「＋1」で直します。',
      '間違えてQを終わらせたときは、「Q終了を取り消す」で入力に戻れます。',
      '第4Qでは「残り2分」のボタンが出ます。残り2分になったらタップしてください。この時間帯に取れるタイムアウトの数が、ルールどおりに数えられます。',
      '第4Qが同点で終わったときは、延長に進むか、同点のまま終わるかを選べます。',
    ],
  },
  {
    key: 'after',
    title: '試合のあと（スコアシートと共有）',
    icon: 'document-text-outline',
    steps: [
      '試合が終わると、ランニングスコアとボックススコアが自動でできます。ホームか「試合」の一覧から、いつでも開けます。',
      '「流れ」では、得点の流れのグラフ、時間帯別の得点、いちばん大きい連続得点、コートに出ていた5人の組み合わせごとの得失点を見られます。時計を使った試合では、Qの前半・後半の得点や、無得点だった時間も出ます。',
      '「プレー」では、記録を順に見られます。「PDF」で、残り時間つきのプレー一覧を共有できます。',
      '「ランニング」「ボックス」「流れ」のそれぞれで、「PDF」か「画像」をタップすると、送り先を選ぶ画面が出ます。LINE、メール、AirDrop などで送れます。印刷や拡大には PDF が向いています。',
      'あとから気づいた間違いは、「得点・ファウルを直す」で直せます。Qを切り替えて、選手ごとに直します。ビデオを見返しながら直すときにも使えます。',
      '間違って終わらせた試合は、いちばん下の「誤って終了した試合を再開する」で入力に戻せます。',
      'いらない試合は、一覧で長押しすると削除できます。',
    ],
  },
  {
    key: 'analysis',
    title: '成績を見る（分析）',
    icon: 'bar-chart-outline',
    steps: [
      '下の「分析」で、終わった試合をまとめた成績を見られます。上の「チーム」「選手」で切り替えます。',
      '「期間」でしぼれます。「今年度」は4月からの成績です。',
      '「1試合平均」と「合計」を切り替えられます。シーズンの通算を見るときは「合計」にします。',
      '「チーム」では、戦績、試合ごとの推移、Qごとの平均得点、シュート成功率を見られます。推移のグラフは、上のボタンで得点以外の項目に変えられます。棒をタップすると、その試合の値が出ます。',
      '「選手」では、全員の成績が1つの表に並びます。表は横に動かせます。見出し（PTS など）をタップすると、その項目の多い順に並びます。',
      '選手をタップすると、その選手だけのページが開きます。試合ごとの成績も見られます。',
      '「選手」では「40分換算」も選べます。出場時間の違う選手を、同じ40分あたりの数字で比べられます（先発と交代を記録した試合が対象。出場時間が5分未満の選手は出ません）。',
      '「チーム」の「時間帯別の平均得点」は、試合中に時計を使った試合が対象です。「5人の組み合わせ」は、先発と交代を記録した試合が対象です。',
      '項目の見方：PTS＝得点、3P・2P・FT の M＝成功、A＝試投、F＝ファウル、OR・DR・TR＝リバウンド、TO＝ターンオーバー、AS＝アシスト、ST＝スティール、BS＝ブロック、MIN＝出場時間。',
    ],
  },
  {
    key: 'share',
    title: '成績を共有する',
    icon: 'share-outline',
    steps: [
      '「分析」の右上の「共有」をタップします。',
      '「チーム成績を共有」（または「選手の比較表を共有」）を選ぶと、いま見ている内容が1枚のシートになります。「PDF」か「画像」で送れます。',
      '「全内容を1つのPDFで出力」を選ぶと、チームの成績、選手の比較表、選手1人ずつのまとめが、1つのPDFになります。',
      'シートは、そのとき選んでいる期間と、「1試合平均／合計」の内容で作られます。先に期間を選んでから「共有」をタップしてください。',
      '選手1人分だけ送るときは、選手のページの「共有」を使います。',
    ],
  },
  {
    key: 'backup',
    title: '記録を守る（バックアップ）',
    icon: 'shield-checkmark-outline',
    steps: [
      '記録はこのiPhoneの中だけに保存されます。アプリを消すと、記録も消えます。',
      '機種変更の前や、大事な試合のあとは、「設定 → バックアップ」の「全データを書き出す」で、ファイルにして保存してください。',
      '新しい端末では、同じ画面の「読み込む」で、そのファイルから記録を戻せます。',
    ],
  },
];

/** チームプランの説明。サーバーにつながるアプリでだけ出す */
const TEAM_SECTION: Section = {
  key: 'team',
  title: 'チームで使う（チームプラン）',
  icon: 'people-circle-outline',
  steps: [
    'チームに入ると、だれかが記録した試合と名簿が、メンバー全員のアプリに届きます。「設定 → チームプラン」から、Apple か Google のアカウントでサインインして始めます。',
    'チームを作った人が運営者です。チームの画面の「メンバーを招待する」で、招待を送れます。受け取った人は、サインインしてから招待を開くと入れます。',
    'ホームの上で、「個人」とチームを切り替えます。試合・名簿・分析は、それぞれ別々です。試合は、作ったときに開いていたほうに入ります。',
    '個人で記録した試合は、終了後に試合の画面の「チームに送る」で、チームへ移せます。',
    '電波がなくても記録できます。つながったときに、自動で送られます。ホームの切り替えの下に、同期の状態が出ます。',
    'チームの試合は、メンバーならだれでも直せます。消せるのは、記録した本人と運営者だけです。',
    '個人の記録はこのiPhoneの中だけにあります。チームの記録はサーバーにも保存されるので、機種変更のあとも、サインインすれば戻ります。',
  ],
};

/** 使い方。練習用の試合もここから始められる。?topic= で指定した項目を開いた状態で表示する */
export default function HelpScreen() {
  const router = useRouter();
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const [open, setOpen] = useState<string | null>(topic ?? null);
  // 画面の「？」から来たときは、その項目をいちばん上に出す
  const all = teamEnabled ? [...SECTIONS, TEAM_SECTION] : SECTIONS;
  const sections = topic ? [...all].sort((a, b) => Number(b.key === topic) - Number(a.key === topic)) : all;

  const startPractice = () => {
    if (getLiveGame(db)) {
      showDialog('進行中の試合があります', '試合が終わってから練習してください。');
      return;
    }
    createPracticeGame(db);
    router.push(`/games/${PRACTICE_GAME_ID}/live`);
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
      {!topic && (
        <View style={styles.practice}>
          <Text style={styles.practiceTitle}>まずは練習してみる</Text>
          <Text style={styles.practiceBody}>
            練習用の試合で、次に押す場所を案内します。3分ほどで、得点・ファウル・取り消し・タイムアウト・Qの終わりまでを試せます。練習の記録は残りません。
          </Text>
          <Button title="練習を始める" variant="accent" onPress={startPractice} />
        </View>
      )}

      <Text style={styles.lead}>知りたい項目をタップすると、説明が開きます。</Text>
      {sections.map((section) => {
        const expanded = open === section.key;
        return (
          <View key={section.key} style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen(expanded ? null : section.key)}
              style={({ pressed }) => [styles.sectionHead, pressed && styles.pressed]}
            >
              <View style={styles.sectionIcon}>
                <Ionicons name={section.icon} size={20} color={colors.text} />
              </View>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.sub} />
            </Pressable>
            {expanded && (
              <View style={styles.steps}>
                {section.steps.map((step, i) => (
                  <View key={i} style={styles.step}>
                    <Text num style={styles.stepNo}>
                      {i + 1}
                    </Text>
                    <Text style={styles.stepText}>{step}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      {topic && <Button title="練習用の試合をやってみる" variant="secondary" onPress={startPractice} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 10, paddingBottom: 40 },
  pressed: { opacity: 0.6 },
  practice: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: 20, gap: 10, marginBottom: 4 },
  practiceTitle: { fontSize: 18, fontWeight: '800', color: colors.primaryText },
  practiceBody: { fontSize: 13, lineHeight: 20, color: colors.onInkSub },
  lead: { fontSize: 13, color: colors.sub },
  section: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 60 },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  steps: { paddingHorizontal: 14, paddingBottom: 16, gap: 10 },
  step: { flexDirection: 'row', gap: 10 },
  stepNo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.disabledBg,
    color: colors.text,
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    overflow: 'hidden',
  },
  stepText: { flex: 1, fontSize: 14, lineHeight: 22, color: colors.text },
});
