-- 契約の期限に、1日のゆとりを持たせる（docs/SPEC.md 10-6b）
--
-- 更新の知らせ（ストア → RevenueCat → このサーバー）は、期限より遅れて届くことがある。
-- 試験環境では、期限から4分半たって届いた（2026-11-19）。その間チームが使えなくなると、
-- メンバーの端末から、ほかの人が記録した試合がいったん消えてしまう。
-- 期限を過ぎても1日は有効として扱い、知らせの遅れで止まらないようにする。

create function public.subscription_grace() returns interval
language sql immutable as $$ select interval '1 day' $$;

create or replace function public.team_is_active(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from teams t
    where t.id = p_team
      and t.deleted_at is null
      and (
        t.complimentary
        or (
          t.slot_assigned
          and exists (
            select 1
            from subscriptions s
            where s.user_id = t.owner_id
              and s.expires_at + public.subscription_grace() > now()
              and (
                select count(*)
                from teams o
                where o.owner_id = t.owner_id
                  and o.slot_assigned
                  and o.deleted_at is null
                  and not o.complimentary
                  and (o.slot_assigned_at, o.id) < (t.slot_assigned_at, t.id)
              ) < s.tier
          )
        )
      )
  );
$$;

create or replace function public.set_team_slot(p_team uuid, p_assigned boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_tier integer;
begin
  if not exists (select 1 from teams where id = p_team and owner_id = v_user and deleted_at is null) then
    raise exception 'このチームの運営者ではありません' using errcode = '42501';
  end if;
  if p_assigned then
    select tier into v_tier from subscriptions
    where user_id = v_user and expires_at + public.subscription_grace() > now();
    if v_tier is null then raise exception '有効な契約がありません' using errcode = 'P0001'; end if;
    if (select count(*) from teams
        where owner_id = v_user and slot_assigned and deleted_at is null and not complimentary and id <> p_team) >= v_tier then
      raise exception '契約しているチーム数の上限です。ほかのチームの割り当てを外してから、もう一度試してください' using errcode = 'P0001';
    end if;
  end if;
  update teams
  set slot_assigned = p_assigned, slot_assigned_at = case when p_assigned then now() else null end
  where id = p_team;
end;
$$;
