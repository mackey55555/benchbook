/**
 * RevenueCat の購読情報から、契約の段階（チーム数）と期限を決める。
 * 通信や環境に依存しない部分だけをここに置き、アプリ側のテスト（jest）でも確かめる。
 *
 * 商品ID：team_<チーム数>_monthly / team_<チーム数>_yearly（チーム数は1〜5）
 */

export const MAX_TIER = 5;

export interface RcSubscription {
  /** 期限（ISO文字列）。null は期限なし */
  expires_date: string | null;
  /** 返金された日時。入っていれば無効 */
  refunded_at?: string | null;
  store?: string | null;
  original_transaction_id?: string | null;
}

export interface Entitlement {
  tier: number;
  /** 期限（ISO文字列） */
  expiresAt: string;
  productId: string;
  store: string;
  originalTransactionId: string | null;
}

/** 商品IDから段階を読む。チームプランの商品でなければ null */
export function tierOf(productId: string): number | null {
  // Google Play は「商品ID:プランID」の形で来ることがあるので、前半だけを見る
  const match = productId.split(':')[0].match(/^team_([1-5])_(monthly|yearly)$/);
  return match ? Number(match[1]) : null;
}

/**
 * いま有効な購読のうち、段階がいちばん高いものを返す。
 * 有効なものがなければ、いちばん最後に切れたものを返す（期限が過去なので、契約なしとして扱われる）。
 * チームプランの購読が1つもなければ null。
 */
export function pickEntitlement(subscriptions: Record<string, RcSubscription>, now: number): Entitlement | null {
  const all: (Entitlement & { active: boolean; time: number })[] = [];
  for (const [productId, sub] of Object.entries(subscriptions)) {
    const tier = tierOf(productId);
    if (tier === null || !sub.expires_date) continue;
    const time = Date.parse(sub.expires_date);
    if (!Number.isFinite(time)) continue;
    // 返金されたものは、その時点で切れたことにする
    const refunded = sub.refunded_at ? Date.parse(sub.refunded_at) : NaN;
    const end = Number.isFinite(refunded) ? Math.min(time, refunded) : time;
    all.push({
      tier,
      expiresAt: new Date(end).toISOString(),
      productId,
      store: sub.store ?? 'app_store',
      originalTransactionId: sub.original_transaction_id ?? null,
      active: end > now,
      time: end,
    });
  }
  if (all.length === 0) return null;
  const active = all.filter((e) => e.active);
  const best = active.length
    ? active.sort((a, b) => b.tier - a.tier || b.time - a.time)[0]
    : all.sort((a, b) => b.time - a.time)[0];
  return {
    tier: best.tier,
    expiresAt: best.expiresAt,
    productId: best.productId,
    store: best.store,
    originalTransactionId: best.originalTransactionId,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 通知に出てくる利用者IDのうち、このアプリの利用者ID（UUID）だけを取り出す。匿名IDは捨てる */
export function userIdsOf(event: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && UUID.test(value)) ids.add(value.toLowerCase());
  };
  add(event.app_user_id);
  add(event.original_app_user_id);
  for (const key of ['aliases', 'transferred_from', 'transferred_to']) {
    const list = event[key];
    if (Array.isArray(list)) list.forEach(add);
  }
  return [...ids];
}
