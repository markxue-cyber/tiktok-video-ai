import { requireUser } from './_supabase.js'
import { fetchHomeChatImageJobForUser } from './_homeChatImageJob.js'

function noStoreHeaders(res: any) {
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

/** 与 rewrite /api/home-chat-gen-status → /api/home-chat-turn 配合，少占一个 Hobby 函数配额 */
export async function handleHomeChatGenStatus(req: any, res: any): Promise<void> {
  if (req.method !== 'GET') {
    noStoreHeaders(res)
    res.status(405).json({ success: false, error: 'Method not allowed' })
    return
  }
  noStoreHeaders(res)
  try {
    const { user } = await requireUser(req)
    const userId = user.id || user.sub
    const jobId = String(req.query?.id || '').trim()
    if (!jobId) {
      res.status(200).json({ success: false, error: '缺少 id', code: 'BAD_REQUEST' })
      return
    }
    const row = await fetchHomeChatImageJobForUser(jobId, userId)
    if (!row) {
      res.status(200).json({ success: false, error: '任务不存在', code: 'NOT_FOUND' })
      return
    }
    const status = String(row.status || '')
    const raw = (row.raw as Record<string, unknown>) || {}
    const result = raw.result
    const rawErr = typeof raw.error === 'string' ? raw.error.trim() : ''
    const jobError =
      rawErr ||
      (status === 'failed' && result && typeof result === 'object' && result !== null && 'error' in result
        ? String((result as { error?: unknown }).error || '').trim()
        : '')
    const updatedAt = row.updated_at != null ? String(row.updated_at) : null
    const createdAt = row.created_at != null ? String(row.created_at) : null
    res.status(200).json({
      success: true,
      status,
      result,
      jobError: jobError || null,
      outputUrl: row.output_url ? String(row.output_url) : null,
      updatedAt,
      createdAt,
    })
  } catch (e: any) {
    res.status(200).json({ success: false, error: e?.message || '服务器错误' })
  }
}
