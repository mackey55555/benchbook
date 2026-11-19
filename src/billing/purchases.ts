import { Platform } from 'react-native';

import { teamEnabled } from '@/sync/client';

/**
 * チームプランの購入（App Store のサブスクリプション）。RevenueCat の SDK を通して買う。
 *
 * - 利用者IDは、サインインした利用者のID（Supabase の UUID）をそのまま使う。
 * - 契約の状態は、アプリでは判定しない。RevenueCat がサーバーに通知し（supabase/functions/revenuecat-webhook）、
 *   アプリはサーバーの subscriptions を読む（src/sync/session.ts）。
 * - SDK はネイティブのモジュールなので、使うときに読み込む（入っていない古い開発用アプリでも、ほかの画面は動く）。
 */
const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';

/** この端末で購入の手続きができるか（iPhone で、キーが入っているビルドだけ） */
export const purchaseEnabled = teamEnabled && Platform.OS === 'ios' && apiKey !== '';

export const MAX_TIER = 5;
export type Period = 'monthly' | 'yearly';

/** 商品ID。supabase/functions/revenuecat-webhook/entitlement.ts の tierOf と対になる */
export const productId = (tier: number, period: Period): string => `team_${tier}_${period}`;

const ALL_PRODUCT_IDS = Array.from({ length: MAX_TIER }, (_, i) => i + 1).flatMap((tier) => [
  productId(tier, 'monthly'),
  productId(tier, 'yearly'),
]);

export interface PlanProduct {
  id: string;
  /** ストアが返す、通貨つきの価格（例：¥980） */
  price: string;
}

/** 利用者が購入の画面を閉じた */
export class PurchaseCanceled extends Error {}

async function sdk() {
  return (await import('react-native-purchases')).default;
}

let identified: string | null = null;

/** サインインした利用者を、購入の持ち主として伝える */
export async function identify(userId: string): Promise<void> {
  if (!purchaseEnabled || identified === userId) return;
  const Purchases = await sdk();
  if (await Purchases.isConfigured()) await Purchases.logIn(userId);
  else Purchases.configure({ apiKey, appUserID: userId });
  identified = userId;
}

/** サインアウトしたとき。次の利用者に購入が引き継がれないようにする */
export async function forget(): Promise<void> {
  if (!purchaseEnabled || identified === null) return;
  identified = null;
  const Purchases = await sdk();
  if (await Purchases.isConfigured()) await Purchases.logOut();
}

async function ready(userId: string) {
  if (!purchaseEnabled) throw new Error('契約の手続きは、iPhone のアプリで行ってください');
  await identify(userId);
  return sdk();
}

/** ストアから商品（価格）を読む。商品IDごとに返す */
export async function loadProducts(userId: string): Promise<Map<string, PlanProduct>> {
  const Purchases = await ready(userId);
  const products = await Purchases.getProducts(ALL_PRODUCT_IDS, Purchases.PRODUCT_CATEGORY.SUBSCRIPTION);
  return new Map(products.map((p) => [p.identifier, { id: p.identifier, price: p.priceString }]));
}

/** 商品を買う。契約中にほかの商品を買うと、App Store がプランの変更として扱う */
export async function purchase(userId: string, id: string): Promise<void> {
  const Purchases = await ready(userId);
  const [product] = await Purchases.getProducts([id], Purchases.PRODUCT_CATEGORY.SUBSCRIPTION);
  if (!product) throw new Error('この商品は、いま購入できません');
  try {
    await Purchases.purchaseStoreProduct(product);
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'userCancelled' in e && e.userCancelled) throw new PurchaseCanceled();
    throw e;
  }
}

/** 同じ Apple ID で前に買った契約を、このアカウントに戻す */
export async function restore(userId: string): Promise<void> {
  const Purchases = await ready(userId);
  await Purchases.restorePurchases();
}

/** App Store の、サブスクリプションの管理（解約・変更）を開く */
export async function openManage(userId: string): Promise<void> {
  const Purchases = await ready(userId);
  await Purchases.showManageSubscriptions();
}
