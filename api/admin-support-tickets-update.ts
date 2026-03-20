import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin.js'

const VALID_STATUS = new Set(['open', 'in_progress', 'resolved', 'closed'])
const VALID_PRIORITY = new Set(['low', 'normal', 'high', 'urgent'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    await requireAdmin(req)
    const ticketId = String(req.body?.ticketId || '').trim()
    if (!ticketId) return sendJson(res, 400, { success: false, error: '缺少 ticketId' })

    const nowIso = new Date().toISOString()
    const patch: any = { updated_at: nowIso }
    if (req.body?.status != null) {
      const st = String(req.body.status).trim()
      if (!VALID_STATUS.has(st)) return sendJson(res, 400, { success: false, error: '无效状态 status' })
      patch.status = st
      patch.closed_at = st === 'closed' || st === 'resolved' ? nowIso : null
    }
    if (req.body?.priority != null) {
      const p = String(req.body.priority).trim()
      if (!VALID_PRIORITY.has(p)) return sendJson(res, 400, { success: false, error: '无效优先级 priority' })
      patch.priority = p
    }
    if (req.body?.adminNote != null) patch.admin_note = String(req.body.adminNote || '').trim()

    const resp = await fetch(`${baseUrl()}/rest/v1/support_tickets?id=eq.${encodeURIComponent(ticketId)}&select=*`, {
      method: 'PATCH',
      headers: {
        ...serviceHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(patch),
    })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '更新工单失败', raw: data })
    return sendJson(res, 200, { success: true, ticket: Array.isArray(data) ? data[0] : data })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
