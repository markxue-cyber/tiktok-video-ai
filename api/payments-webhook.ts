import crypto from 'crypto'
import { baseUrl, parseJson, serviceHeaders } from './_admin.js'
import {
  TOPUP_PLAN_ID,
  creditsForTopupYuan,
  grantSubscriptionCreditsOnce,
  grantUserCredits,
  PLAN_MONTHLY_CREDITS,
} from './_billing.js'

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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')

  try {
    const secret = process.env.XORPAY_APP_SECRET
    if (!secret) return res.status(500).send('XorPay not configured')

    const data = safeJson(req.body)
    const sign = String(data?.sign || '').toLowerCase()
    const orderId = String(data?.order_id || data?.orderId || '')
    const status = String(data?.status || data?.pay_status || data?.trade_status || '').toLowerCase()

    const candidates = [
      md5(`${orderId}${secret}`),
      md5(`${orderId}${status}${secret}`),
      md5(`${orderId}${String(data?.pay_price || data?.price || '')}${secret}`),
    ]
    if (!orderId) return res.status(400).send('missing order_id')
    if (sign && !candidates.includes(sign)) return res.status(400).send('bad sign')

    const rest = `${baseUrl()}/rest/v1`
    const h = serviceHeaders()
    const jsonHeaders = { ...h, 'Content-Type': 'application/json' }

    const ordResp = await fetch(
      `${rest}/orders?provider=eq.xorpay&provider_order_id=eq.${encodeURIComponent(orderId)}&select=*`,
      { method: 'GET', headers: h },
    )
    const ordRows = await parseJson(ordResp)
    const order = Array.isArray(ordRows) ? ordRows[0] : ordRows
    if (!order) return res.status(200).send('ok')

    if (order.status === 'paid') return res.status(200).send('ok')

    const paid =
      status === 'paid' ||
      status === 'success' ||
      status === '1' ||
      status === 'yes' ||
      String(data?.paid || '') === 'true'
    if (!paid) {
      await fetch(`${rest}/orders?id=eq.${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        headers: { ...jsonHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'failed', raw: data }),
      })
      return res.status(200).send('ok')
    }

    const planId = String(order.plan_id)
    await fetch(`${rest}/orders?id=eq.${encodeURIComponent(order.id)}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString(), raw: data }),
    })

    if (planId === TOPUP_PLAN_ID) {
      const yuan = Math.floor(Number(order.amount_cents || 0) / 100)
      const credits = creditsForTopupYuan(yuan)
      if (credits > 0) {
        try {
          await grantUserCredits(String(order.user_id), credits)
        } catch {
          // 缺列等不阻断 webhook 应答
        }
      }
      return res.status(200).send('ok')
    }

    const days = PLAN_DAYS[planId] || 30
    const subResp = await fetch(
      `${rest}/subscriptions?user_id=eq.${encodeURIComponent(order.user_id)}&select=*`,
      { method: 'GET', headers: h },
    )
    const subRows = await parseJson(subResp)
    const sub = Array.isArray(subRows) ? subRows[0] : subRows
    const now = new Date()
    const base = sub?.current_period_end ? new Date(sub.current_period_end) : now
    const start = base.getTime() > now.getTime() ? base : now
    const end = new Date(start.getTime() + days * 24 * 3600 * 1000)

    const subBody = {
      user_id: order.user_id,
      plan_id: planId,
      status: 'active',
      current_period_start: start.toISOString(),
      current_period_end: end.toISOString(),
      auto_renew: true,
    }

    await fetch(`${rest}/subscriptions?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        ...jsonHeaders,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(subBody),
    })

    const grant = PLAN_MONTHLY_CREDITS[planId as keyof typeof PLAN_MONTHLY_CREDITS]
    if (typeof grant === 'number' && grant > 0) {
      try {
        await grantSubscriptionCreditsOnce(String(order.user_id), subBody.current_period_start, grant)
      } catch {
        // 缺列 / 未执行 RPC 迁移时不阻断 webhook
      }
    }

    return res.status(200).send('ok')
  } catch {
    return res.status(200).send('ok')
  }
}
