import crypto from 'crypto'
import { getSupabaseAdmin, requireUser } from './_supabase.js'

function md5(s: string) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex').toLowerCase()
}

const PLANS: Record<string, { amountCents: number; name: string; days: number }> = {
  trial: { amountCents: 0, name: '试用版', days: 7 },
  basic: { amountCents: 6900, name: '基础版', days: 30 },
  pro: { amountCents: 24900, name: '专业版', days: 30 },
  enterprise: { amountCents: 119900, name: '旗舰版', days: 30 },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { user } = await requireUser(req)
    const { planId, payType } = req.body || {}
    const plan = PLANS[String(planId || '')]
    if (!plan) return res.status(400).json({ success: false, error: '无效的 planId' })
    if (plan.amountCents <= 0) return res.status(400).json({ success: false, error: '试用版不需要支付' })

    const aid = process.env.XORPAY_AID
    const secret = process.env.XORPAY_APP_SECRET
    const notifyUrl = process.env.XORPAY_NOTIFY_URL
    if (!aid || !secret || !notifyUrl) return res.status(500).json({ success: false, error: 'XorPay 未配置（缺少 XORPAY_AID/XORPAY_APP_SECRET/XORPAY_NOTIFY_URL）' })

    // XorPay docs: sign = md5(name + pay_type + price + order_id + notify_url + app_secret)
    const orderId = `ord_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
    const name = `TikGen AI ${plan.name}（${plan.days}天）`
    const type = String(payType || 'native') // native/jsapi/mini etc.
    const price = (plan.amountCents / 100).toFixed(2)
    const sign = md5(`${name}${type}${price}${orderId}${notifyUrl}${secret}`)

    const admin = getSupabaseAdmin()
    await admin.from('orders').insert({
      user_id: user.id,
      provider: 'xorpay',
      provider_order_id: orderId,
      amount_cents: plan.amountCents,
      currency: 'CNY',
      status: 'created',
      plan_id: String(planId),
      raw: { createdFrom: 'create-order', payType: type },
    })

    // Create order URL (documented by XorPay): https://xorpay.com/api/pay/{aid}
    const url = `https://xorpay.com/api/pay/${encodeURIComponent(aid)}`
    const payload = new URLSearchParams()
    payload.set('name', name)
    payload.set('pay_type', type)
    payload.set('price', price)
    payload.set('order_id', orderId)
    payload.set('notify_url', notifyUrl)
    payload.set('sign', sign)
    payload.set('order_uid', user.email || user.id)

    const resp = await fetch(url, { method: 'POST', body: payload })
    const text = await resp.text()
    const data = (() => {
      try {
        return JSON.parse(text)
      } catch {
        return { _raw: text }
      }
    })()

    if (!resp.ok) return res.status(200).json({ success: false, error: `XorPay下单失败(${resp.status})`, raw: data })

    // Common fields seen in XorPay integrations: pay_url / qrcode / url
    const payUrl = data?.pay_url || data?.url || data?.data?.pay_url || ''
    const qrcode = data?.qrcode || data?.data?.qrcode || ''

    await admin.from('orders').update({ raw: data }).eq('provider', 'xorpay').eq('provider_order_id', orderId)

    return res.status(200).json({ success: true, orderId, payUrl, qrcode, raw: data })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

