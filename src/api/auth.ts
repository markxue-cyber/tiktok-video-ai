export type AuthSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  token_type?: string
}

export async function apiRegister(params: { email: string; password: string; displayName?: string }) {
  const resp = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await resp.json()
  if (!resp.ok || !data?.success) throw new Error(data?.error || '注册失败')
  return data
}

export async function apiLogin(params: { email: string; password: string }) {
  const resp = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await resp.json()
  if (!resp.ok || !data?.success) throw new Error(data?.error || '登录失败')
  return data
}

export async function apiMe(accessToken: string) {
  const resp = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await resp.json()
  if (!resp.ok || !data?.success) throw new Error(data?.error || '获取用户信息失败')
  return data
}

