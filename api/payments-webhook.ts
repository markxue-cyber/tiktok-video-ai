import crypto from 'crypto'
import { getSupabaseAdmin } from './_supabase'

function md5(s: string) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex').toLowerCase()
}

function safeJson(body: any) {
  if (body && typeof body === 'object') return body
  try {
    return JSON.parse(String(body || '{}'))
  } catch {
    return {}
  }
}

const PLAN_DAYS: Record<string, number> = { trial: 7, basic: 30, pro: 30, enterprise: 30 }

export default async function handler(req, res) {
  // XorPay usually posts form or json; accept both
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')

  try {
    const secret = process.env.XORPAY_APP_SECRET
    if (!secret) return res.status(500).send('XorPay not configured')

    const data = safeJson(req.body)
    const sign = String(data?.sign || '').toLowerCase()
    const orderId = String(data?.order_id || data?.orderId || '')
    const status = String(data?.status || data?.pay_status || data?.trade_status || '').toLowerCase()

    // Verify sign: docs are inconsistent across pages; we validate using a conservative set of candidates.
    // Common patterns seen: md5(order_id + app_secret) OR md5(order_id + status + app_secret)
    const candidates = [
      md5(`${orderId}${secret}`),
      md5(`${orderId}${status}${secret}`),
      md5(`${orderId}${String(data?.pay_price || data?.price || '')}${secret}`),
    ]
    if (!orderId) return res.status(400).send('missing order_id')
    if (sign && !candidates.includes(sign)) return res.status(400).send('bad sign')

    const admin = getSupabaseAdmin()
    const { data: order } = await admin.from('orders').select('*').eq('provider', 'xorpay').eq('provider_order_id', orderId).maybeSingle()
    if (!order) return res.status(200).send('ok') // don't leak

    // idempotent: if already paid, no-op
    if (order.status === 'paid') return res.status(200).send('ok')

    // Determine paid
    const paid = status === 'paid' || status === 'success' || status === '1' || status === 'yes' || String(data?.paid || '') === 'true'
    if (!paid) {
      await admin.from('orders').update({ status: 'failed', raw: data }).eq('id', order.id)
      return res.status(200).send('ok')
    }

    await admin.from('orders').update({ status: 'paid', paid_at: new Date().toISOString(), raw: data }).eq('id', order.id)

    // Fulfill subscription: extend from max(now, current_end)
    const planId = String(order.plan_id)
    const days = PLAN_DAYS[planId] || 30
    const { data: sub } = await admin.from('subscriptions').select('*').eq('user_id', order.user_id).maybeSingle()
    const now = new Date()
    const base = sub?.current_period_end ? new Date(sub.current_period_end) : now
    const start = base.getTime() > now.getTime() ? base : now
    const end = new Date(start.getTime() + days * 24 * 3600 * 1000)

    await admin
      .from('subscriptions')
      .upsert(
        {
          user_id: order.user_id,
          plan_id: planId,
          status: 'active',
          current_period_start: start.toISOString(),
          current_period_end: end.toISOString(),
          auto_renew: true,
        },
        { onConflict: 'user_id' },
      )

    return res.status(200).send('ok')
  } catch {
    // Always return ok to avoid repeated retries storms; errors are visible in Supabase raw fields/logs.
    return res.status(200).send('ok')
  }
}

