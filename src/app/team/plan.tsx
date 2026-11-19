import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  MAX_TIER,
  PurchaseCanceled,
  loadProducts,
  openManage,
  productId,
  purchase,
  purchaseEnabled,
  restore,
  type Period,
  type PlanProduct,
} from '@/billing/purchases';
import { awaitSubscription, errorMessage, isSubscribed, useTeamState } from '@/sync/session';
import { Button, Card, SectionTitle, Segmented } from '@/ui/components';
import { showDialog } from '@/ui/dialog';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const PRIVACY_URL = 'https://arti-lab.jp/products/benchbook/privacy';

const TIERS = Array.from({ length: MAX_TIER }, (_, i) => ({ value: i + 1, label: `${i + 1}` }));
const PERIODS: { value: Period; title: string; unit: string }[] = [
  { value: 'monthly', title: '月払い', unit: '月' },
  { value: 'yearly', title: '年払い', unit: '年' },
];

const formatDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

type Products = Map<string, PlanProduct> | 'loading' | 'error';

/**
 * 開発用：購入できない端末（Android のエミュレータなど）でも、画面の並びを確かめられるように見本の料金を出す。
 * 見本のときは買えない。製品のビルドでは出ない。
 */
const preview = __DEV__ && !purchaseEnabled;
const SAMPLE: Products = new Map(
  TIERS.flatMap(({ value }) =>
    (['monthly', 'yearly'] as const).map((period): [string, PlanProduct] => {
      const id = productId(value, period);
      return [id, { id, price: `¥${((period === 'monthly' ? 980 : 9800) * value).toLocaleString('en-US')}` }];
    }),
  ),
);

/** チームプランの契約（購入・変更・復元・解約への入口）。運営者が使う */
export default function PlanScreen() {
  const team = useTeamState();
  const [now] = useState(() => Date.now());
  const sub = team.subscription;
  const subscribed = isSubscribed(sub, now);
  const owned = team.spaces.filter((s) => s.role === 'owner' && !s.complimentary).length;

  const current = subscribed && sub ? /^team_(\d)_(monthly|yearly)$/.exec(sub.productId) : null;
  const [tier, setTier] = useState(() => (current ? Number(current[1]) : Math.min(MAX_TIER, Math.max(1, owned))));
  const [period, setPeriod] = useState<Period>(() => (current ? (current[2] as Period) : 'yearly'));
  const [products, setProducts] = useState<Products>(preview ? SAMPLE : 'loading');
  const [busy, setBusy] = useState(false);

  const userId = team.userId;
  useEffect(() => {
    if (!purchaseEnabled || !userId) return;
    let alive = true;
    loadProducts(userId).then(
      (map) => alive && setProducts(map.size > 0 ? map : 'error'),
      () => alive && setProducts('error'),
    );
    return () => {
      alive = false;
    };
  }, [userId]);

  if (!userId) {
    return (
      <View style={styles.container}>
        <Text style={styles.note}>契約するには、先にサインインしてください。</Text>
      </View>
    );
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      if (!(e instanceof PurchaseCanceled)) showDialog('うまくいきませんでした', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const selected = productId(tier, period);
  const same = subscribed && sub?.productId === selected;

  const buy = () =>
    run(async () => {
      await purchase(userId, selected);
      if (await awaitSubscription(selected)) {
        showDialog('契約しました', '運営しているチームに、契約の枠を割り当てました。割り当ては、各チームの画面で入れ替えられます。');
      } else if (subscribed) {
        showDialog('変更を受け付けました', 'チーム数を減らす変更などは、次の更新日から切り替わります。');
      } else {
        showDialog('反映を待っています', '購入は完了しています。反映に少し時間がかかっています。しばらくしてから、この画面を開き直してください。');
      }
    });

  const restorePurchase = () =>
    run(async () => {
      await restore(userId);
      if (await awaitSubscription()) showDialog('契約を復元しました');
      else showDialog('復元できる契約がありません', 'この Apple ID で買った、有効な契約が見つかりませんでした。');
    });

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
      <Card>
        {subscribed && sub ? (
          <>
            <Text style={styles.lead}>契約中：{sub.tier}チーム</Text>
            <Text style={styles.body}>{formatDate(sub.expiresAt)} に更新されます（解約済みの場合は、この日まで使えます）。</Text>
          </>
        ) : (
          <>
            <Text style={styles.lead}>チームプラン</Text>
            <Text style={styles.body}>
              契約すると、運営しているチームをメンバー全員で使えます。メンバーは何人でも、料金は変わりません。払うのは運営者だけです。
            </Text>
          </>
        )}
      </Card>

      {!purchaseEnabled && !preview ? (
        <Card>
          <Text style={styles.body}>契約の手続きは、iPhone のアプリで行ってください。</Text>
        </Card>
      ) : (
        <>
          <SectionTitle>チーム数</SectionTitle>
          <Card>
            <Segmented options={TIERS} value={tier} onChange={setTier} />
            <Text style={styles.note}>
              契約したチーム数まで、運営しているチームを使えます。いま運営しているのは {owned} チームです。
            </Text>
          </Card>

          <SectionTitle>支払い</SectionTitle>
          {products === 'loading' ? (
            <ActivityIndicator style={styles.loading} />
          ) : products === 'error' ? (
            <Card>
              <Text style={styles.body}>料金を読み込めませんでした。通信の状況を確かめて、この画面を開き直してください。</Text>
            </Card>
          ) : (
            PERIODS.map((p) => {
              const product = products.get(productId(tier, p.value));
              const active = period === p.value;
              return (
                <Pressable
                  key={p.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, disabled: !product }}
                  disabled={!product}
                  onPress={() => setPeriod(p.value)}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={24}
                    color={active ? colors.primary : colors.sub}
                  />
                  <Text style={styles.optionTitle}>{p.title}</Text>
                  <Text style={styles.optionPrice}>{product ? `${product.price} / ${p.unit}` : '準備中'}</Text>
                </Pressable>
              );
            })
          )}

          <Button
            title={same ? 'このプランで契約中です' : subscribed ? 'このプランに変更する' : '契約する'}
            variant="accent"
            disabled={busy || preview || same || typeof products === 'string' || !products.has(selected)}
            onPress={buy}
          />

          {preview && <Text style={styles.note}>見本の表示です（開発用）。料金は仮のもので、この端末では契約できません。</Text>}

          <Text style={styles.note}>
            契約は自動で更新されます。更新日の24時間前までに解約しなければ、同じ期間・同じ料金で更新されます。料金は Apple
            ID に請求されます。解約は、下の「契約の管理・解約」から行えます。
          </Text>

          <View style={styles.links}>
            <Button title="購入を復元" variant="ghost" small disabled={busy} onPress={restorePurchase} />
            <Button
              title="契約の管理・解約"
              variant="ghost"
              small
              disabled={busy}
              onPress={() => void run(() => openManage(userId))}
            />
          </View>
        </>
      )}

      <View style={styles.links}>
        <Button title="利用規約" variant="ghost" small onPress={() => void Linking.openURL(TERMS_URL)} />
        <Button title="プライバシーポリシー" variant="ghost" small onPress={() => void Linking.openURL(PRIVACY_URL)} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  lead: { fontSize: 17, fontWeight: '800', color: colors.text },
  body: { fontSize: 14, lineHeight: 21, color: colors.text },
  note: { fontSize: 13, lineHeight: 19, color: colors.sub },
  loading: { marginVertical: 24 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionActive: { borderColor: colors.primary },
  optionTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
  optionPrice: { fontSize: 16, fontWeight: '700', color: colors.text },
  links: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 4 },
});
