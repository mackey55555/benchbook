import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { createPracticeGame, getLiveGame } from '@/db/repo';
import { PRACTICE_GAME_ID } from '@/domain/practice';
import { Button, Card, SectionTitle } from '@/ui/components';
import { showDialog } from '@/ui/dialog';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const SECTIONS: { title: string; icon: IconName; steps: string[] }[] = [
  {
    title: '試合を始める',
    icon: 'add-circle-outline',
    steps: [
      'ホームの「新規試合」をタップします。',
      '相手チームの名前と、両チームの背番号を登録します。自チームは「設定 → チーム・選手」に登録しておくと、毎回自動で入ります。',
      '「試合開始」をタップすると、入力画面（横向き）に変わります。',
    ],
  },
  {
    title: '試合中の入力',
    icon: 'basketball-outline',
    steps: [
      'まず選手の番号をタップし、次に真ん中のボタン（2P○、FOUL など）をタップします。これで1件記録されます。',
      '○は成功、×は失敗です。FOUL を長押しすると、ファウルの種類とフリースローの数を選べます。',
      '押し間違えたら「取り消す」で直前の1件を消せます。',
      'タイムアウトは「TO」をタップします。選手を選ぶ必要はありません。',
      '上の「ファウル状況」で、全員のファウルの数を確認できます。',
    ],
  },
  {
    title: '選手の交代（使う場合だけ）',
    icon: 'swap-horizontal-outline',
    steps: [
      '試合前に先発の5人を選んでおくと、コートにいる選手が枠つきで表示されます。',
      '交代のときは「交代」をタップし、コートに出る5人を選びます。',
      '交代を記録すると、出場時間と、出ているあいだの得失点差も集計されます。使わなくても記録はできます。',
    ],
  },
  {
    title: 'Qの終わり',
    icon: 'checkmark-done-outline',
    steps: [
      '「Q1 終了」をタップすると、得点とファウルの確認画面になります。',
      'オフィシャルの記録と見比べて、合っていれば「一致」をタップします。次のQに進みます。',
      '違っていたら「修正する」をタップします。選手ごとの表で、得点やファウルを1件ずつ直せます。',
    ],
  },
  {
    title: '試合のあと',
    icon: 'document-text-outline',
    steps: [
      '試合が終わると、スコアシート（ランニングスコア、ボックススコア）が自動でできます。',
      '「PDF」か「画像」をタップすると、LINEやメールで送れます。',
      'あとから気づいた間違いは、試合の画面の「得点・ファウルを直す」で直せます。',
    ],
  },
  {
    title: '成績を見る',
    icon: 'bar-chart-outline',
    steps: [
      '下の「分析」で、チームと選手の成績を見られます。期間をしぼると、シーズンの成績になります。',
      '選手をタップすると、その選手だけのページが開きます。',
      '「共有」から、成績をPDFで送れます。',
    ],
  },
  {
    title: '記録を守る',
    icon: 'shield-checkmark-outline',
    steps: [
      '記録はこのiPhoneの中だけに保存されます。アプリを消すと、記録も消えます。',
      '機種変更の前や、大事な試合のあとは、「設定 → バックアップ」で書き出しておいてください。',
    ],
  },
];

/** 使い方。練習用の試合もここから始められる */
export default function HelpScreen() {
  const router = useRouter();

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
      <View style={styles.practice}>
        <Text style={styles.practiceTitle}>まずは練習してみる</Text>
        <Text style={styles.practiceBody}>
          練習用の試合で、次に押す場所を案内します。3分ほどで、入力からQの終わりまでを試せます。練習の記録は残りません。
        </Text>
        <Button title="練習を始める" variant="accent" onPress={startPractice} />
      </View>

      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <View style={styles.sectionHead}>
            <Ionicons name={section.icon} size={20} color={colors.text} />
            <SectionTitle>{section.title}</SectionTitle>
          </View>
          <Card>
            {section.steps.map((step, i) => (
              <View key={i} style={styles.step}>
                <Text num style={styles.stepNo}>
                  {i + 1}
                </Text>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </Card>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14, paddingBottom: 40 },
  practice: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: 20, gap: 10 },
  practiceTitle: { fontSize: 18, fontWeight: '800', color: colors.primaryText },
  practiceBody: { fontSize: 13, lineHeight: 20, color: colors.onInkSub },
  section: { gap: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  step: { flexDirection: 'row', gap: 10 },
  stepNo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accentBg,
    color: colors.accentInk,
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    overflow: 'hidden',
  },
  stepText: { flex: 1, fontSize: 14, lineHeight: 22, color: colors.text },
});
