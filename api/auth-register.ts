import { createClient } from '@supabase/supabase-js'

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

    const url = process.env.SUPABASE_URL
    const anonKey = process.env.SUPABASE_ANON_KEY
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !anonKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_ANON_KEY）')

    const supaAnon = createClient(url, anonKey, { auth: { persistSession: false } })
    const siteUrlBase = process.env.SITE_URL || process.env.VERCEL_URL
    const siteUrl = siteUrlBase ? (String(siteUrlBase).startsWith('http') ? String(siteUrlBase) : `https://${siteUrlBase}`) : ''

    const { data, error } = await supaAnon.auth.signUp({
      email: String(email),
      password: String(password),
      options: siteUrl ? { emailRedirectTo: `${siteUrl}/` } : undefined,
    })
    if (error) return sendJson(res, 200, { success: false, error: error.message })

    const user = data?.user
    if (user?.id) {
      if (!serviceKey) throw new Error('Supabase 未配置（缺少 SUPABASE_SERVICE_ROLE_KEY）')
      const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
      await admin.from('users').upsert({ id: user.id, email: user.email, display_name: displayName || user.email }, { onConflict: 'id' })

      // default subscription: trial 7 days
      const now = new Date()
      const end = new Date(now.getTime() + 7 * 24 * 3600 * 1000)
      await admin.from('subscriptions').upsert(
        {
          user_id: user.id,
          plan_id: 'trial',
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: end.toISOString(),
          auto_renew: false,
        },
        { onConflict: 'user_id' },
      )
    }

    return sendJson(res, 200, {
      success: true,
      session: data?.session || null,
      user: data?.user || null,
      needsEmailConfirm: !data?.session,
    })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}

