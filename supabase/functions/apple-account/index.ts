// 「Appleでサインイン」の連携を解除できるようにする（Appleの審査の決まり 5.1.1(v)）。
//
//   { action: 'store', code }  サインインの直後に呼ぶ。Appleから受け取った認可コードを、
//                              連携の解除に使う鍵（リフレッシュトークン）に換えて保存する
//   { action: 'revoke' }       アカウントを削除する直前に呼ぶ。保存してある鍵で、Apple側の連携を解除する
//
// どちらも、失敗してもサインインやアカウントの削除は止めない（アプリ側は結果を待つだけで、失敗は無視する）。
//
// 必要な設定（supabase secrets set）。入っていなければ、何もせずに成功を返す
//   APPLE_TEAM_ID     : Appleのチーム ID
//   APPLE_KEY_ID      : 「Sign in with Apple」を有効にしたキーの ID
//   APPLE_PRIVATE_KEY : そのキーの .p8 ファイルの中身
//   APPLE_CLIENT_ID   : アプリのバンドル ID
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SignJWT, importPKCS8 } from 'npm:jose@5';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Appleに自分（このアプリ）を示すための署名つきの札。使うたびに作る（有効期限は5分） */
async function clientSecret(teamId: string, keyId: string, privateKey: string, clientId: string): Promise<string> {
  const key = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setAudience('https://appleid.apple.com')
    .setSubject(clientId)
    .sign(key);
}

async function post(path: string, form: Record<string, string>): Promise<Response> {
  return await fetch(`https://appleid.apple.com/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  // 呼んだ人を確かめる（関数の入口では JWT を確かめていないので、ここで確かめる）
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json(401, { error: 'unauthorized' });
  const userId = auth.user.id;

  let body: { action?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad request' });
  }

  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const privateKey = Deno.env.get('APPLE_PRIVATE_KEY');
  const clientId = Deno.env.get('APPLE_CLIENT_ID');
  if (!teamId || !keyId || !privateKey || !clientId) return json(200, { ok: false, reason: 'not configured' });
  const secret = await clientSecret(teamId, keyId, privateKey, clientId);

  if (body.action === 'store') {
    if (typeof body.code !== 'string' || body.code === '') return json(400, { error: 'bad request' });
    const res = await post('token', {
      client_id: clientId,
      client_secret: secret,
      code: body.code,
      grant_type: 'authorization_code',
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || typeof result.refresh_token !== 'string') {
      return json(200, { ok: false, reason: `apple ${res.status} ${result.error ?? ''}`.trim() });
    }
    const { error } = await admin
      .from('apple_tokens')
      .upsert({ user_id: userId, refresh_token: result.refresh_token, updated_at: new Date().toISOString() });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  if (body.action === 'revoke') {
    const { data, error } = await admin.from('apple_tokens').select('refresh_token').eq('user_id', userId).maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data) return json(200, { ok: true, revoked: false });
    const res = await post('revoke', {
      client_id: clientId,
      client_secret: secret,
      token: data.refresh_token,
      token_type_hint: 'refresh_token',
    });
    if (!res.ok) return json(200, { ok: false, reason: `apple ${res.status}` });
    await admin.from('apple_tokens').delete().eq('user_id', userId);
    return json(200, { ok: true, revoked: true });
  }

  return json(400, { error: 'bad request' });
});
