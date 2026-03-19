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
  return { user: data?.user || data }
}

function textFromRaw(raw: any): string {
  const s =
    raw?.upstream?.error?.message ||
    raw?.upstream?.message ||
    raw?.error?.message ||
    raw?.message ||
    raw?._raw ||
    ''
  return String(s || '').toLowerCase()
}

function looksLikeModelUnavailable(msg: string): boolean {
  const t = String(msg || '').toLowerCase()
  return (
    (t.includes('model') && t.includes('does not exist')) ||
    (t.includes('model') && t.includes('not in')) ||
    (t.includes('invalid field') && t.includes('model')) ||
    (t.includes('无效') && t.includes('模型'))
  )
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    await requireUser(req)

    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    const fromIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    const q = new URLSearchParams()
    q.set('status', 'eq.failed')
    q.set('created_at', `gte.${fromIso}`)
    q.set('select', 'type,model,raw,created_at')
    q.set('order', 'created_at.desc')
    q.set('limit', '3000')

    const resp = await fetch(`${baseUrl()}/rest/v1/generation_tasks?${q.toString()}`, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '获取模型可用性失败', raw: data })

    const rows: any[] = Array.isArray(data) ? data : []
    const imageMap = new Map<string, number>()
    const videoMap = new Map<string, number>()
    const reasonMap = new Map<string, string>()

    for (const r of rows) {
      const model = String(r?.model || '').trim()
      if (!model) continue
      const msg = textFromRaw(r?.raw)
      if (!looksLikeModelUnavailable(msg)) continue
      reasonMap.set(model, '近期多次返回模型不可用')
      if (String(r?.type || '') === 'image') imageMap.set(model, (imageMap.get(model) || 0) + 1)
      if (String(r?.type || '') === 'video') videoMap.set(model, (videoMap.get(model) || 0) + 1)
    }

    const envImageBlock = String(process.env.MODEL_BLOCKLIST_IMAGE || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const envVideoBlock = String(process.env.MODEL_BLOCKLIST_VIDEO || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

    for (const m of envImageBlock) {
      imageMap.set(m, Math.max(1, imageMap.get(m) || 0))
      reasonMap.set(m, '管理员手动屏蔽')
    }
    for (const m of envVideoBlock) {
      videoMap.set(m, Math.max(1, videoMap.get(m) || 0))
      reasonMap.set(m, '管理员手动屏蔽')
    }

    const toList = (map: Map<string, number>) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ id, count, reason: reasonMap.get(id) || '暂不可用' }))

    return sendJson(res, 200, {
      success: true,
      image: toList(imageMap),
      video: toList(videoMap),
      updatedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}

