import { baseUrl, parseJson, sendJson, serviceHeaders } from './_admin.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const plan = String(req.query?.plan || 'all').trim().toLowerCase() || 'all'
    const resp = await fetch(`${baseUrl()}/rest/v1/announcements?select=*&status=eq.published&order=published_at.desc.nullslast,created_at.desc&limit=100`, {
      headers: serviceHeaders(),
    })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '获取公告失败', raw: data })

    const now = Date.now()
    const list = (Array.isArray(data) ? data : []).filter((x: any) => {
      const target = String(x?.target || 'all').toLowerCase()
      const targetOk = target === 'all' || target === plan
      if (!targetOk) return false
      const startsAt = x?.starts_at ? Date.parse(String(x.starts_at)) : NaN
      const endsAt = x?.ends_at ? Date.parse(String(x.ends_at)) : NaN
      if (Number.isFinite(startsAt) && startsAt > now) return false
      if (Number.isFinite(endsAt) && endsAt < now) return false
      return true
    })

    return sendJson(res, 200, { success: true, announcements: list })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
