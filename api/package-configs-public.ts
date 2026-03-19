import { baseUrl, parseJson, sendJson, serviceHeaders } from './_admin.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const includeDisabled = String(req.query?.includeDisabled || '') === 'true'
    const includeDeleted = String(req.query?.includeDeleted || '') === 'true'
    const params = new URLSearchParams()
    params.set('select', '*')
    params.set('order', 'display_order.asc,created_at.asc')
    if (!includeDisabled) params.set('enabled', 'eq.true')
    if (!includeDeleted) params.set('deleted_at', 'is.null')
    const resp = await fetch(`${baseUrl()}/rest/v1/package_configs?${params.toString()}`, { headers: serviceHeaders() })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '获取套餐配置失败', raw: data })
    return sendJson(res, 200, { success: true, configs: Array.isArray(data) ? data : [] })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
