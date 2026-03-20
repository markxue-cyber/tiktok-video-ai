import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    await requireAdmin(req)
    const q = String(req.query?.q || '').trim().toLowerCase()
    const status = String(req.query?.status || '').trim()
    const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query?.limit || '50'), 10) || 50))
    const offset = Math.max(0, Number.parseInt(String(req.query?.offset || '0'), 10) || 0)

    const params = new URLSearchParams()
    params.set('select', 'id,ticket_no,user_id,email,kind,subject,content,attachments,status,priority,admin_note,created_at,updated_at,closed_at')
    params.set('order', 'created_at.desc')
    params.set('limit', String(limit))
    params.set('offset', String(offset))
    if (status && status !== 'all') params.set('status', `eq.${status}`)

    const resp = await fetch(`${baseUrl()}/rest/v1/support_tickets?${params.toString()}`, { headers: serviceHeaders() })
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '获取工单失败', raw: data })

    let tickets = Array.isArray(data) ? data : []
    if (q) {
      tickets = tickets.filter((t: any) => {
        const fields = [t.ticket_no, t.email, t.subject, t.content, t.user_id].map((x) => String(x || '').toLowerCase())
        return fields.some((x) => x.includes(q))
      })
    }
    return sendJson(res, 200, { success: true, tickets, nextOffset: offset + tickets.length, hasMore: tickets.length >= limit })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
