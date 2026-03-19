import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin'

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const admin = await requireAdmin(req)
    const { modelId, type, enabled, recommended, note } = req.body || {}
    const mid = String(modelId || '').trim()
    const mtype = String(type || '').trim()
    if (!mid || !['video', 'image', 'llm'].includes(mtype)) {
      return sendJson(res, 400, { success: false, error: '缺少 modelId 或 type 非法' })
    }
    const nowIso = new Date().toISOString()

    if (recommended === true) {
      await fetch(`${baseUrl()}/rest/v1/model_controls?type=eq.${encodeURIComponent(mtype)}`, {
        method: 'PATCH',
        headers: { ...serviceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommended: false, updated_at: nowIso, updated_by: admin.userId }),
      })
    }

    const resp = await fetch(`${baseUrl()}/rest/v1/model_controls`, {
      method: 'POST',
      headers: {
        ...serviceHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([
        {
          model_id: mid,
          type: mtype,
          enabled: enabled !== false,
          recommended: recommended === true,
          note: note || null,
          updated_by: admin.userId,
          updated_at: nowIso,
        },
      ]),
    })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '更新模型开关失败', raw: data })
    return sendJson(res, 200, { success: true, control: Array.isArray(data) ? data[0] : data })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
