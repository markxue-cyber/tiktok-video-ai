import crypto from 'crypto'
import { baseUrl, parseJson, serviceHeaders } from './_admin.js'
import { requireBearerUser } from './_authBearer.js'

function md5(s: string) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex').toLowerCase()
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const user = await requireBearerUser(req)
    const { planId, payType } = req.body || {}
    const pid = String(planId || '').trim()
    if (!pid) return res.status(400).json({ success: false, error: '无效的 planId' })

    const rest = `${baseUrl()}/rest/v1`
    const headers = {
      ...serviceHeaders(),
      'Content-Type': 'application/json',
    }

    const cfgResp = await fetch(
      `${rest}/package_configs?plan_id=eq.${encodeURIComponent(pid)}&deleted_at=is.null&select=*`,
      { method: 'GET', headers: serviceHeaders() },
    )
    const cfgRows = await parseJson(cfgResp)
    if (!cfgResp.ok) {
      return res.status(400).json({
        success: false,
        error: cfgRows?.message || cfgRows?.hint || '读取套餐配置失败',
        raw: cfgRows,
      })
    }
    const cfg = Array.isArray(cfgRows) ? cfgRows[0] : cfgRows
    if (!cfg) return res.status(400).json({ success: false, error: '套餐不存在或已下线' })
    if (cfg.enabled === false) return res.status(400).json({ success: false, error: '套餐当前不可购买' })

    const plan = {
      amountCents: Number(cfg.price_cents || 0),
      name: String(cfg.name || pid),
      days: 30,
    }
    if (plan.amountCents <= 0) return res.status(400).json({ success: false, error: '试用版不需要支付' })

    const aid = process.env.XORPAY_AID
    const secret = process.env.XORPAY_APP_SECRET
    const notifyUrl = process.env.XORPAY_NOTIFY_URL
    if (!aid || !secret || !notifyUrl) {
      return res.status(500).json({
        success: false,
        error: 'XorPay 未配置（缺少 XORPAY_AID / XORPAY_APP_SECRET / XORPAY_NOTIFY_URL）',
      })
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
    const name = `TikGen AI ${plan.name}（${plan.days}天）`
    const type = String(payType || 'native')
    const price = (plan.amountCents / 100).toFixed(2)
    const sign = md5(`${name}${type}${price}${orderId}${notifyUrl}${secret}`)

    const insertBody = {
      user_id: user.id,
      provider: 'xorpay',
      provider_order_id: orderId,
      amount_cents: plan.amountCents,
      currency: 'CNY',
      status: 'created',
      plan_id: pid,
      raw: { createdFrom: 'create-order', payType: type },
    }

    const insResp = await fetch(`${rest}/orders`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(insertBody),
    })
    if (!insResp.ok) {
      const err = await parseJson(insResp)
      return res.status(500).json({
        success: false,
        error:
          err?.message ||
          err?.hint ||
          '创建本地订单失败（请确认 Supabase 已创建 orders 表且服务密钥有效）',
        raw: err,
      })
    }

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

    if (!resp.ok) {
      return res.status(200).json({ success: false, error: `XorPay下单失败(${resp.status})`, raw: data })
    }

    const st = String(data?.status || '').toLowerCase()
    if (st && st !== 'ok') {
      const info = data?.info
      const hint =
        typeof info === 'string'
          ? info
          : info && typeof info === 'object'
            ? String((info as any).msg || (info as any).message || JSON.stringify(info))
            : ''
      return res.status(200).json({
        success: false,
        error: hint ? `XorPay：${hint}` : `XorPay 下单未成功（${data.status}）`,
        raw: data,
      })
    }

    const info = data?.info
    const infoObj = info && typeof info === 'object' && !Array.isArray(info) ? (info as Record<string, unknown>) : null
    const infoQr = infoObj?.qr != null ? String(infoObj.qr).trim() : ''

    const payUrl = String(data?.pay_url || data?.url || data?.data?.pay_url || infoQr || '').trim()
    const qrPayload = String(
      data?.qrcode ||
        data?.data?.qrcode ||
        data?.code_url ||
        data?.data?.code_url ||
        (infoObj?.code_url != null ? String(infoObj.code_url) : '') ||
        infoQr ||
        payUrl ||
        '',
    ).trim()

    const patchResp = await fetch(
      `${rest}/orders?provider=eq.xorpay&provider_order_id=eq.${encodeURIComponent(orderId)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ raw: data }),
      },
    )
    if (!patchResp.ok) {
      const pe = await parseJson(patchResp)
      return res.status(200).json({
        success: true,
        orderId,
        payUrl: payUrl || qrPayload,
        qrcode: qrPayload,
        raw: data,
        warn: pe?.message || '已下单但更新订单详情失败',
      })
    }

    return res.status(200).json({
      success: true,
      orderId,
      payUrl: payUrl || qrPayload,
      qrcode: qrPayload,
      raw: data,
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
