import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin'

const VALID_PLANS = new Set(['trial', 'basic', 'pro', 'enterprise'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const admin = await requireAdmin(req)
    const { userId, action } = req.body || {}
    const uid = String(userId || '').trim()
    const op = String(action || '').trim()
    if (!uid) return sendJson(res, 400, { success: false, error: '缺少 userId' })

    if (op === 'setFrozen') {
      const isFrozen = !!req.body?.isFrozen
      const freezeReason = String(req.body?.freezeReason || '').trim()
      const resp = await fetch(`${baseUrl()}/rest/v1/users?id=eq.${encodeURIComponent(uid)}&select=id`, {
        method: 'PATCH',
        headers: {
          ...serviceHeaders(),
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          is_frozen: isFrozen,
          freeze_reason: isFrozen ? freezeReason || '管理员冻结' : null,
          updated_at: new Date().toISOString(),
        }),
      })
      const data = await parseJson(resp)
      if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '更新冻结状态失败', raw: data })
      return sendJson(res, 200, { success: true, action: op, user: Array.isArray(data) ? data[0] : data })
    }

    if (op === 'setPlan') {
      const planId = String(req.body?.planId || '').trim()
      if (!VALID_PLANS.has(planId)) return sendJson(res, 400, { success: false, error: '无效套餐 planId' })
      const now = new Date()
      const end = new Date(now.getTime() + 30 * 24 * 3600 * 1000)
      const resp = await fetch(`${baseUrl()}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: {
          ...serviceHeaders(),
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify([
          {
            user_id: uid,
            plan_id: planId,
            status: 'active',
            current_period_start: now.toISOString(),
            current_period_end: end.toISOString(),
            auto_renew: true,
            updated_at: now.toISOString(),
          },
        ]),
      })
      const data = await parseJson(resp)
      if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '更新套餐失败', raw: data })

      await fetch(`${baseUrl()}/rest/v1/users?id=eq.${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        headers: { ...serviceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ updated_at: new Date().toISOString(), freeze_reason: null }),
      })

      return sendJson(res, 200, {
        success: true,
        action: op,
        subscription: Array.isArray(data) ? data[0] : data,
        updatedBy: admin.userId,
      })
    }

    return sendJson(res, 400, { success: false, error: '不支持的 action' })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
