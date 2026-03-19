import { getSupabaseAdmin, requireUser } from './_supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { user } = await requireUser(req)
    const orderId = String(req.query?.orderId || '').trim()
    if (!orderId) return res.status(400).json({ success: false, error: '缺少 orderId' })

    const admin = getSupabaseAdmin()
    const { data: order, error } = await admin
      .from('orders')
      .select('*')
      .eq('provider', 'xorpay')
      .eq('provider_order_id', orderId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) return res.status(500).json({ success: false, error: error.message || '查询订单失败' })
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

