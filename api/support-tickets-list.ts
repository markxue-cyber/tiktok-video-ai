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
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  const data = await parseJson(resp)
  if (!resp.ok) throw new Error(data?.error_description || data?.message || '登录已失效，请重新登录')
  const user = data?.user || data
  const userId = user?.id || user?.sub
  if (!userId) throw new Error('登录已失效，请重新登录')
  return { userId }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { userId } = await requireUser(req)
    const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query?.limit || '20'), 10) || 20))
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    const params = new URLSearchParams()
    params.set('user_id', `eq.${userId}`)
    params.set('select', 'id,ticket_no,status,kind,subject,content,email,created_at,updated_at,closed_at,priority,admin_note')
    params.set('order', 'created_at.desc')
    params.set('limit', String(limit))
    const resp = await fetch(`${baseUrl()}/rest/v1/support_tickets?${params.toString()}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    })
    const data = await parseJson(resp)
    if (!resp.ok) return res.status(500).json({ success: false, error: data?.message || '获取工单失败' })
    return res.status(200).json({ success: true, tickets: Array.isArray(data) ? data : [] })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
