import { getSupabaseAnon, getSupabaseAdmin } from './_supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ success: false, error: '缺少 email/password' })
    const supa = getSupabaseAnon()
    const { data, error } = await supa.auth.signInWithPassword({ email: String(email), password: String(password) })
    if (error) return res.status(200).json({ success: false, error: error.message })

    // ensure profile row exists
    const user = data?.user
    if (user?.id) {
      const admin = getSupabaseAdmin()
      await admin.from('users').upsert({ id: user.id, email: user.email, display_name: user.email }, { onConflict: 'id' })
      // ensure trial exists if none
      const { data: sub } = await admin.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle()
      if (!sub) {
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
    }

    return res.status(200).json({ success: true, session: data?.session, user: data?.user })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

