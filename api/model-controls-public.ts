import { baseUrl, parseJson, sendJson, serviceHeaders } from './_admin'

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const type = String(req.query?.type || '').trim()
    const params = new URLSearchParams()
    params.set('select', 'model_id,type,enabled,recommended,note,updated_at')
    if (type && ['video', 'image', 'llm'].includes(type)) params.set('type', `eq.${type}`)
    const resp = await fetch(`${baseUrl()}/rest/v1/model_controls?${params.toString()}`, { headers: serviceHeaders() })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '获取模型配置失败', raw: data })
    const rows = Array.isArray(data) ? data : []
    return sendJson(res, 200, { success: true, controls: rows })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
