-- Appleでサインインした利用者の、連携を解除するための鍵（リフレッシュトークン）を置く。
--
-- Appleの審査の決まり（5.1.1(v)）：「Appleでサインイン」を使うアプリは、アカウントを削除するときに
-- Apple側の連携も解除しなければならない。解除にはこの鍵が要るので、サインインのときに受け取って保存し、
-- 削除のときに使う（supabase/functions/apple-account）。
-- 利用者からは読めず、書けない。関数がサービス用の権限で扱う。利用者が消えると一緒に消える。

create table public.apple_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.apple_tokens enable row level security;
revoke all on public.apple_tokens from anon, authenticated;
