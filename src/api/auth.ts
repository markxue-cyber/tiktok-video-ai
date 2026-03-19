export type AuthSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  token_type?: string
}

async function readJsonOrText(resp: Response): Promise<any> {
  // Some Vercel/serverless errors may return plain text/HTML.
  // Reading text first lets us surface the real response message.
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, error: text }
  }
}

export async function apiRegister(params: { email: string; password: string; displayName?: string }) {
  const resp = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `注册失败(${resp.status})`)
  return data
}

export async function apiLogin(params: { email: string; password: string }) {
  const resp = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `登录失败(${resp.status})`)
  return data
}

export async function apiRefresh(refreshToken: string) {
  const resp = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `刷新会话失败(${resp.status})`)
  return data
}

export async function apiMe(accessToken: string) {
  const resp = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取用户信息失败(${resp.status})`)
  return data
}

export async function apiResendSignup(params: { email: string; type?: 'signup' | string }) {
  const resp = await fetch('/api/auth/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: params.email, type: params.type || 'signup' }),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `重发失败(${resp.status})`)
  return data
}

export async function apiRecoverPassword(params: { email: string }) {
  const resp = await fetch('/api/auth/recover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: params.email }),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `发送重置邮件失败(${resp.status})`)
  return data
}

