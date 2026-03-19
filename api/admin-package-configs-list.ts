import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin.js'

const FALLBACK = [
  { plan_id: 'trial', name: '试用版', price_cents: 0, currency: 'CNY', daily_quota: 3, features: ['每天3次', '基础功能'], model_whitelist: [], enabled: true },
  { plan_id: 'basic', name: '基础版', price_cents: 6900, currency: 'CNY', daily_quota: 20, features: ['每天20次', '全部模型'], model_whitelist: [], enabled: true },
  { plan_id: 'pro', name: '专业版', price_cents: 24900, currency: 'CNY', daily_quota: 999999, features: ['高配额', '4K输出'], model_whitelist: [], enabled: true },
  { plan_id: 'enterprise', name: '旗舰版', price_cents: 119900, currency: 'CNY', daily_quota: 999999, features: ['企业级', 'API接入'], model_whitelist: [], enabled: true },
]

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    await requireAdmin(req)
    const resp = await fetch(`${baseUrl()}/rest/v1/package_configs?select=*&deleted_at=is.null&order=display_order.asc,created_at.asc`, { headers: serviceHeaders() })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '获取套餐配置失败', raw: data })
    const rows = Array.isArray(data) ? data : []
    return sendJson(res, 200, { success: true, configs: rows.length ? rows : FALLBACK })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
