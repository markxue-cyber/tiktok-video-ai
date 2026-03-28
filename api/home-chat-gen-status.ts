import { requireUser } from './_supabase.js'
import { fetchHomeChatImageJobForUser } from './_homeChatImageJob.js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { user } = await requireUser(req)
    const userId = user.id || user.sub
    const jobId = String(req.query?.id || '').trim()
    if (!jobId) {
      return res.status(200).json({ success: false, error: '缺少 id', code: 'BAD_REQUEST' })
    }
    const row = await fetchHomeChatImageJobForUser(jobId, userId)
    if (!row) {
      return res.status(200).json({ success: false, error: '任务不存在', code: 'NOT_FOUND' })
    }
    const status = String(row.status || '')
    const raw = (row.raw as Record<string, unknown>) || {}
    const result = raw.result
    return res.status(200).json({
      success: true,
      status,
      result,
      outputUrl: row.output_url ? String(row.output_url) : null,
    })
  } catch (e: any) {
    return res.status(200).json({ success: false, error: e?.message || '服务器错误' })
  }
}
