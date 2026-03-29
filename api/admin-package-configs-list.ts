import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin.js'

const FALLBACK = [
  {
    plan_id: 'trial',
    name: '试用版',
    price_cents: 0,
    currency: 'CNY',
    daily_quota: 9,
    features: ['0 元开通', '赠送 9 积分', '体验全功能'],
    model_whitelist: [],
    enabled: true,
  },
  {
    plan_id: 'basic',
    name: '基础版',
    price_cents: 990,
    currency: 'CNY',
    daily_quota: 99,
    features: ['9.9 元/月', '每月 99 积分', '生图 4 积分/张、视频 8 积分/条'],
    model_whitelist: [],
    enabled: true,
  },
  {
    plan_id: 'pro',
    name: '专业版',
    price_cents: 7900,
    currency: 'CNY',
    daily_quota: 880,
    features: ['79 元/月', '每月 880 积分', '高频出图与测款'],
    model_whitelist: [],
    enabled: true,
  },
  {
    plan_id: 'enterprise',
    name: '旗舰版',
    price_cents: 24900,
    currency: 'CNY',
    daily_quota: 2850,
    features: ['249 元/月', '每月 2850 积分', '团队与大量素材'],
    model_whitelist: [],
    enabled: true,
  },
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
