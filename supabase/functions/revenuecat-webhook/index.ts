// RevenueCat からの通知（Webhook）を受けて、運営者の契約（subscriptions）を最新にする。
//
// 通知の中身は信用せず、「この利用者の契約が変わったらしい」という合図としてだけ使う。
// 実際の状態は、RevenueCat に問い合わせて取り直す（通知の順番が前後しても、最後は正しい状態になる）。
//
// 必要な設定（supabase secrets set）
//   REVENUECAT_WEBHOOK_AUTH : RevenueCat の Webhook 設定に入れる Authorization ヘッダーの値
//   REVENUECAT_SECRET_KEY   : RevenueCat のシークレットAPIキー（sk_...）
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { pickEntitlement, userIdsOf, type RcSubscription } from './entitlement.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fetchSubscriptions(userId: string, secretKey: string): Promise<Record<string, RcSubscription>> {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error(`RevenueCat ${res.status}`);
  const body = await res.json();
  return (body?.subscriber?.subscriptions ?? {}) as Record<string, RcSubscription>;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
  const secretKey = Deno.env.get('REVENUECAT_SECRET_KEY');
  if (!expected || !secretKey) return json(500, { error: 'not configured' });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (req.headers.get('Authorization') !== expected) return json(401, { error: 'unauthorized' });

  let event: Record<string, unknown>;
  try {
    event = ((await req.json()) as { event?: Record<string, unknown> }).event ?? {};
  } catch {
    return json(400, { error: 'bad request' });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const results: Record<string, string> = {};
  for (const userId of userIdsOf(event)) {
    // 失敗したら 500 を返す（RevenueCat が時間をおいて送り直す）
    const entitlement = pickEntitlement(await fetchSubscriptions(userId, secretKey), Date.now());
    if (!entitlement) {
      results[userId] = 'none';
      continue;
    }
    const { error } = await admin.from('subscriptions').upsert(
      {
        user_id: userId,
        tier: entitlement.tier,
        expires_at: entitlement.expiresAt,
        product_id: entitlement.productId,
        store: entitlement.store,
        original_transaction_id: entitlement.originalTransactionId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    // 利用者がもういない（アカウントを削除した）場合は、送り直しても直らないので成功として返す
    if (error && error.code !== '23503') throw new Error(error.message);
    results[userId] = error ? 'user gone' : `tier ${entitlement.tier}`;
  }
  return json(200, { ok: true, results });
});
