// NOTE: avoid relying on @supabase/supabase-js at runtime.
// We call Supabase Auth REST + PostgREST directly via fetch.

const nowIso = () => new Date().toISOString()

function sendJson(res: any, status: number, payload: any) {
  try {
    if (typeof res?.status === 'function' && typeof res?.json === 'function') return res.status(status).json(payload)
    if (typeof res?.send === 'function') return res.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
  } catch {
    // ignore
  }
}

async function requireUser(req: any) {
  const auth = String(req.headers?.authorization || '')
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new Error('未登录（缺少 Authorization Bearer token）')

  const supabaseUrl = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_ANON_KEY）')

  const base = String(supabaseUrl).replace(/\/$/, '')
  const userResp = await fetch(`${base}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
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
    throw new Error(msg)
  }

  const user = userJson?.user || userJson
  if (!user?.id && !user?.sub) throw new Error('登录已失效，请重新登录')

  return { user }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })

    const { user } = await requireUser(req)

    const supabaseUrl = process.env.SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）')

    const base = String(supabaseUrl).replace(/\/$/, '')
    const restHeaders: Record<string, string> = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    }

    const userId = user.id || user.sub

    const profileResp = await fetch(`${base}/rest/v1/users?id=eq.${userId}&select=*`, {
      method: 'GET',
      headers: restHeaders,
    })
    const profileText = await profileResp.text()
    let profileJson: any = null
    try {
      profileJson = profileText ? JSON.parse(profileText) : null
    } catch {
      profileJson = null
    }
    const profile = Array.isArray(profileJson) ? profileJson[0] : profileJson
    if (profile?.is_frozen === true) {
      return sendJson(res, 200, { success: false, error: profile?.freeze_reason || '账号已被冻结，请联系管理员' })
    }

    const subResp = await fetch(`${base}/rest/v1/subscriptions?user_id=eq.${userId}&select=*`, {
      method: 'GET',
      headers: restHeaders,
    })
    const subText = await subResp.text()
    let subJson: any = null
    try {
      subJson = subText ? JSON.parse(subText) : null
    } catch {
      subJson = null
    }
    const sub = Array.isArray(subJson) ? subJson[0] : subJson

    const active =
      !!sub && sub.status === 'active' && typeof sub.current_period_end === 'string' && new Date(sub.current_period_end).getTime() > Date.now()

    const safeSub = sub
      ? {
          planId: sub.plan_id,
          status: sub.status,
          currentPeriodStart: sub.current_period_start,
          currentPeriodEnd: sub.current_period_end,
          autoRenew: !!sub.auto_renew,
          active,
        }
      : null

    const ordResp = await fetch(`${base}/rest/v1/orders?user_id=eq.${userId}&status=eq.paid&select=id&limit=1`, {
      method: 'GET',
      headers: restHeaders,
    })
    const ordText = await ordResp.text()
    let ordJson: any = null
    try {
      ordJson = ordText ? JSON.parse(ordText) : null
    } catch {
      ordJson = null
    }
    const hasPaidProduct = Array.isArray(ordJson) && ordJson.length > 0

    const creditsRaw = profile?.credits
    const creditsNum = Number(creditsRaw)
    const credits = Number.isFinite(creditsNum) ? Math.max(0, Math.floor(creditsNum)) : 0

    return sendJson(res, 200, {
      success: true,
      user: {
        id: userId,
        email: user.email || profile?.email,
        name: profile?.display_name || user.email,
        createdAt: user.created_at,
        updatedAt: nowIso(),
        credits,
      },
      subscription: safeSub,
      hasPaidProduct,
    })
  } catch (e: any) {
    return sendJson(res, 200, { success: false, error: e?.message || '未登录' })
  }
}

