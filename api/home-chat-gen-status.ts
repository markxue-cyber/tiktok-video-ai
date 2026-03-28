import { requireUser } from './_supabase.js'
import { fetchHomeChatImageJobForUser } from './_homeChatImageJob.js'

function noStoreHeaders(res: any) {
  // 轮询接口绝不能被 CDN/浏览器缓存；否则易返回 304 + 空 body，前端解析成 {} 永远等不到终态
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    noStoreHeaders(res)
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }
  noStoreHeaders(res)
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
    const rawErr = typeof raw.error === 'string' ? raw.error.trim() : ''
    const jobError =
      rawErr ||
      (status === 'failed' && result && typeof result === 'object' && result !== null && 'error' in result
        ? String((result as { error?: unknown }).error || '').trim()
        : '')
    const updatedAt = row.updated_at != null ? String(row.updated_at) : null
    const createdAt = row.created_at != null ? String(row.created_at) : null
    return res.status(200).json({
      success: true,
      status,
      result,
      /** 异步任务异常或上游超时时写在 raw.error，便于前端展示（result 可能为 null） */
      jobError: jobError || null,
      outputUrl: row.output_url ? String(row.output_url) : null,
      updatedAt,
      createdAt,
    })
  } catch (e: any) {
    return res.status(200).json({ success: false, error: e?.message || '服务器错误' })
  }
}
