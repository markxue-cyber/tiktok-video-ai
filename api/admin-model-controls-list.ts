import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    await requireAdmin(req)
    const type = String(req.query?.type || '').trim()
    const params = new URLSearchParams()
    params.set('select', '*')
    params.set('order', 'type.asc,model_id.asc')
    if (type && ['video', 'image', 'llm'].includes(type)) params.set('type', `eq.${type}`)
    const resp = await fetch(`${baseUrl()}/rest/v1/model_controls?${params.toString()}`, { headers: serviceHeaders() })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '获取模型开关失败', raw: data })
    return sendJson(res, 200, { success: true, controls: Array.isArray(data) ? data : [] })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
