const PLAN_LIMITS = {
  trial: { imagePerDay: 3, videoPerDay: 3, llmPerDay: 30 },
  basic: { imagePerDay: 20, videoPerDay: 20, llmPerDay: 200 },
  pro: { imagePerDay: 1000000, videoPerDay: 1000000, llmPerDay: 1000000 },
  enterprise: { imagePerDay: 1000000, videoPerDay: 1000000, llmPerDay: 1000000 },
}

/** 与前端 src/lib/billingCredits.ts 一致 */
export const CREDITS_PER_IMAGE = 4
export const CREDITS_PER_VIDEO = 8

/** 加油包订单 plan_id；勿在 package_configs 中占用 */
export const TOPUP_PLAN_ID = 'credit_topup'

/** 每 1 元人民币兑换积分（与前端 `TOPUP_CREDITS_PER_YUAN` 对齐，可用环境变量覆盖） */
export function getTopupCreditsPerYuan() {
  const n = Number(process.env.TOPUP_CREDITS_PER_YUAN)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10
}

/** 整数元 → 积分（加油包） */
export function creditsForTopupYuan(yuan) {
  const y = Math.floor(Number(yuan))
  if (!Number.isFinite(y) || y <= 0) return 0
  return y * getTopupCreditsPerYuan()
}

/** 付费档每月发放积分（与 api/payments-webhook、package 文案一致） */
export const PLAN_MONTHLY_CREDITS = { trial: 0, basic: 99, pro: 880, enterprise: 2850 }
export const PAID_SUBSCRIPTION_PLANS = new Set(['basic', 'pro', 'enterprise'])

function mustEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function baseUrl() {
  const url = mustEnv('SUPABASE_URL')
  return String(url).replace(/\/$/, '')
}

function dayStartIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

async function fetchJsonOrText(resp) {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { _raw: text }
  }
}

function parseCountFromContentRange(cr) {
  const m = String(cr || '').match(/\/(\d+)\s*$/)
  return m ? Number.parseInt(m[1], 10) : null
}

function parseLedgerResultJson(rj) {
  if (rj == null || rj === '') return null
  if (typeof rj === 'string') {
    try {
      return JSON.parse(rj)
    } catch {
      return null
    }
  }
  if (typeof rj === 'object') return rj
  return null
}

function ledgerResultHasReplayableImage(rj) {
  const o = parseLedgerResultJson(rj)
  if (!o || typeof o !== 'object') return false
  const u = String(o.imageUrl || o.output_url || o.outputUrl || o.url || '').trim()
  return u.length > 0
}

function ledgerResultHasReplayableVideoTask(rj) {
  const o = parseLedgerResultJson(rj)
  if (!o || typeof o !== 'object') return false
  return String(o.taskId || '').trim().length > 0
}

function getIdem(req) {
  return String(req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'] || '').trim()
}

function serviceHeaders(extra = {}) {
  const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra,
  }
}

export async function requireUser(req) {
  const auth = String(req.headers?.authorization || '')
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new Error('未登录（缺少 Authorization Bearer token）')

  const anonKey = mustEnv('SUPABASE_ANON_KEY')
  const resp = await fetch(`${baseUrl()}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  })
  const data = await fetchJsonOrText(resp)
  if (!resp.ok) throw new Error(data?.error_description || data?.message || '登录已失效，请重新登录')
  const user = data?.user || data
  if (!user?.id && !user?.sub) throw new Error('登录已失效，请重新登录')
  return { user: { id: user.id || user.sub, email: user.email }, token }
}

export async function requireActiveSubscription(req) {
  const { user, token } = await requireUser(req)

  const subResp = await fetch(`${baseUrl()}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(user.id)}&select=*`, {
    method: 'GET',
    headers: serviceHeaders(),
  })
  const subJson = await fetchJsonOrText(subResp)
  const sub = Array.isArray(subJson) ? subJson[0] : subJson

  if (!sub) throw new Error('未开通套餐')
  if (sub.status !== 'active') throw new Error('套餐未生效')
  if (new Date(sub.current_period_end).getTime() <= Date.now()) throw new Error('套餐已到期')

  return { user, token, subscription: sub }
}

async function fetchLedgerRow(userId, idem) {
  const existingResp = await fetch(
    `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(userId)}&request_idempotency_key=eq.${encodeURIComponent(idem)}&select=*`,
    { method: 'GET', headers: serviceHeaders() },
  )
  const existingJson = await fetchJsonOrText(existingResp)
  return Array.isArray(existingJson) ? existingJson[0] : existingJson
}

export async function fetchUserCredits(userId) {
  const r = await fetch(`${baseUrl()}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=credits`, {
    method: 'GET',
    headers: serviceHeaders(),
  })
  const j = await fetchJsonOrText(r)
  if (!r.ok) {
    const msg = String(j?.message || j?.hint || '')
    if (/credits/i.test(msg) && (/does not exist|不存在/i.test(msg) || String(j?.code) === '42703')) {
      throw new Error(
        '数据库缺少 users.credits：请在 Supabase 执行 supabase/migrations/20260328100000_credits_billing.sql',
      )
    }
    throw new Error(j?.message || '读取积分失败')
  }
  const row = Array.isArray(j) ? j[0] : j
  const n = Number(row?.credits ?? 0)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

export async function deductUserCredits(userId, amount) {
  const n = Math.floor(Number(amount))
  if (!Number.isFinite(n) || n <= 0) return
  const cur = await fetchUserCredits(userId)
  if (cur < n) throw new Error('积分不足，请充值或升级套餐')
  const patchResp = await fetch(`${baseUrl()}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ credits: cur - n }),
  })
  if (!patchResp.ok) {
    const pj = await fetchJsonOrText(patchResp)
    throw new Error(pj?.message || '扣减积分失败')
  }
}

export async function grantUserCredits(userId, amount) {
  const n = Math.floor(Number(amount))
  if (!Number.isFinite(n) || n <= 0) return
  const cur = await fetchUserCredits(userId)
  const patchResp = await fetch(`${baseUrl()}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ credits: cur + n }),
  })
  if (!patchResp.ok) {
    const pj = await fetchJsonOrText(patchResp)
    throw new Error(pj?.message || '增加积分失败')
  }
}

/**
 * 当前订阅周期内仅加一次月积分（依赖 DB 函数 grant_subscription_credits_once）。
 * 与 webhook 共用，避免重复发放。
 */
export async function grantSubscriptionCreditsOnce(userId, periodStartIso, amount) {
  const amt = Math.floor(Number(amount))
  if (!Number.isFinite(amt) || amt <= 0) return fetchUserCredits(userId)
  const ps = String(periodStartIso || '').trim()
  if (!ps) return fetchUserCredits(userId)

  const r = await fetch(`${baseUrl()}/rest/v1/rpc/grant_subscription_credits_once`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_user_id: userId, p_period_start: ps, p_amount: amt }),
  })
  const j = await fetchJsonOrText(r)
  if (!r.ok) {
    const msg = String(j?.message || j?.hint || '')
    if (/grant_subscription_credits_once|function.*does not exist|42883/i.test(msg)) {
      throw new Error(
        '数据库缺少 grant_subscription_credits_once：请在 Supabase 执行 supabase/migrations/20260330120000_subscription_credits_idempotent.sql',
      )
    }
    throw new Error(j?.message || '发放订阅积分失败')
  }
  if (typeof j === 'number' && Number.isFinite(j)) return Math.max(0, Math.floor(j))
  const n = Number(j)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fetchUserCredits(userId)
}

/** 有效付费订阅且未过期时，确保本周期月积分已发放（幂等） */
export async function ensureMonthlyCreditsForActivePaidPlan(userId, subscription) {
  if (!subscription || subscription.status !== 'active') return fetchUserCredits(userId)
  const endMs = new Date(subscription.current_period_end).getTime()
  if (!Number.isFinite(endMs) || endMs <= Date.now()) return fetchUserCredits(userId)
  const planId = String(subscription.plan_id || '')
  if (!PAID_SUBSCRIPTION_PLANS.has(planId)) return fetchUserCredits(userId)
  const grant = PLAN_MONTHLY_CREDITS[planId]
  if (!grant || grant <= 0) return fetchUserCredits(userId)
  return grantSubscriptionCreditsOnce(userId, subscription.current_period_start, grant)
}

/** 先插入幂等行再扣余额，避免并发双扣 */
async function insertPrepaidCreditsLedger(userId, type, idem, creditsCost, relatedTaskId) {
  const insertResp = await fetch(`${baseUrl()}/rest/v1/usage_ledger`, {
    method: 'POST',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    }),
    body: JSON.stringify([
      {
        user_id: userId,
        type,
        units: 0,
        request_idempotency_key: idem,
        related_task_id: relatedTaskId || null,
        result_json: {
          creditsPrepaid: true,
          creditsCost: Math.floor(Number(creditsCost)),
          creditsRefunded: false,
        },
      },
    ]),
  })
  if (insertResp.ok) return { ok: true }
  if (insertResp.status === 409) return { conflict: true }
  const insertJson = await fetchJsonOrText(insertResp)
  throw new Error(insertJson?.message || '计费记录写入失败')
}

async function deleteLedgerByUserIdem(userId, idem) {
  await fetch(
    `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(userId)}&request_idempotency_key=eq.${encodeURIComponent(idem)}`,
    { method: 'DELETE', headers: serviceHeaders() },
  )
}

export async function checkAndConsume(req, opts) {
  const { user, subscription } = await requireActiveSubscription(req)
  const idem = getIdem(req)
  if (!idem) throw new Error('缺少 Idempotency-Key（防止重复扣费）')

  const existing = await fetchLedgerRow(user.id, idem)
  const creditsCostRaw = opts.creditsCost != null ? Number(opts.creditsCost) : NaN
  const useCredits =
    (opts.type === 'image' || opts.type === 'video') && Number.isFinite(creditsCostRaw) && creditsCostRaw > 0

  if (!useCredits) {
    if (ledgerResultHasReplayableImage(existing?.result_json)) {
      return { user, subscription, already: true, result: parseLedgerResultJson(existing.result_json) }
    }

    const planId = String(subscription.plan_id || 'trial')
    const limits = PLAN_LIMITS[planId] || PLAN_LIMITS.trial
    const limit = opts.type === 'image' ? limits.imagePerDay : opts.type === 'video' ? limits.videoPerDay : limits.llmPerDay

    const startIso = dayStartIso()
    const countUrl =
      `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(user.id)}` +
      `&type=eq.${encodeURIComponent(opts.type)}` +
      `&created_at=gte.${encodeURIComponent(startIso)}` +
      `&select=id`
    const countResp = await fetch(countUrl, {
      method: 'GET',
      headers: serviceHeaders({ Prefer: 'count=exact' }),
    })
    const cr = countResp.headers.get('content-range')
    const count = parseCountFromContentRange(cr) ?? 0
    if (count >= limit) throw new Error('今日额度已用尽，请升级套餐')

    const insertResp = await fetch(`${baseUrl()}/rest/v1/usage_ledger`, {
      method: 'POST',
      headers: serviceHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      }),
      body: JSON.stringify([
        {
          user_id: user.id,
          type: opts.type,
          units: opts.units || 1,
          request_idempotency_key: idem,
          related_task_id: opts.relatedTaskId || null,
          result_json: opts.resultJson || null,
        },
      ]),
    })

    if (!insertResp.ok) {
      const insertJson = await fetchJsonOrText(insertResp)
      if (insertResp.status !== 409) throw new Error(insertJson?.message || '计费记录写入失败')
    }

    return { user, subscription, already: false }
  }

  const creditsCost = Math.floor(creditsCostRaw)

  if (opts.type === 'image') {
    if (ledgerResultHasReplayableImage(existing?.result_json)) {
      return { user, subscription, already: true, result: parseLedgerResultJson(existing.result_json) }
    }
    const o = parseLedgerResultJson(existing?.result_json)
    if (o?.creditsPrepaid === true && o?.creditsRefunded !== true && !ledgerResultHasReplayableImage(existing?.result_json)) {
      throw new Error('同一出图请求正在处理中，请稍候再试')
    }
  }

  if (opts.type === 'video') {
    if (ledgerResultHasReplayableVideoTask(existing?.result_json)) {
      const o = parseLedgerResultJson(existing.result_json)
      return {
        user,
        subscription,
        already: true,
        result: { taskId: o.taskId, message: o.message || '视频生成中，预计需要3-5分钟' },
      }
    }
    const o = parseLedgerResultJson(existing?.result_json)
    if (o?.creditsPrepaid === true && o?.creditsRefunded !== true) {
      if (o?.taskId) {
        return {
          user,
          subscription,
          already: true,
          result: { taskId: o.taskId, message: o.message || '视频生成中，预计需要3-5分钟' },
        }
      }
      throw new Error('同一视频请求正在提交中，请稍候')
    }
  }

  const ins = await insertPrepaidCreditsLedger(user.id, opts.type, idem, creditsCost, opts.relatedTaskId)
  if (ins.conflict) {
    const ex2 = await fetchLedgerRow(user.id, idem)
    if (opts.type === 'image') {
      if (ledgerResultHasReplayableImage(ex2?.result_json)) {
        return { user, subscription, already: true, result: parseLedgerResultJson(ex2.result_json) }
      }
    }
    if (opts.type === 'video') {
      if (ledgerResultHasReplayableVideoTask(ex2?.result_json)) {
        const o = parseLedgerResultJson(ex2.result_json)
        return {
          user,
          subscription,
          already: true,
          result: { taskId: o.taskId, message: o.message || '视频生成中，预计需要3-5分钟' },
        }
      }
    }
    const o2 = parseLedgerResultJson(ex2?.result_json)
    if (o2?.creditsPrepaid === true && o2?.creditsRefunded !== true) {
      throw new Error(opts.type === 'video' ? '同一视频请求正在提交中，请稍候' : '同一出图请求正在处理中，请稍候再试')
    }
    throw new Error('计费记录冲突，请重试')
  }

  try {
    await deductUserCredits(user.id, creditsCost)
  } catch (e) {
    await deleteLedgerByUserIdem(user.id, idem)
    throw e
  }

  return { user, subscription, already: false }
}

/** 任务失败：回补已预付积分并删除幂等行（成功则保留行供幂等复用） */
export async function refundPrepaidCredits(req) {
  const { user } = await requireUser(req)
  const idem = getIdem(req)
  if (!idem) return
  const row = await fetchLedgerRow(user.id, idem)
  if (!row) return
  const prev = parseLedgerResultJson(row?.result_json) || {}
  if (prev.creditsPrepaid === true && prev.creditsRefunded !== true) {
    const cost = Math.floor(Number(prev.creditsCost))
    if (Number.isFinite(cost) && cost > 0) await grantUserCredits(user.id, cost)
  }
  await deleteLedgerByUserIdem(user.id, idem)
}

export async function releaseBillingHold(req) {
  await refundPrepaidCredits(req)
}

export async function finalizeCreditsBilling(req, resultJson, relatedTaskId) {
  const { user } = await requireUser(req)
  const idem = getIdem(req)
  if (!idem) throw new Error('缺少 Idempotency-Key')

  const row = await fetchLedgerRow(user.id, idem)
  const prev = parseLedgerResultJson(row?.result_json) || {}
  const cost = Math.floor(Number(prev.creditsCost))
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('计费状态异常')

  if (prev.creditsPrepaid === true) {
    const merged = {
      ...prev,
      ...resultJson,
      creditsPrepaid: true,
      creditsCost: cost,
      creditsCharged: cost,
      creditsRefunded: false,
    }
    const patchResp = await fetch(
      `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(user.id)}&request_idempotency_key=eq.${encodeURIComponent(idem)}`,
      {
        method: 'PATCH',
        headers: serviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ result_json: merged, related_task_id: relatedTaskId || null }),
      },
    )
    if (!patchResp.ok) {
      const pj = await fetchJsonOrText(patchResp)
      throw new Error(pj?.message || '计费确认失败')
    }
    return
  }

  if (!prev.billingHold) throw new Error('计费状态异常')
  await deductUserCredits(user.id, cost)
  const merged = { ...resultJson, creditsCharged: cost, billingHold: false }
  const patchResp = await fetch(
    `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(user.id)}&request_idempotency_key=eq.${encodeURIComponent(idem)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ result_json: merged, related_task_id: relatedTaskId || null }),
    },
  )
  if (!patchResp.ok) {
    const pj = await fetchJsonOrText(patchResp)
    throw new Error(pj?.message || '计费确认失败')
  }
}

export async function finalizeVideoSubmitHold(req, taskId, message) {
  const { user } = await requireUser(req)
  const idem = getIdem(req)
  if (!idem) return
  const row = await fetchLedgerRow(user.id, idem)
  const prev = parseLedgerResultJson(row?.result_json) || {}
  if (prev.creditsPrepaid !== true) return
  const cost = Math.floor(Number(prev.creditsCost)) || CREDITS_PER_VIDEO
  const merged = {
    ...prev,
    creditsPrepaid: true,
    creditsCost: cost,
    creditsRefunded: false,
    taskId,
    message: message || '视频生成中，预计需要3-5分钟',
  }
  await fetch(
    `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(user.id)}&request_idempotency_key=eq.${encodeURIComponent(idem)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ result_json: merged, related_task_id: taskId || null }),
    },
  )
}

/** 成片成功：积分已在提交时扣除，仅标记完成（幂等） */
export async function chargeVideoOnSuccess(req, taskId, videoUrl) {
  const { user } = await requireUser(req)
  const tid = String(taskId || '').trim()
  if (!tid) return { charged: false, reason: 'no_task_id' }
  const url = String(videoUrl || '').trim()
  if (!url) return { charged: false, reason: 'no_url' }

  const tResp = await fetch(
    `${baseUrl()}/rest/v1/generation_tasks?provider_task_id=eq.${encodeURIComponent(tid)}&user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`,
    { method: 'GET', headers: serviceHeaders() },
  )
  const tj = await fetchJsonOrText(tResp)
  const trow = Array.isArray(tj) ? tj[0] : tj
  if (!trow?.id) return { charged: false, reason: 'forbidden' }

  const legResp = await fetch(
    `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(user.id)}&related_task_id=eq.${encodeURIComponent(tid)}&type=eq.video&select=*`,
    { method: 'GET', headers: serviceHeaders() },
  )
  const legJson = await fetchJsonOrText(legResp)
  const rows = Array.isArray(legJson) ? legJson : []
  const legRow = rows.find((r) => {
    const p = parseLedgerResultJson(r?.result_json) || {}
    return p.creditsPrepaid === true && p.videoRefundMarker !== true
  })
  if (!legRow?.id) return { charged: false, reason: 'no_prepaid_row' }

  const prev = parseLedgerResultJson(legRow.result_json) || {}
  if (prev.creditsPrepaid !== true) return { charged: false, reason: 'no_prepaid_row' }
  if (prev.creditsRefunded === true) return { charged: false, reason: 'refunded' }
  if (prev.videoSuccessMarked === true) return { charged: false, reason: 'already' }

  const merged = {
    ...prev,
    taskId: tid,
    videoUrl: url,
    videoSuccessMarked: true,
    creditsCharged: Math.floor(Number(prev.creditsCost)) || CREDITS_PER_VIDEO,
  }
  const patchResp = await fetch(`${baseUrl()}/rest/v1/usage_ledger?id=eq.${encodeURIComponent(legRow.id)}`, {
    method: 'PATCH',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ result_json: merged }),
  })
  if (!patchResp.ok) {
    const pj = await fetchJsonOrText(patchResp)
    throw new Error(pj?.message || '视频计费标记失败')
  }
  return { charged: true, prepaid: true }
}

/** 轮询发现视频失败：回补该任务提交时扣除的积分（幂等） */
export async function refundVideoCreditsOnFailure(userId, taskId) {
  const uid = String(userId || '').trim()
  const tid = String(taskId || '').trim()
  if (!uid || !tid) return

  const markerIdem = `video-refund-${tid}`
  const markerIns = await fetch(`${baseUrl()}/rest/v1/usage_ledger`, {
    method: 'POST',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    }),
    body: JSON.stringify([
      {
        user_id: uid,
        type: 'video',
        units: 0,
        request_idempotency_key: markerIdem,
        related_task_id: tid,
        result_json: { videoRefundMarker: true, taskId: tid },
      },
    ]),
  })
  if (!markerIns.ok && markerIns.status !== 409) return
  if (markerIns.status === 409) return

  const legResp = await fetch(
    `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(uid)}&related_task_id=eq.${encodeURIComponent(tid)}&type=eq.video&select=*`,
    { method: 'GET', headers: serviceHeaders() },
  )
  const legJson = await fetchJsonOrText(legResp)
  const rows = Array.isArray(legJson) ? legJson : []
  const src = rows.find((r) => {
    const p = parseLedgerResultJson(r?.result_json) || {}
    return p.creditsPrepaid === true && p.videoRefundMarker !== true
  })
  if (!src?.id) return

  const prev = parseLedgerResultJson(src.result_json) || {}
  if (prev.creditsRefunded === true || prev.videoSuccessMarked === true) return
  const cost = Math.floor(Number(prev.creditsCost)) || CREDITS_PER_VIDEO
  if (cost > 0) await grantUserCredits(uid, cost)

  const merged = { ...prev, creditsRefunded: true, refundReason: 'video_failed' }
  await fetch(`${baseUrl()}/rest/v1/usage_ledger?id=eq.${encodeURIComponent(src.id)}`, {
    method: 'PATCH',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ result_json: merged }),
  })
}

export async function finalizeConsumption(req, resultJson, relatedTaskId) {
  const { user } = await requireUser(req)
  const idem = getIdem(req)
  if (!idem) return

  await fetch(
    `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(user.id)}&request_idempotency_key=eq.${encodeURIComponent(idem)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ result_json: resultJson || null, related_task_id: relatedTaskId || null }),
    },
  )
}
