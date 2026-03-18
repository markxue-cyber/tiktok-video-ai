import { getSupabaseAdmin, requireUser } from './_supabase.js'

const nowIso = () => new Date().toISOString()

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { user } = await requireUser(req)
    const admin = getSupabaseAdmin()
    const { data: profile } = await admin.from('users').select('*').eq('id', user.id).maybeSingle()
    const { data: sub } = await admin.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle()

    const active =
      !!sub &&
      sub.status === 'active' &&
      typeof sub.current_period_end === 'string' &&
      new Date(sub.current_period_end).getTime() > Date.now()

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

    return res.status(200).json({
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
    return res.status(200).json({ success: false, error: e?.message || '未登录' })
  }
}

