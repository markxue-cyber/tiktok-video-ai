import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const admin = await requireAdmin(req)
    const planId = String(req.body?.planId || '').trim()
    if (!planId) return sendJson(res, 400, { success: false, error: '缺少 planId' })

    const subResp = await fetch(
      `${baseUrl()}/rest/v1/subscriptions?plan_id=eq.${encodeURIComponent(planId)}&status=eq.active&select=user_id&limit=1`,
      { headers: serviceHeaders() },
    )
    const subData = await parseJson(subResp)
    if (subResp.ok && Array.isArray(subData) && subData.length > 0) {
      return sendJson(res, 200, { success: false, error: '该套餐仍有激活用户，不能删除。可先禁用。' })
    }

    const resp = await fetch(`${baseUrl()}/rest/v1/package_configs?plan_id=eq.${encodeURIComponent(planId)}&select=*`, {
      method: 'PATCH',
      headers: {
        ...serviceHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        enabled: false,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: admin.userId,
      }),
    })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '删除套餐失败', raw: data })
    return sendJson(res, 200, { success: true, config: Array.isArray(data) ? data[0] : data })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
