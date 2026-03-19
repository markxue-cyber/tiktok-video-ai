function sendJson(res: any, status: number, payload: any) {
  return res.status(status).json(payload)
}

function mustEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function baseUrl() {
  const url = mustEnv('SUPABASE_URL')
  return String(url).replace(/\/$/, '')
}

async function parseJson(resp: Response) {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { _raw: text }
  }
}

async function requireUser(req: any) {
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
  const data = await parseJson(resp)
  if (!resp.ok) throw new Error(data?.error_description || data?.message || '登录已失效，请重新登录')
  const user = data?.user || data
  const userId = user?.id || user?.sub
  if (!userId) throw new Error('登录已失效，请重新登录')
  return { userId, email: String(user?.email || '').toLowerCase() }
}

function hourKey(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  d.setMinutes(0, 0, 0)
  return d.toISOString()
}

function extractError(raw: any): string {
  if (!raw) return 'unknown_error'
  const s =
    raw?.upstream?.error?.message ||
    raw?.upstream?.message ||
    raw?.error?.message ||
    raw?.message ||
    raw?._raw ||
    ''
  const text = String(s || '').trim()
  if (!text) return 'unknown_error'
  return text.slice(0, 120)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const { userId, email } = await requireUser(req)
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    const allowEmails = String(process.env.MONITOR_ADMIN_EMAILS || 'haoxue2027@gmail.com')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
    const wantSystem = String(req.query?.scope || 'system').toLowerCase() === 'system'
    const isAdmin = allowEmails.includes(email)
    const useSystemScope = wantSystem && isAdmin
    const now = new Date()
    const from24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
    const from7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()

    const q = new URLSearchParams()
    if (!useSystemScope) q.set('user_id', `eq.${userId}`)
    q.set('created_at', `gte.${from7d}`)
    q.set('select', 'id,type,status,created_at,model,raw')
    q.set('order', 'created_at.desc')
    q.set('limit', useSystemScope ? '2000' : '800')

    const resp = await fetch(`${baseUrl()}/rest/v1/generation_tasks?${q.toString()}`, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '获取统计失败', raw: data })
    const rows: any[] = Array.isArray(data) ? data : []

    const total24h = rows.filter((r) => String(r.created_at || '') >= from24h)
    const byType = { image: 0, video: 0 }
    const byStatus: Record<string, number> = { submitted: 0, processing: 0, succeeded: 0, failed: 0, other: 0 }
    const errorTopMap = new Map<string, number>()
    const hourlyFailMap = new Map<string, number>()

    for (const r of total24h) {
      const t = String(r.type || '')
      if (t === 'image' || t === 'video') byType[t] += 1
      const st = String(r.status || '').toLowerCase()
      if (['submitted', 'processing', 'succeeded', 'failed'].includes(st)) byStatus[st] += 1
      else byStatus.other += 1

      if (st === 'failed') {
        const k = extractError(r.raw)
        errorTopMap.set(k, (errorTopMap.get(k) || 0) + 1)
        const hk = hourKey(String(r.created_at || ''))
        if (hk) hourlyFailMap.set(hk, (hourlyFailMap.get(hk) || 0) + 1)
      }
    }

    const errorTop = Array.from(errorTopMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([message, count]) => ({ message, count }))

    const hourlyFailed = Array.from(hourlyFailMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([hour, count]) => ({ hour, count }))

    // Payment distribution (24h)
    const oq = new URLSearchParams()
    if (!useSystemScope) oq.set('user_id', `eq.${userId}`)
    oq.set('created_at', `gte.${from24h}`)
    oq.set('select', 'status,created_at')
    oq.set('order', 'created_at.desc')
    oq.set('limit', useSystemScope ? '2000' : '800')
    const oResp = await fetch(`${baseUrl()}/rest/v1/orders?${oq.toString()}`, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    })
    const oData = await parseJson(oResp)
    const orders: any[] = Array.isArray(oData) ? oData : []
    const orderByStatus: Record<string, number> = { created: 0, paid: 0, failed: 0, refunded: 0, other: 0 }
    for (const o of orders) {
      const st = String(o?.status || '').toLowerCase()
      if (st in orderByStatus) orderByStatus[st] += 1
      else orderByStatus.other += 1
    }

    return sendJson(res, 200, {
      success: true,
      scope: useSystemScope ? 'system' : 'self',
      window: '24h',
      total: total24h.length,
      byType,
      byStatus,
      failedRate: total24h.length ? Number((byStatus.failed / total24h.length).toFixed(4)) : 0,
      errorTop,
      hourlyFailed,
      orders24h: {
        total: orders.length,
        byStatus: orderByStatus,
      },
    })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}

