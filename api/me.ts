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

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）')

  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) throw new Error('登录已失效，请重新登录')
  return { user: data.user }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })

    const { user } = await requireUser(req)

    const url = process.env.SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）')

    const { createClient } = await import('@supabase/supabase-js')
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { data: profile } = await admin.from('users').select('*').eq('id', user.id).maybeSingle()
    const { data: sub } = await admin.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle()

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

    return sendJson(res, 200, {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: profile?.display_name || user.email,
        createdAt: user.created_at,
        updatedAt: nowIso(),
      },
      subscription: safeSub,
    })
  } catch (e: any) {
    return sendJson(res, 200, { success: false, error: e?.message || '未登录' })
  }
}

