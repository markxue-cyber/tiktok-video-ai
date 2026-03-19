function mustEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function baseUrl() {
  const url = mustEnv('SUPABASE_URL')
  return String(url).replace(/\/$/, '')
}

export function sendJson(res: any, status: number, payload: any) {
  return res.status(status).json(payload)
}

export async function parseJson(resp: Response) {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { _raw: text }
  }
}

function isAdminEmail(email: string): boolean {
  const normalized = String(email || '').trim().toLowerCase()
  const env = String(process.env.ADMIN_EMAILS || 'haoxue2027@gmail.com')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  return env.includes(normalized)
}

export async function requireAdmin(req: any) {
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
  const email = String(user?.email || '').toLowerCase()
  if (!userId || !email) throw new Error('登录已失效，请重新登录')
  if (!isAdminEmail(email)) throw new Error('无权限访问后台')
  return { userId, email }
}

export function serviceHeaders() {
  const key = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  }
}

export { baseUrl }
