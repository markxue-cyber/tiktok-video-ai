function sendJson(res: any, status: number, payload: any) {
  try {
    if (typeof res?.status === 'function' && typeof res?.json === 'function') return res.status(status).json(payload)
    if (typeof res?.send === 'function') return res.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
  } catch {
    // ignore
  }
}

function getOriginFromHeaders(req: any): string {
  const origin = String(req?.headers?.origin || req?.headers?.referer || '').trim()
  if (origin.startsWith('http://') || origin.startsWith('https://')) return origin.split('#')[0].split('?')[0]
  return origin
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
    const { email } = req.body || {}
    const mail = String(email || '').trim()
    if (!mail) return sendJson(res, 400, { success: false, error: '缺少 email' })

    const supabaseUrl = process.env.SUPABASE_URL
    const anonKey = process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_ANON_KEY）')

    const base = String(supabaseUrl).replace(/\/$/, '')

    // Supabase recovery link will redirect back to this page, where we parse #access_token/#refresh_token.
    const redirectTo =
      process.env.SITE_URL ||
      process.env.PUBLIC_SITE_URL ||
      getOriginFromHeaders(req) ||
      'https://tiktok-video-ai.vercel.app'

    const tokenResp = await fetch(`${base}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: mail }),
    })

    const text = await tokenResp.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { success: false, error: text }
    }

    if (!tokenResp.ok) {
      const msg =
        data?.error_description || data?.error || data?.message || data?.msg || (typeof text === 'string' ? text : 'recover failed')
      const isRateLimit = /rate[\s-]*limit/i.test(String(msg))
      if (isRateLimit) return sendJson(res, 429, { success: false, error: '发送太频繁，请稍后再试' })
      return sendJson(res, 200, { success: false, error: msg })
    }

    return sendJson(res, 200, { success: true })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}

