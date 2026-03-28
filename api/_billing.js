const PLAN_LIMITS = {
  trial: { imagePerDay: 3, videoPerDay: 3, llmPerDay: 30 },
  basic: { imagePerDay: 20, videoPerDay: 20, llmPerDay: 200 },
  pro: { imagePerDay: 1000000, videoPerDay: 1000000, llmPerDay: 1000000 },
  enterprise: { imagePerDay: 1000000, videoPerDay: 1000000, llmPerDay: 1000000 },
}

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
  // e.g. "0-0/12" or "*/0"
  const m = String(cr || '').match(/\/(\d+)\s*$/)
  return m ? Number.parseInt(m[1], 10) : null
}

/** usage_ledger.result_json 解析为对象 */
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

/** 仅当存在可复用的图片地址时才视为幂等命中（避免 {} 等脏数据永久短路出图） */
function ledgerResultHasReplayableImage(rj) {
  const o = parseLedgerResultJson(rj)
  if (!o || typeof o !== 'object') return false
  const u = String(o.imageUrl || o.output_url || o.outputUrl || o.url || '').trim()
  return u.length > 0
}

async function requireUser(req) {
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

function serviceHeaders(extra = {}) {
  const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra,
  }
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

export async function checkAndConsume(req, opts) {
  const { user, subscription } = await requireActiveSubscription(req)

  const idem = String(req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'] || '').trim()
  if (!idem) throw new Error('缺少 Idempotency-Key（防止重复扣费）')

  // If already consumed for this key, return previous result.
  const existingResp = await fetch(
    `${baseUrl()}/rest/v1/usage_ledger?user_id=eq.${encodeURIComponent(user.id)}&request_idempotency_key=eq.${encodeURIComponent(idem)}&select=*`,
    { method: 'GET', headers: serviceHeaders() },
  )
  const existingJson = await fetchJsonOrText(existingResp)
  const existing = Array.isArray(existingJson) ? existingJson[0] : existingJson
  if (ledgerResultHasReplayableImage(existing?.result_json)) {
    return { user, subscription, already: true, result: parseLedgerResultJson(existing.result_json) }
  }

  const planId = String(subscription.plan_id || 'trial')
  const limits = PLAN_LIMITS[planId] || PLAN_LIMITS.trial
  const limit = opts.type === 'image' ? limits.imagePerDay : opts.type === 'video' ? limits.videoPerDay : limits.llmPerDay

  // Count today's usage
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

  // Reserve a ledger row (idempotency unique index will protect duplicates)
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
    // ignore duplicates
    if (insertResp.status !== 409) throw new Error(insertJson?.message || '计费记录写入失败')
  }

  return { user, subscription, already: false }
}

export async function finalizeConsumption(req, resultJson, relatedTaskId) {
  const { user } = await requireUser(req)
  const idem = String(req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'] || '').trim()
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

