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
  return { userId }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const { userId } = await requireUser(req)
    const source = String(req.query?.source || '').trim()
    const type = String(req.query?.type || '').trim()
    const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query?.limit || '100'), 10) || 100))
    const offset = Math.max(0, Number.parseInt(String(req.query?.offset || '0'), 10) || 0)

    const params = new URLSearchParams()
    params.set('user_id', `eq.${userId}`)
    if (source && ['user_upload', 'ai_generated'].includes(source)) params.set('source', `eq.${source}`)
    if (type && ['image', 'video'].includes(type)) params.set('type', `eq.${type}`)
    params.set('select', '*')
    params.set('order', 'created_at.desc')
    params.set('limit', String(limit))
    params.set('offset', String(offset))

    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    const resp = await fetch(`${baseUrl()}/rest/v1/assets?${params.toString()}`, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    })
    const data = await parseJson(resp)
    if (!resp.ok) {
      return sendJson(res, 200, { success: false, error: data?.message || '获取资产失败', raw: data })
    }
    const assets = Array.isArray(data) ? data : []
    return sendJson(res, 200, { success: true, assets, nextOffset: offset + assets.length, hasMore: assets.length >= limit })
  } catch (e: any) {
    return sendJson(res, 200, { success: false, error: e?.message || '获取资产失败' })
  }
}

