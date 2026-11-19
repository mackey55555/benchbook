-- 契約の枠の数を、チームが有効かどうかの判定に反映する（docs/SPEC.md 10-2b）
--
-- これまでは「枠を割り当てた」印だけを見ていたので、段階を下げたあとも、割り当て済みのチームが
-- すべて有効のままになった。段階（tier）の数だけ、割り当てた順の古いチームから有効にする。
-- 外れたチームは開けなくなるだけで、内容は消えない（運営者が割り当てを入れ替えれば戻る）。

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
              and s.expires_at > now()
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

-- 特別扱いのチームは、契約の枠を使わない
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
    select tier into v_tier from subscriptions where user_id = v_user and expires_at > now();
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
