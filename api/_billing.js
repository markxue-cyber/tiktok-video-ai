const PLAN_LIMITS = {
  trial: { imagePerDay: 3, videoPerDay: 3, llmPerDay: 30 },
  basic: { imagePerDay: 20, videoPerDay: 20, llmPerDay: 200 },
  pro: { imagePerDay: 1000000, videoPerDay: 1000000, llmPerDay: 1000000 },
  enterprise: { imagePerDay: 1000000, videoPerDay: 1000000, llmPerDay: 1000000 },
}

/** 与前端 src/lib/billingCredits.ts 一致 */
export const CREDITS_PER_IMAGE = 4
export const CREDITS_PER_VIDEO = 8

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

async function insertBillingHold(userId, type, idem, creditsCost, relatedTaskId) {
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
        result_json: { billingHold: true, creditsCost: Math.floor(Number(creditsCost)) },
      },
    ]),
  })
  if (insertResp.ok) return { ok: true }
  if (insertResp.status === 409) return { conflict: true }
  const insertJson = await fetchJsonOrText(insertResp)
  throw new Error(insertJson?.message || '计费占位写入失败')
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
    if (o?.billingHold === true) throw new Error('同一出图请求正在处理中，请稍候再试')
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
    if (o?.billingHold === true) throw new Error('同一视频请求正在提交中，请稍候')
  }

  const credits = await fetchUserCredits(user.id)
  if (credits < creditsCost) throw new Error('积分不足，请充值或升级套餐')

  const ins = await insertBillingHold(user.id, opts.type, idem, creditsCost, opts.relatedTaskId)
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
    if (o2?.billingHold === true) {
      throw new Error(opts.type === 'video' ? '同一视频请求正在提交中，请稍候' : '同一出图请求正在处理中，请稍候再试')
    }
    throw new Error('计费占位冲突，请重试')
  }

  return { user, subscription, already: false }
}

export async function releaseBillingHold(req) {
  const { user } = await requireUser(req)
  const idem = getIdem(req)
  if (!idem) return
  await fetch(
    `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(user.id)}&request_idempotency_key=eq.${encodeURIComponent(idem)}`,
    { method: 'DELETE', headers: serviceHeaders() },
  )
}

export async function finalizeCreditsBilling(req, resultJson, relatedTaskId) {
  const { user } = await requireUser(req)
  const idem = getIdem(req)
  if (!idem) throw new Error('缺少 Idempotency-Key')

  const row = await fetchLedgerRow(user.id, idem)
  const prev = parseLedgerResultJson(row?.result_json) || {}
  if (!prev.billingHold) throw new Error('计费状态异常')
  const cost = Math.floor(Number(prev.creditsCost))
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('计费状态异常')

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
  if (!prev.billingHold) return
  const cost = Math.floor(Number(prev.creditsCost)) || CREDITS_PER_VIDEO
  const merged = {
    ...prev,
    billingHold: true,
    creditsCost: cost,
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

  const chargeIdem = `video-done-${tid}`
  const existing = await fetchLedgerRow(user.id, chargeIdem)
  if (existing?.id) return { charged: false, reason: 'already' }

  const cost = CREDITS_PER_VIDEO
  const insertResp = await fetch(`${baseUrl()}/rest/v1/usage_ledger`, {
    method: 'POST',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify([
      {
        user_id: user.id,
        type: 'video',
        units: 0,
        request_idempotency_key: chargeIdem,
        related_task_id: tid,
        result_json: { taskId: tid, videoUrl: url, creditsCharged: cost },
      },
    ]),
  })
  const insertJson = await fetchJsonOrText(insertResp)
  if (!insertResp.ok) {
    if (insertResp.status === 409) return { charged: false, reason: 'already' }
    throw new Error(insertJson?.message || '视频计费记录写入失败')
  }

  await deductUserCredits(user.id, cost)
  return { charged: true }
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
