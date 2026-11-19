import { pickEntitlement, tierOf, userIdsOf } from '../../../supabase/functions/revenuecat-webhook/entitlement';

const NOW = Date.parse('2026-12-01T00:00:00Z');
const future = '2027-01-01T00:00:00Z';
const past = '2026-11-01T00:00:00Z';

describe('契約の判定（RevenueCatの購読情報から）', () => {
  test('商品IDから段階を読む', () => {
    expect(tierOf('team_1_monthly')).toBe(1);
    expect(tierOf('team_5_yearly')).toBe(5);
    expect(tierOf('team_3_yearly:base')).toBe(3);
    expect(tierOf('team_6_monthly')).toBeNull();
    expect(tierOf('something_else')).toBeNull();
  });

  test('有効な購読のうち、段階がいちばん高いものを選ぶ', () => {
    const e = pickEntitlement(
      {
        team_1_monthly: { expires_date: future },
        team_3_yearly: { expires_date: future, original_transaction_id: 'T3' },
        team_5_monthly: { expires_date: past },
      },
      NOW,
    );
    expect(e).toMatchObject({ tier: 3, productId: 'team_3_yearly', originalTransactionId: 'T3' });
    expect(Date.parse(e!.expiresAt)).toBeGreaterThan(NOW);
  });

  test('有効なものがなければ、最後に切れたものを返す（期限は過去）', () => {
    const e = pickEntitlement(
      { team_2_monthly: { expires_date: '2026-10-01T00:00:00Z' }, team_1_monthly: { expires_date: past } },
      NOW,
    );
    expect(e).toMatchObject({ tier: 1, productId: 'team_1_monthly' });
    expect(Date.parse(e!.expiresAt)).toBeLessThan(NOW);
  });

  test('返金された購読は、返金の時点で切れたことにする', () => {
    const e = pickEntitlement({ team_2_yearly: { expires_date: future, refunded_at: past } }, NOW);
    expect(Date.parse(e!.expiresAt)).toBeLessThan(NOW);
  });

  test('チームプランの購読がなければ null', () => {
    expect(pickEntitlement({}, NOW)).toBeNull();
    expect(pickEntitlement({ other: { expires_date: future } }, NOW)).toBeNull();
  });

  test('通知から、このアプリの利用者IDだけを取り出す', () => {
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    expect(
      userIdsOf({
        app_user_id: '$RCAnonymousID:abc',
        original_app_user_id: a,
        aliases: [a, '$RCAnonymousID:abc'],
        transferred_to: [b.toUpperCase()],
      }).sort(),
    ).toEqual([a, b]);
    expect(userIdsOf({})).toEqual([]);
  });
});
