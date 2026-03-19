function sendJson(res: any, status: number, payload: any) {
  try {
    if (typeof res?.status === 'function' && typeof res?.json === 'function') return res.status(status).json(payload)
    if (typeof res?.send === 'function') return res.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
    const { refreshToken } = req.body || {}
    const rt = String(refreshToken || '').trim()
    if (!rt) return sendJson(res, 400, { success: false, error: '缺少 refreshToken' })

    const supabaseUrl = process.env.SUPABASE_URL
    const anonKey = process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_ANON_KEY）')

    const base = String(supabaseUrl).replace(/\/$/, '')
    const tokenResp = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: rt }),
    })
    const tokenText = await tokenResp.text()
    let tokenJson: any = null
    try {
      tokenJson = tokenText ? JSON.parse(tokenText) : null
    } catch {
      tokenJson = null
    }

    if (!tokenResp.ok) {
      const msg = tokenJson?.error_description || tokenJson?.msg || tokenJson?.message || tokenText || `refresh failed(${tokenResp.status})`
      return sendJson(res, 200, { success: false, error: msg })
    }

    return sendJson(res, 200, {
      success: true,
      session: {
        access_token: tokenJson?.access_token,
        refresh_token: tokenJson?.refresh_token || rt,
        expires_at: tokenJson?.expires_at,
        token_type: tokenJson?.token_type || 'bearer',
      },
    })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}

