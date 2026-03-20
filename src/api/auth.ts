export type AuthSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  token_type?: string
}

function timeoutMessage(apiName: string) {
  return `${apiName}请求超时，请检查网络或稍后重试`
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('REQUEST_TIMEOUT')
    throw e
  } finally {
    clearTimeout(timer)
  }
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
  let resp: Response
  try {
    resp = await fetchWithTimeout(
      '/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      },
      15000,
    )
  } catch (e: any) {
    if (String(e?.message || '') === 'REQUEST_TIMEOUT') throw new Error(timeoutMessage('注册'))
    throw e
  }
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `注册失败(${resp.status})`)
  return data
}

export async function apiLogin(params: { email: string; password: string }) {
  let resp: Response
  try {
    resp = await fetchWithTimeout(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      },
      15000,
    )
  } catch (e: any) {
    if (String(e?.message || '') === 'REQUEST_TIMEOUT') throw new Error(timeoutMessage('登录'))
    throw e
  }
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `登录失败(${resp.status})`)
  return data
}

export async function apiRefresh(refreshToken: string) {
  let resp: Response
  try {
    resp = await fetchWithTimeout(
      '/api/auth/refresh',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      },
      15000,
    )
  } catch (e: any) {
    if (String(e?.message || '') === 'REQUEST_TIMEOUT') throw new Error(timeoutMessage('会话刷新'))
    throw e
  }
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `刷新会话失败(${resp.status})`)
  return data
}

export async function apiMe(accessToken: string) {
  let resp: Response
  try {
    resp = await fetchWithTimeout(
      '/api/me',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      15000,
    )
  } catch (e: any) {
    if (String(e?.message || '') === 'REQUEST_TIMEOUT') throw new Error(timeoutMessage('用户信息读取'))
    throw e
  }
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取用户信息失败(${resp.status})`)
  return data
}

export async function apiResendSignup(params: { email: string; type?: 'signup' | string }) {
  let resp: Response
  try {
    resp = await fetchWithTimeout(
      '/api/auth/resend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: params.email, type: params.type || 'signup' }),
      },
      15000,
    )
  } catch (e: any) {
    if (String(e?.message || '') === 'REQUEST_TIMEOUT') throw new Error(timeoutMessage('重发验证邮件'))
    throw e
  }
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `重发失败(${resp.status})`)
  return data
}

export async function apiRecoverPassword(params: { email: string }) {
  let resp: Response
  try {
    resp = await fetchWithTimeout(
      '/api/auth/recover',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: params.email }),
      },
      15000,
    )
  } catch (e: any) {
    if (String(e?.message || '') === 'REQUEST_TIMEOUT') throw new Error(timeoutMessage('密码找回'))
    throw e
  }
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `发送重置邮件失败(${resp.status})`)
  return data
}

export async function apiUpdatePassword(params: { accessToken: string; password: string }) {
  let resp: Response
  try {
    resp = await fetchWithTimeout(
      '/api/auth/update-password',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: params.accessToken, password: params.password }),
      },
      15000,
    )
  } catch (e: any) {
    if (String(e?.message || '') === 'REQUEST_TIMEOUT') throw new Error(timeoutMessage('更新密码'))
    throw e
  }
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `设置新密码失败(${resp.status})`)
  return data
}

