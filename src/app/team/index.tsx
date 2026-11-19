import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { teamEnabled } from '@/sync/client';
import {
  SignInCanceled,
  acceptInvite,
  canSignInWithApple,
  createTeam,
  deleteAccount,
  errorMessage,
  isSubscribed,
  requestCode,
  setDisplayName,
  signInWithApple,
  signInWithGoogle,
  signOut,
  useTeamState,
  verifyCode,
} from '@/sync/session';
import { Button, Card, CommitInput, Row, SectionTitle, styles as ui } from '@/ui/components';
import { showDialog } from '@/ui/dialog';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

/** チームプランの入口。サインイン、チームの一覧、チームを作る・招待で入る */
export default function TeamPlanScreen() {
  const team = useTeamState();

  if (!teamEnabled) {
    return (
      <View style={styles.container}>
        <Text style={styles.note}>チームプランは準備中です。</Text>
      </View>
    );
  }
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {!team.ready ? <Text style={styles.note}>読み込んでいます…</Text> : team.userId ? <SignedIn /> : <SignIn />}
    </ScrollView>
  );
}

function Intro() {
  return (
    <Card>
      <Text style={styles.lead}>メンバー全員で、同じ記録と成績を見る</Text>
      <Text style={styles.body}>
        チームに入ると、だれかが記録した試合が、メンバー全員のアプリに届きます。チームを作る人も、招待された人も、まずサインインします。
      </Text>
      <Text style={styles.body}>サインインしなくても、今までどおり1台で記録できます。</Text>
    </Card>
  );
}

function SignIn() {
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      // 途中でやめたときは、何も出さない
      if (!(e instanceof SignInCanceled)) showDialog('サインインできませんでした', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Intro />
      <SectionTitle>サインイン</SectionTitle>
      <Card>
        <Text style={styles.body}>
          お使いの Apple か Google のアカウントでサインインします。新しくパスワードを作る必要はありません。
        </Text>
        <Text style={styles.note}>
          Apple と Google は、別々のアカウントになります。前にサインインしたことがある場合は、そのときと同じほうを選んでください。
        </Text>
        {canSignInWithApple && (
          <ProviderButton
            icon="logo-apple"
            label="Appleでサインイン"
            dark
            disabled={busy}
            onPress={() => void run(signInWithApple)}
          />
        )}
        <ProviderButton icon="logo-google" label="Googleでサインイン" disabled={busy} onPress={() => void run(signInWithGoogle)} />
        {busy && <ActivityIndicator color={colors.text} />}
        <Text style={styles.note}>
          サインインすると、名前とメールアドレスを、チームの管理のために保存します。試合の記録は、チームに送ったものだけがサーバーに保存されます。
        </Text>
      </Card>
      {__DEV__ && <DevEmailSignIn />}
    </>
  );
}

function ProviderButton(props: {
  icon: 'logo-apple' | 'logo-google';
  label: string;
  dark?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const fg = props.dark ? colors.primaryText : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.provider,
        props.dark ? styles.providerDark : styles.providerLight,
        (pressed || props.disabled) && styles.pressed,
      ]}
    >
      <Ionicons name={props.icon} size={20} color={fg} />
      <Text style={[styles.providerText, { color: fg }]}>{props.label}</Text>
    </Pressable>
  );
}

/** 開発のときだけ出す、メールの確認コードでのサインイン（手元のサーバー用） */
function DevEmailSignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showDialog('確認してください', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      await requestCode(email);
      setSentTo(email.trim());
      setCode('');
    });
  const verify = () => run(() => verifyCode(sentTo ?? email, code));

  return (
    <>
      <SectionTitle>開発用：メールでサインイン</SectionTitle>
      {sentTo === null ? (
        <Card>
          <Text style={styles.note}>この欄は、開発用のアプリにだけ出ます。</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="メールアドレス"
            placeholderTextColor={colors.sub}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={ui.input}
            returnKeyType="send"
            onSubmitEditing={send}
          />
          <Button
            title={busy ? '送っています…' : '確認コードを送る'}
            variant="secondary"
            disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}
            onPress={send}
          />
        </Card>
      ) : (
        <Card>
          <Text style={styles.body}>{sentTo} に届いた6けたのコードを入力してください。</Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            placeholder="確認コード"
            placeholderTextColor={colors.sub}
            keyboardType="number-pad"
            style={[ui.input, styles.code]}
          />
          <Button title={busy ? '確認しています…' : 'サインインする'} disabled={busy || code.length !== 6} onPress={verify} />
          <Button title="メールアドレスを入れ直す" variant="ghost" small onPress={() => setSentTo(null)} />
        </Card>
      )}
    </>
  );
}

function SignedIn() {
  const router = useRouter();
  const team = useTeamState();
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showDialog('確認してください', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const id = await createTeam(name);
      setName('');
      router.push(`/team/${id}`);
    });
  const join = () =>
    run(async () => {
      const id = await acceptInvite(invite);
      setInvite('');
      router.push(`/team/${id}`);
    });
  const confirmSignOut = () =>
    showDialog(
      'サインアウトしますか？',
      team.pending > 0
        ? `まだ送っていない変更が ${team.pending} 件あります。サインアウトすると、その変更は消えます。個人の記録は残ります。`
        : 'この端末から、チームの内容を消します（サーバーには残り、もう一度サインインすれば戻ります）。個人の記録は残ります。',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'サインアウト', style: 'destructive', onPress: () => void run(signOut) },
      ],
    );

  const owned = team.spaces.filter((s) => s.role === 'owner');
  const confirmDeleteAccount = () =>
    showDialog(
      'アカウントを削除しますか？',
      [
        owned.length > 0
          ? `あなたが運営者のチーム（${owned.map((s) => `「${s.name}」`).join('、')}）は、試合と名簿ごと消えます。メンバー全員が開けなくなります。`
          : '',
        'メンバーとして入っているチームからは抜けます。そこで記録した試合は、チームに残ります。',
        'この端末の個人の記録は残ります。元に戻せません。',
      ]
        .filter(Boolean)
        .join('\n\n'),
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除する', style: 'destructive', onPress: () => void run(deleteAccount) },
      ],
    );

  return (
    <>
      <SectionTitle>所属チーム</SectionTitle>
      {team.spaces.length === 0 && <Text style={styles.note}>まだチームに入っていません。下から、作るか、招待で入ってください。</Text>}
      {team.spaces.map((s) => (
        <Pressable
          key={s.id}
          accessibilityRole="button"
          accessibilityLabel={s.name}
          onPress={() => router.push(`/team/${s.id}`)}
          style={({ pressed }) => [styles.teamRow, pressed && styles.pressed]}
        >
          <View style={styles.flex}>
            <Text style={styles.teamName} numberOfLines={1}>
              {s.name}
            </Text>
            <Text style={styles.teamMeta}>
              {s.role === 'owner' ? '運営者' : 'メンバー'}　{s.memberCount}人
            </Text>
          </View>
          <Text style={[styles.badge, s.active ? styles.badgeOk : styles.badgeOff]}>{s.active ? '利用中' : '利用できません'}</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.sub} />
        </Pressable>
      ))}

      {owned.length > 0 && <PlanCard />}

      <SectionTitle>招待で入る</SectionTitle>
      <Card>
        <Text style={styles.body}>チームの人から届いた招待のリンクかコードを、そのまま貼ってください。</Text>
        <Row>
          <TextInput
            value={invite}
            onChangeText={setInvite}
            placeholder="招待のリンク・コード"
            placeholderTextColor={colors.sub}
            autoCapitalize="none"
            autoCorrect={false}
            style={[ui.input, styles.flex]}
          />
          <Button title="参加" disabled={busy || !invite.trim()} onPress={join} />
        </Row>
      </Card>

      <SectionTitle>チームを作る</SectionTitle>
      <Card>
        <Text style={styles.body}>作った人が運営者になります。いまの自チームの名簿が、チームの名簿になります。</Text>
        <Row>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="チーム名"
            placeholderTextColor={colors.sub}
            maxLength={60}
            style={[ui.input, styles.flex]}
          />
          <Button title="作る" disabled={busy || !name.trim()} onPress={create} />
        </Row>
      </Card>

      <SectionTitle>アカウント</SectionTitle>
      <Card>
        <Text style={styles.body}>{team.email}</Text>
        <Text style={styles.label}>メンバーに見せる名前</Text>
        <CommitInput
          value={team.displayName}
          placeholder="例：マネージャー 山田"
          maxLength={40}
          onCommit={(v) => void run(() => setDisplayName(v))}
        />
        <Button title="サインアウト" variant="secondary" small onPress={confirmSignOut} />
      </Card>
      <View style={styles.footer}>
        <Button title="アカウントを削除" variant="ghost" small disabled={busy} onPress={confirmDeleteAccount} />
      </View>
    </>
  );
}

const formatDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

/** 運営者の契約の状態 */
function PlanCard() {
  const team = useTeamState();
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const paid = team.spaces.filter((s) => s.role === 'owner' && !s.complimentary);
  const used = paid.filter((s) => s.slotAssigned).length;
  if (paid.length === 0) return null;
  const sub = team.subscription;
  return (
    <>
      <SectionTitle>契約</SectionTitle>
      <Card>
        {sub && isSubscribed(sub, now) ? (
          <>
            <Text style={styles.lead}>チームプラン（{sub.tier}チーム）</Text>
            <Text style={styles.body}>
              {formatDate(sub.expiresAt)} まで。{used} / {sub.tier} チームに割り当てています。割り当ては、各チームの画面で入れ替えられます。
            </Text>
            <Button title="契約の内容を見る・変える" variant="secondary" small onPress={() => router.push('/team/plan')} />
          </>
        ) : (
          <>
            <Text style={styles.lead}>契約がありません</Text>
            <Text style={styles.body}>
              {sub ? `${formatDate(sub.expiresAt)} に契約が切れました。` : ''}
              チームをメンバー全員で使うには、チームプランの契約が必要です。
            </Text>
            <Button title="料金を見て契約する" variant="accent" onPress={() => router.push('/team/plan')} />
          </>
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  lead: { fontSize: 17, fontWeight: '800', color: colors.text },
  body: { fontSize: 14, lineHeight: 21, color: colors.text },
  label: { fontSize: 12, fontWeight: '700', color: colors.sub },
  note: { fontSize: 13, color: colors.sub },
  footer: { marginTop: 8, alignItems: 'center' },
  provider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 52,
    borderRadius: radius.md,
  },
  providerDark: { backgroundColor: '#000000' },
  providerLight: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  providerText: { fontSize: 17, fontWeight: '700' },
  code: { fontSize: 24, letterSpacing: 6, textAlign: 'center' },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 68,
    paddingHorizontal: 16,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
  },
  teamName: { fontSize: 16, fontWeight: '800', color: colors.text },
  teamMeta: { fontSize: 12, color: colors.sub },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  badgeOk: { backgroundColor: colors.okBg, color: colors.ok },
  badgeOff: { backgroundColor: colors.disabledBg, color: colors.mute },
});
