// NOTE: avoid relying on @supabase/supabase-js at runtime.
// We call Supabase Auth REST + PostgREST directly via fetch.

function sendJson(res: any, status: number, payload: any) {
  try {
    if (typeof res?.status === 'function' && typeof res?.json === 'function') return res.status(status).json(payload)
    if (typeof res?.send === 'function') return res.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
  } catch {
    // ignore; last resort is Vercel's default error surface
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
    const { email, password, displayName } = req.body || {}
    if (!email || !password) return sendJson(res, 400, { success: false, error: '缺少 email/password' })

    const supabaseUrl = process.env.SUPABASE_URL
    const anonKey = process.env.SUPABASE_ANON_KEY
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !anonKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_ANON_KEY）')
    if (!serviceKey) throw new Error('Supabase 未配置（缺少 SUPABASE_SERVICE_ROLE_KEY）')

    const base = String(supabaseUrl).replace(/\/$/, '')

    // 1) Auth sign up
    const signupResp = await fetch(`${base}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: String(email),
        password: String(password),
        // keep metadata minimal; profile is stored in our own `public.users`
        data: displayName ? { display_name: String(displayName) } : undefined,
      }),
    })

    const signupText = await signupResp.text()
    let signupJson: any = null
    try {
      signupJson = signupText ? JSON.parse(signupText) : null
    } catch {
      signupJson = null
    }

    if (!signupResp.ok) {
      const msg = signupJson?.error_description || signupJson?.msg || signupJson?.message || signupText || `signup failed(${signupResp.status})`
      // Supabase error message may include non-breaking spaces or hyphen.
      // Make matching robust for: "rate limit", "rate-limit", "rate&nbsp;limit".
      const isRateLimit = /rate[\s-]*limit/i.test(String(msg))
      if (isRateLimit) {
        return sendJson(res, 429, { success: false, error: '触发注册限流，请稍后 15 分钟再试' })
      }
      return sendJson(res, 200, { success: false, error: msg })
    }

    const user = signupJson?.user || signupJson?.data?.user || signupJson?.user
    const session = signupJson?.session || null

    // 2) Upsert profile + trial subscription
    if (user?.id) {
      const now = new Date()
      const end = new Date(now.getTime() + 7 * 24 * 3600 * 1000)

      const restHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'resolution=merge-duplicates,return=representation',
      }

      // users
      await fetch(`${base}/rest/v1/users`, {
        method: 'POST',
        headers: restHeaders,
        body: JSON.stringify([
          {
            id: user.id,
            email: user.email || String(email),
            display_name: displayName || user.email || String(email),
            credits: 9,
          },
        ]),
      })

      // subscriptions
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
      session,
      user,
      needsEmailConfirm: !session,
    })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}

