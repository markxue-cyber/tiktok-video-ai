import { baseUrl, parseJson, sendJson, serviceHeaders } from './_admin.js'

/** 前台展示以产品定义为准（避免库里仍是旧价/旧文案时用户看到错误套餐） */
const CANONICAL_DISPLAY = {
  trial: {
    name: '试用版',
    price_cents: 0,
    daily_quota: 9,
    features: ['0 元开通', '赠送 9 积分（约 2 张图或 1 次视频预览）', '体验全功能'],
  },
  basic: {
    name: '基础版',
    price_cents: 990,
    daily_quota: 99,
    features: ['9.9 元/月', '每月 99 积分（约 24 张图或 12 条视频）', '生图 4 积分/张、视频 8 积分/条'],
  },
  pro: {
    name: '专业版',
    price_cents: 7900,
    daily_quota: 880,
    features: ['79 元/月', '每月 880 积分（约 220 张图或 110 条视频）', '适合高频出图与测款'],
  },
  enterprise: {
    name: '旗舰版',
    price_cents: 24900,
    daily_quota: 2850,
    features: ['249 元/月', '每月 2850 积分（约 712 张图或 356 条视频）', '团队与大量素材场景'],
  },
}

function mergeCanonical(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => {
    const pid = String(row?.plan_id || '')
    const c = CANONICAL_DISPLAY[pid]
    if (!c) return row
    return {
      ...row,
      name: c.name,
      price_cents: c.price_cents,
      daily_quota: c.daily_quota,
      features: Array.isArray(c.features) ? c.features : row.features,
    }
  })
}

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
    const merged = mergeCanonical(Array.isArray(data) ? data : [])
    return sendJson(res, 200, { success: true, configs: merged })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
