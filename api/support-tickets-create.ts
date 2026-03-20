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
  return { userId, email: String(user?.email || '') }
}

function makeTicketNo() {
  const d = new Date()
  const y = d.getFullYear().toString().slice(-2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `TK${y}${m}${day}${rand}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { userId, email: loginEmail } = await requireUser(req)
    const kindRaw = String(req.body?.kind || 'other').trim()
    const kind = kindRaw === 'bug' || kindRaw === 'suggestion' || kindRaw === 'other' ? kindRaw : 'other'
    const content = String(req.body?.content || '').trim()
    const subject = String(req.body?.subject || '').trim() || `用户反馈(${kind})`
    const email = String(req.body?.email || '').trim() || loginEmail
    const page = String(req.body?.page || '').trim()
    if (!content) return res.status(400).json({ success: false, error: '请填写问题描述' })
    if (content.length > 5000) return res.status(400).json({ success: false, error: '问题描述过长（最多 5000 字）' })

    const ticketNo = makeTicketNo()
    const attachments = page ? [{ type: 'page', value: page }] : []
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    const resp = await fetch(`${baseUrl()}/rest/v1/support_tickets?select=id,ticket_no,status,kind,subject,content,email,created_at,updated_at`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([
        {
          ticket_no: ticketNo,
          user_id: userId,
          email: email || null,
          kind,
          subject,
          content,
          attachments,
          status: 'open',
          priority: 'normal',
        },
      ]),
    })
    const data = await parseJson(resp)
    if (!resp.ok || !Array.isArray(data) || !data[0]) return res.status(500).json({ success: false, error: data?.message || '创建工单失败' })
    return res.status(200).json({ success: true, ticket: data[0] })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
