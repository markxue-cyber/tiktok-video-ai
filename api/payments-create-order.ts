import crypto from 'crypto'
import { baseUrl, parseJson, serviceHeaders } from './_admin.js'
import { requireBearerUser } from './_authBearer.js'

function md5(s: string) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex').toLowerCase()
}

/** XorPay 文档中的 status → 中文说明（fee_error = 商户余额不足，非你网站代码 bug） */
function xorpayFailureUserMessage(status: string, data: Record<string, unknown>): string {
  const s = String(status || '').toLowerCase()
  const info = data?.info
  const detail =
    typeof info === 'string'
      ? info
      : info && typeof info === 'object' && info !== null
        ? String((info as any).msg || (info as any).message || '').trim()
        : ''

  const byCode: Record<string, string> = {
    fee_error:
      '【XorPay 商户余额不足】你在 XorPay 平台的可用余额不够出单/扣手续费（体验版余额为 0 时最常见）。请登录 xorpay.com → 使用「账户充值」充值后再发起支付。这与网站代码无关，充值后即可恢复。',
    sign_error:
      '【签名错误】请核对 Vercel 里 XORPAY_APP_SECRET 与 XorPay 后台「应用配置」的 app secret 是否完全一致（复制时不要多空格），改后需 Redeploy。',
    aid_not_exist: '【aid 无效】请核对 XORPAY_AID 与 XorPay 后台「应用配置」里的 aid 是否一致。',
    pay_type_error: '【支付方式不支持】请使用微信扫码(native) 或 支付宝(alipay)。',
    missing_argument: '【参数不全】请确认 XORPAY_NOTIFY_URL 为公网 HTTPS，且订单参数完整。',
    no_contract: '【通道未签约】请在 XorPay 后台按指引完成微信/支付宝收款签约。',
    no_alipay_contract: '【支付宝未签约】请按 XorPay 或支付宝邮件完成支付宝收款签约。',
    app_off: '【XorPay 账号异常】账号可能被冻结，请联系 XorPay 客服。',
    order_payed: '该商户订单号已支付过，请关闭弹窗后重新点击「立即开通」生成新订单。',
    order_expire: '订单已过期，请关闭后重新下单。',
    order_exist: '订单号冲突，请关闭后重新下单。',
  }

  const head = byCode[s] || `XorPay 下单失败（错误码：${status || 'unknown'}）。请对照 xorpay.com 开发文档或联系 XorPay 客服。`
  return detail ? `${head}\n详情：${detail}` : head
}

async function markXorpayOrderFailed(
  rest: string,
  jsonHeaders: Record<string, string>,
  orderId: string,
  raw: Record<string, unknown>,
) {
  try {
    await fetch(
      `${rest}/orders?provider=eq.xorpay&provider_order_id=eq.${encodeURIComponent(orderId)}`,
      {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'failed', raw }),
      },
    )
  } catch {
    // ignore
  }
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
    const jsonHeaders = { ...headers, Prefer: 'return=minimal' as const }

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
        return JSON.parse(text) as Record<string, unknown>
      } catch {
        return { _raw: text } as Record<string, unknown>
      }
    })()

    if (!resp.ok) {
      await markXorpayOrderFailed(rest, jsonHeaders, orderId, { ...data, httpStatus: resp.status })
      return res.status(200).json({
        success: false,
        error: `XorPay 接口 HTTP ${resp.status}，请稍后重试或联系 XorPay。`,
        raw: data,
      })
    }

    const st = String(data?.status ?? '').trim().toLowerCase()
    if (st !== 'ok') {
      await markXorpayOrderFailed(rest, jsonHeaders, orderId, data)
      const msg = xorpayFailureUserMessage(st || 'unknown', data)
      return res.status(200).json({
        success: false,
        error: msg,
        code: st || 'unknown',
        raw: data,
      })
    }

    const info = data?.info
    const infoObj = info && typeof info === 'object' && !Array.isArray(info) ? (info as Record<string, unknown>) : null
    const infoQr = infoObj?.qr != null ? String(infoObj.qr).trim() : ''

    const payUrl = String(data?.pay_url || data?.url || (data?.data as any)?.pay_url || infoQr || '').trim()
    const qrPayload = String(
      data?.qrcode ||
        (data?.data as any)?.qrcode ||
        data?.code_url ||
        (data?.data as any)?.code_url ||
        (infoObj?.code_url != null ? String(infoObj.code_url) : '') ||
        infoQr ||
        payUrl ||
        '',
    ).trim()

    const patchResp = await fetch(
      `${rest}/orders?provider=eq.xorpay&provider_order_id=eq.${encodeURIComponent(orderId)}`,
      {
        method: 'PATCH',
        headers: jsonHeaders,
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
