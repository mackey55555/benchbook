import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { getLiveGame } from '@/db/repo';
import { teamEnabled } from '@/sync/client';
import { applyUpdate, canCheckUpdate, checkForUpdate, useUpdateState } from '@/ui/appUpdate';
import { Button, Card, SectionTitle } from '@/ui/components';
import { Text } from '@/ui/Text';
import { colors, radius, page } from '@/ui/theme';
import { useRefresh } from '@/ui/useGame';

const LINKS = [
  { href: '/help', label: '使い方', body: '操作の説明と、練習用の試合', icon: 'help-circle-outline', bg: colors.accentBg },
  { href: '/teams', label: 'チーム・選手', body: '自チームと相手チームの選手を登録する', icon: 'people-outline', bg: colors.teamABg },
  { href: '/backup', label: 'バックアップ', body: '記録を書き出す・読み込む', icon: 'share-outline', bg: colors.teamBBg },
] as const;

/** 製品サイト上のページ（外部ブラウザで開く） */
const WEB_LINKS = [
  { url: 'https://arti-lab.jp/products/benchbook/support', label: '使い方・お問い合わせ' },
  { url: 'https://arti-lab.jp/products/benchbook/privacy', label: 'プライバシーポリシー' },
] as const;

const TEAM_LINK = {
  href: '/team',
  label: 'チームプラン',
  body: 'メンバー全員で、同じ記録と成績を見る',
  icon: 'people-circle-outline',
  bg: colors.okBg,
} as const;

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [version] = useRefresh();
  const update = useUpdateState();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version で再読み込みする
  const live = useMemo(() => getLiveGame(db) !== undefined, [version]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
    >
      <Text style={styles.title}>設定</Text>
      {(teamEnabled ? [...LINKS, TEAM_LINK] : LINKS).map((l) => (
        <Pressable
          key={l.href}
          accessibilityRole="button"
          accessibilityLabel={l.label}
          onPress={() => router.push(l.href)}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <View style={[styles.linkIcon, { backgroundColor: l.bg }]}>
            <Ionicons name={l.icon} size={22} color={colors.text} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.linkLabel}>{l.label}</Text>
            <Text style={styles.linkBody}>{l.body}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.sub} />
        </Pressable>
      ))}

      <SectionTitle>サポート</SectionTitle>
      <Card style={styles.webLinks}>
        {WEB_LINKS.map((l) => (
          <Pressable
            key={l.url}
            accessibilityRole="link"
            accessibilityLabel={l.label}
            onPress={() => void Linking.openURL(l.url)}
            style={({ pressed }) => [styles.webLink, pressed && styles.pressed]}
          >
            <Text style={styles.webLinkLabel}>{l.label}</Text>
            <Ionicons name="open-outline" size={18} color={colors.sub} />
          </Pressable>
        ))}
      </Card>

      <SectionTitle>アプリ情報</SectionTitle>
      <Card>
        <Text style={styles.info}>バージョン {Constants.expoConfig?.version ?? '-'}</Text>
        <Text style={styles.info} selectable>
          OTA {!Updates.isEnabled ? '無効（開発ビルド）' : Updates.isEmbeddedLaunch ? 'ビルド同梱' : '適用済み'}　
          {Updates.updateId ?? '-'}
        </Text>
        <Text style={styles.info}>
          channel {Updates.channel ?? '-'}　{Updates.createdAt?.toLocaleString('ja-JP') ?? ''}
        </Text>
        {live ? (
          <Text style={styles.info}>試合中は更新を確認しません</Text>
        ) : update.ready ? (
          <Button
            title={update.applying ? '更新中…' : '最新版に更新する'}
            small
            disabled={update.applying}
            onPress={() => void applyUpdate()}
          />
        ) : (
          <Button
            title="更新を確認"
            variant="secondary"
            small
            disabled={!canCheckUpdate || update.busy}
            onPress={() => void checkForUpdate(true)}
          />
        )}
        {update.status && <Text style={styles.info}>{update.status}</Text>}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { ...page, padding: 20, gap: 14, paddingBottom: 32 },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    minHeight: 76,
  },
  linkIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { fontSize: 16, fontWeight: '800', color: colors.text },
  linkBody: { fontSize: 12, color: colors.sub },
  webLinks: { gap: 0, paddingVertical: 4 },
  webLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  webLinkLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  info: { fontSize: 12, color: colors.sub },
});
