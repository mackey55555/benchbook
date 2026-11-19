-- アカウントの削除（ストアの審査で必須。docs/SPEC.md 10章）
--
-- - 自分が運営者のチームは、内容ごと消える（メンバー全員が開けなくなる）
-- - メンバーとして入っているチームからは抜ける。そこで記録した試合はチームに残り、記録した人は空になる
-- - 契約とプロフィールは、利用者の行と一緒に消える

-- 記録した人がいなくなっても、試合は残す
alter table public.games alter column created_by drop not null;
alter table public.games drop constraint games_created_by_fkey;
alter table public.games add constraint games_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

-- 招待は、作った人がいなくなったら無効にする
alter table public.team_invites drop constraint team_invites_created_by_fkey;
alter table public.team_invites add constraint team_invites_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete cascade;

-- 記録した人が空の試合（退会した人の試合）を消せるのは、運営者だけ
-- 呼び出した人の権限で動かす（current_user で、端末からの更新かどうかを見分けるため）
create or replace function public.guard_game_delete() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and auth.uid() is not null
     and old.created_by is distinct from auth.uid()
     and not public.is_team_owner(old.team_id) then
    raise exception 'ほかの人が記録した試合を削除できるのは運営者だけです' using errcode = '42501';
  end if;
  -- 端末からは、記録した人と所属チームを書き換えさせない
  -- （利用者の削除で記録した人を空にする処理は、サーバーの権限で動くので通る）
  if current_user = 'authenticated' then
    new.created_by := old.created_by;
    new.team_id := old.team_id;
  end if;
  return new;
end;
$$;

-- 自分のアカウントを削除する
create function public.delete_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'サインインが必要です' using errcode = '28000'; end if;
  -- 運営しているチームは、内容ごと消す
  delete from teams where owner_id = v_user;
  -- 残りの所属・契約・プロフィール・招待は、利用者の行と一緒に消える
  delete from auth.users where id = v_user;
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
