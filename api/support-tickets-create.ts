import { getSupabaseAdmin, requireUser } from './_supabase.js'

function makeTicketNo() {
  const d = new Date()
  const y = d.getFullYear().toString().slice(-2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `TK${y}${m}${day}${rand}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { user } = await requireUser(req)
    const kindRaw = String(req.body?.kind || 'other').trim()
    const kind = kindRaw === 'bug' || kindRaw === 'suggestion' || kindRaw === 'other' ? kindRaw : 'other'
    const content = String(req.body?.content || '').trim()
    const subject = String(req.body?.subject || '').trim() || `用户反馈(${kind})`
    const email = String(req.body?.email || '').trim() || String(user.email || '')
    const page = String(req.body?.page || '').trim()
    if (!content) return res.status(400).json({ success: false, error: '请填写问题描述' })
    if (content.length > 5000) return res.status(400).json({ success: false, error: '问题描述过长（最多 5000 字）' })

    const admin = getSupabaseAdmin()
    const ticketNo = makeTicketNo()
    const attachments = page ? [{ type: 'page', value: page }] : []
    const { data, error } = await admin
      .from('support_tickets')
      .insert({
        ticket_no: ticketNo,
        user_id: user.id,
        email: email || null,
        kind,
        subject,
        content,
        attachments,
        status: 'open',
        priority: 'normal',
      })
      .select('id,ticket_no,status,kind,subject,content,email,created_at,updated_at')
      .single()
    if (error || !data) return res.status(500).json({ success: false, error: error?.message || '创建工单失败' })
    return res.status(200).json({ success: true, ticket: data })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
