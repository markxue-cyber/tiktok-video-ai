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
  if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const { userId } = await requireUser(req)
    const { source, type, url, name, metadata } = req.body || {}
    const src = String(source || '').trim()
    const kind = String(type || '').trim()
    const assetUrl = String(url || '').trim()
    if (!src || !['user_upload', 'ai_generated'].includes(src)) {
      return sendJson(res, 400, { success: false, error: 'source 仅支持 user_upload / ai_generated' })
    }
    if (!kind || !['image', 'video'].includes(kind)) {
      return sendJson(res, 400, { success: false, error: 'type 仅支持 image / video' })
    }
    if (!assetUrl) return sendJson(res, 400, { success: false, error: '缺少 url' })

    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    const resp = await fetch(`${baseUrl()}/rest/v1/assets`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([
        {
          user_id: userId,
          source: src,
          type: kind,
          url: assetUrl,
          name: name ? String(name) : null,
          metadata: metadata || null,
        },
      ]),
    })
    const data = await parseJson(resp)
    if (!resp.ok) {
      return sendJson(res, 200, { success: false, error: data?.message || '资产入库失败', raw: data })
    }
    const row = Array.isArray(data) ? data[0] : data
    return sendJson(res, 200, { success: true, asset: row })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}

