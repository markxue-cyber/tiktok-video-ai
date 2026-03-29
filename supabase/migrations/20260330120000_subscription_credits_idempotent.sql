-- 每个订阅周期仅发放一次月积分（与 current_period_start 对齐），避免 /api/me 与 webhook 重复叠加
-- 在 Supabase SQL Editor 执行，或 supabase db push

alter table public.users add column if not exists credits_granted_for_period_start timestamptz;

create or replace function public.grant_subscription_credits_once(
  p_user_id uuid,
  p_period_start timestamptz,
  p_amount integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
begin
  if p_amount is null or p_amount <= 0 then
    select credits into v_credits from public.users where id = p_user_id;
    return coalesce(v_credits, 0);
  end if;

  update public.users
  set
    credits = credits + p_amount,
    credits_granted_for_period_start = p_period_start
  where id = p_user_id
    and (credits_granted_for_period_start is distinct from p_period_start);

  select credits into v_credits from public.users where id = p_user_id;
  return coalesce(v_credits, 0);
end;
$$;

revoke all on function public.grant_subscription_credits_once(uuid, timestamptz, integer) from public;
grant execute on function public.grant_subscription_credits_once(uuid, timestamptz, integer) to service_role;
