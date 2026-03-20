import { getSupabaseAdmin, requireUser } from './_supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { user } = await requireUser(req)
    const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query?.limit || '20'), 10) || 20))
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('support_tickets')
      .select('id,ticket_no,status,kind,subject,content,email,created_at,updated_at,closed_at,priority')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return res.status(500).json({ success: false, error: error.message || '获取工单失败' })
    return res.status(200).json({ success: true, tickets: Array.isArray(data) ? data : [] })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
