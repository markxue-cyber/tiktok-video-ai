import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    await requireAdmin(req)
    const q = String(req.query?.q || '').trim().toLowerCase()
    const plan = String(req.query?.plan || '').trim()
    const frozen = String(req.query?.frozen || '').trim()
    const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query?.limit || '30'), 10) || 30))
    const offset = Math.max(0, Number.parseInt(String(req.query?.offset || '0'), 10) || 0)

    const params = new URLSearchParams()
    params.set('select', 'id,email,display_name,is_frozen,freeze_reason,updated_at,created_at')
    params.set('order', 'created_at.desc')
    params.set('limit', String(limit))
    params.set('offset', String(offset))
    if (frozen === 'true') params.set('is_frozen', 'eq.true')
    if (frozen === 'false') params.set('is_frozen', 'eq.false')
    const usersResp = await fetch(`${baseUrl()}/rest/v1/users?${params.toString()}`, { headers: serviceHeaders() })
    const usersData = await parseJson(usersResp)
    if (!usersResp.ok) return sendJson(res, 200, { success: false, error: usersData?.message || '获取用户失败', raw: usersData })

    let users = Array.isArray(usersData) ? usersData : []
    if (q) {
      users = users.filter((u: any) => {
        const email = String(u?.email || '').toLowerCase()
        const name = String(u?.display_name || '').toLowerCase()
        return email.includes(q) || name.includes(q)
      })
    }

    const userIds = users.map((u: any) => String(u.id)).filter(Boolean)
    const subMap: Record<string, any> = {}
    if (userIds.length) {
      const inExpr = `in.(${userIds.join(',')})`
      const subResp = await fetch(
        `${baseUrl()}/rest/v1/subscriptions?user_id=${encodeURIComponent(inExpr)}&select=user_id,plan_id,status,current_period_end,updated_at`,
        { headers: serviceHeaders() },
      )
      const subData = await parseJson(subResp)
      if (subResp.ok && Array.isArray(subData)) {
        for (const s of subData) subMap[String(s.user_id)] = s
      }
    }

    const rows = users
      .map((u: any) => {
        const s = subMap[String(u.id)] || null
        return {
          id: u.id,
          email: u.email,
          display_name: u.display_name,
          is_frozen: !!u.is_frozen,
          freeze_reason: u.freeze_reason || '',
          created_at: u.created_at,
          updated_at: u.updated_at,
          subscription: s
            ? {
                plan_id: s.plan_id,
                status: s.status,
                current_period_end: s.current_period_end,
                updated_at: s.updated_at,
              }
            : null,
        }
      })
      .filter((u: any) => (plan ? String(u?.subscription?.plan_id || '') === plan : true))

    return sendJson(res, 200, { success: true, users: rows, nextOffset: offset + rows.length, hasMore: rows.length >= limit })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
