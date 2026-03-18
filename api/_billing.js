import { getSupabaseAdmin, requireUser } from './_supabase.js'

const PLAN_LIMITS = {
  trial: { imagePerDay: 3, videoPerDay: 3, llmPerDay: 30 },
  basic: { imagePerDay: 20, videoPerDay: 20, llmPerDay: 200 },
  pro: { imagePerDay: 1000000, videoPerDay: 1000000, llmPerDay: 1000000 },
  enterprise: { imagePerDay: 1000000, videoPerDay: 1000000, llmPerDay: 1000000 },
}

function dayStartIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function requireActiveSubscription(req) {
  const { user, token } = await requireUser(req)
  const admin = getSupabaseAdmin()

  const { data: sub } = await admin.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle()
  if (!sub) throw new Error('未开通套餐')
  if (sub.status !== 'active') throw new Error('套餐未生效')
  if (new Date(sub.current_period_end).getTime() <= Date.now()) throw new Error('套餐已到期')

  return { user, token, subscription: sub }
}

export async function checkAndConsume(req, opts) {
  const { user, subscription } = await requireActiveSubscription(req)
  const admin = getSupabaseAdmin()

  const idem = String(req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'] || '').trim()
  if (!idem) throw new Error('缺少 Idempotency-Key（防止重复扣费）')

  // If already consumed for this key, return previous result.
  const { data: existing } = await admin
    .from('usage_ledger')
    .select('*')
    .eq('user_id', user.id)
    .eq('request_idempotency_key', idem)
    .maybeSingle()
  if (existing?.result_json) return { user, subscription, already: true, result: existing.result_json }

  const planId = String(subscription.plan_id || 'trial')
  const limits = PLAN_LIMITS[planId] || PLAN_LIMITS.trial
  const limit = opts.type === 'image' ? limits.imagePerDay : opts.type === 'video' ? limits.videoPerDay : limits.llmPerDay

  const startIso = dayStartIso()
  const { count } = await admin
    .from('usage_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('type', opts.type)
    .gte('created_at', startIso)
  if ((count || 0) >= limit) throw new Error('今日额度已用尽，请升级套餐')

  // Reserve a ledger row (idempotency unique index will protect duplicates)
  const insert = await admin.from('usage_ledger').insert({
    user_id: user.id,
    type: opts.type,
    units: opts.units || 1,
    request_idempotency_key: idem,
    related_task_id: opts.relatedTaskId || null,
    result_json: opts.resultJson || null,
  })

  // if duplicate key, ignore
  if (insert.error && String(insert.error.code || '').toLowerCase() !== '23505') {
    throw new Error('计费记录写入失败')
  }

  return { user, subscription, already: false }
}

export async function finalizeConsumption(req, resultJson, relatedTaskId) {
  const { user } = await requireUser(req)
  const admin = getSupabaseAdmin()
  const idem = String(req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'] || '').trim()
  if (!idem) return

  await admin
    .from('usage_ledger')
    .update({ result_json: resultJson || null, related_task_id: relatedTaskId || null })
    .eq('user_id', user.id)
    .eq('request_idempotency_key', idem)
}

