import { baseUrl, parseJson, serviceHeaders } from './_admin.js'
import { requireBearerUser } from './_authBearer.js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const user = await requireBearerUser(req)
    const orderId = String(req.query?.orderId || '').trim()
    if (!orderId) return res.status(400).json({ success: false, error: '缺少 orderId' })

    const rest = `${baseUrl()}/rest/v1`
    const q = new URLSearchParams()
    q.set('provider', 'eq.xorpay')
    q.set('provider_order_id', `eq.${orderId}`)
    q.set('user_id', `eq.${user.id}`)
    q.set('select', '*')

    const ordResp = await fetch(`${rest}/orders?${q.toString()}`, {
      method: 'GET',
      headers: serviceHeaders(),
    })
    const rows = await parseJson(ordResp)
    if (!ordResp.ok) {
      return res.status(500).json({
        success: false,
        error: rows?.message || rows?.hint || '查询订单失败',
        raw: rows,
      })
    }
    const order = Array.isArray(rows) ? rows[0] : rows
    if (!order) return res.status(404).json({ success: false, error: '订单不存在' })

    return res.status(200).json({
      success: true,
      order: {
        orderId: order.provider_order_id,
        planId: order.plan_id,
        status: order.status,
        createdAt: order.created_at,
        paidAt: order.paid_at,
      },
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
