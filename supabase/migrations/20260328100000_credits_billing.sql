-- 积分制计费：用户余额 + 占位 ledger（units=0）+ 成片扣费
-- 在 Supabase SQL Editor 执行本文件，或 supabase db push

alter table public.users add column if not exists credits integer not null default 0 check (credits >= 0);

-- 允许 usage_ledger.units = 0（提交占位 / 视频成片单独记账）
alter table public.usage_ledger drop constraint if exists usage_ledger_units_check;
alter table public.usage_ledger add constraint usage_ledger_units_check check (units >= 0);

-- 已有用户：试用档可一次性补 9 积分（按需取消注释）
-- update public.users u set credits = greatest(credits, 9)
-- from public.subscriptions s
-- where s.user_id = u.id and s.plan_id = 'trial' and s.status = 'active';
