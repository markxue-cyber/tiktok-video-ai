// NOTE: avoid relying on @supabase/supabase-js at runtime.
// We call Supabase Auth REST + PostgREST directly via fetch.

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
    const { email, password } = req.body || {}
    if (!email || !password) return sendJson(res, 400, { success: false, error: '缺少 email/password' })

    const supabaseUrl = process.env.SUPABASE_URL
    const anonKey = process.env.SUPABASE_ANON_KEY
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !anonKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_ANON_KEY）')
    if (!serviceKey) throw new Error('Supabase 未配置（缺少 SUPABASE_SERVICE_ROLE_KEY）')

    const base = String(supabaseUrl).replace(/\/$/, '')

    // 1) Password grant token
    const tokenResp = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: String(email), password: String(password) }),
    })

    const tokenText = await tokenResp.text()
    let tokenJson: any = null
    try {
      tokenJson = tokenText ? JSON.parse(tokenText) : null
    } catch {
      tokenJson = null
    }

    if (!tokenResp.ok) {
      const msg = tokenJson?.error_description || tokenJson?.msg || tokenJson?.message || tokenText || `token failed(${tokenResp.status})`
      return sendJson(res, 200, { success: false, error: msg })
    }

    const accessToken = tokenJson?.access_token
    const refreshToken = tokenJson?.refresh_token

    // 2) Fetch user profile from auth endpoint
    const userResp = await fetch(`${base}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    })
    const userText = await userResp.text()
    let userJson: any = null
    try {
      userJson = userText ? JSON.parse(userText) : null
    } catch {
      userJson = null
    }
    if (!userResp.ok) {
      const msg = userJson?.error_description || userJson?.message || userText || `user failed(${userResp.status})`
      return sendJson(res, 200, { success: false, error: msg })
    }

    const user = userJson?.user || userJson

    // 3) Upsert profile row + ensure trial subscription
    const restHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'resolution=merge-duplicates,return=representation',
    }

    const display = user.email || String(email)
    await fetch(`${base}/rest/v1/users`, {
      method: 'POST',
      headers: restHeaders,
      body: JSON.stringify([{ id: user.id, email: user.email || String(email), display_name: display }]),
    })

    // check existing subscription
    const subResp = await fetch(`${base}/rest/v1/subscriptions?user_id=eq.${user.id}&select=*`, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    })
    const subText = await subResp.text()
    let subJson: any = null
    try {
      subJson = subText ? JSON.parse(subText) : null
    } catch {
      subJson = null
    }

    const existing = Array.isArray(subJson) ? subJson[0] : null
    if (!existing) {
      const now = new Date()
      const end = new Date(now.getTime() + 7 * 24 * 3600 * 1000)
      await fetch(`${base}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: restHeaders,
        body: JSON.stringify([
          {
            user_id: user.id,
            plan_id: 'trial',
            status: 'active',
            current_period_start: now.toISOString(),
            current_period_end: end.toISOString(),
            auto_renew: false,
          },
        ]),
      })
    }

    return sendJson(res, 200, {
      success: true,
      session: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: tokenJson?.expires_at,
        token_type: tokenJson?.token_type || 'bearer',
      },
      user,
    })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}

