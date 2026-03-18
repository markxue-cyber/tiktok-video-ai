import { getSupabaseAnon, getSupabaseAdmin } from './_supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { email, password, displayName } = req.body || {}
    if (!email || !password) return res.status(400).json({ success: false, error: '缺少 email/password' })
    const supa = getSupabaseAnon()
    const siteUrl = process.env.SITE_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
    const { data, error } = await supa.auth.signUp({
      email: String(email),
      password: String(password),
      options: siteUrl ? { emailRedirectTo: `${siteUrl}/` } : undefined,
    })
    if (error) return res.status(200).json({ success: false, error: error.message })

    const user = data?.user
    if (user?.id) {
      const admin = getSupabaseAdmin()
      await admin.from('users').upsert({ id: user.id, email: user.email, display_name: displayName || user.email }, { onConflict: 'id' })
      // default subscription: trial 7 days
      const now = new Date()
      const end = new Date(now.getTime() + 7 * 24 * 3600 * 1000)
      await admin
        .from('subscriptions')
        .upsert(
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

    return res.status(200).json({
      success: true,
      session: data?.session || null,
      user: data?.user || null,
      needsEmailConfirm: !data?.session,
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

