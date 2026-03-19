import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin'

const VALID = new Set(['trial', 'basic', 'pro', 'enterprise'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const admin = await requireAdmin(req)
    const { planId, name, priceCents, currency, dailyQuota, features, modelWhitelist, enabled } = req.body || {}
    const pid = String(planId || '').trim()
    if (!VALID.has(pid)) return sendJson(res, 400, { success: false, error: 'planId 非法' })
    const nowIso = new Date().toISOString()
    const payload = {
      plan_id: pid,
      name: String(name || '').trim() || pid,
      price_cents: Math.max(0, Number(priceCents || 0)),
      currency: String(currency || 'CNY').trim() || 'CNY',
      daily_quota: Math.max(0, Number(dailyQuota || 0)),
      features: Array.isArray(features) ? features : [],
      model_whitelist: Array.isArray(modelWhitelist) ? modelWhitelist : [],
      enabled: enabled !== false,
      updated_by: admin.userId,
      updated_at: nowIso,
    }
    const resp = await fetch(`${baseUrl()}/rest/v1/package_configs`, {
      method: 'POST',
      headers: {
        ...serviceHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([payload]),
    })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '保存套餐配置失败', raw: data })
    return sendJson(res, 200, { success: true, config: Array.isArray(data) ? data[0] : data })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
