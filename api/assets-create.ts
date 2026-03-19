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

function extFromMime(mime: string, fallback: string) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('mp4')) return 'mp4'
  if (m.includes('webm')) return 'webm'
  return fallback
}

async function ensureAssetsBucket(serviceKey: string) {
  // Best-effort: if bucket already exists, ignore
  await fetch(`${baseUrl()}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: 'assets',
      name: 'assets',
      public: true,
      file_size_limit: null,
    }),
  })
}

async function uploadDataUrlToStorage(params: { userId: string; kind: 'image' | 'video'; dataUrl: string; name?: string; serviceKey: string }) {
  const m = String(params.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!m) throw new Error('非法 data URL')
  const mime = m[1]
  const b64 = m[2]
  const bytes = Buffer.from(b64, 'base64')
  const fallbackExt = params.kind === 'video' ? 'mp4' : 'png'
  const ext = extFromMime(mime, fallbackExt)
  const safeName = String(params.name || `${params.kind}.${ext}`).replace(/[^\w.\-]/g, '_')
  const objectPath = `${params.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`

  await ensureAssetsBucket(params.serviceKey)

  const upResp = await fetch(`${baseUrl()}/storage/v1/object/assets/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: params.serviceKey,
      Authorization: `Bearer ${params.serviceKey}`,
      'Content-Type': mime || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: bytes as any,
  })
  if (!upResp.ok) {
    const upData = await parseJson(upResp)
    throw new Error(upData?.message || '上传到Storage失败')
  }

  return `${baseUrl()}/storage/v1/object/public/assets/${objectPath}`
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
    const finalUrl =
      assetUrl.startsWith('data:')
        ? await uploadDataUrlToStorage({
            userId,
            kind: kind as 'image' | 'video',
            dataUrl: assetUrl,
            name: name ? String(name) : undefined,
            serviceKey,
          })
        : assetUrl

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
          url: finalUrl,
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

