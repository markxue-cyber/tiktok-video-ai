import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin'

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    await requireAdmin(req)
    const resp = await fetch(`${baseUrl()}/rest/v1/announcements?select=*&order=created_at.desc&limit=100`, { headers: serviceHeaders() })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '获取公告失败', raw: data })
    return sendJson(res, 200, { success: true, announcements: Array.isArray(data) ? data : [] })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
