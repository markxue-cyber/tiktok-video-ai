import { baseUrl, parseJson, requireAdmin, sendJson, serviceHeaders } from './_admin'

const VALID_TYPE = new Set(['system', 'activity', 'release'])
const VALID_TARGET = new Set(['all', 'trial', 'basic', 'pro', 'enterprise'])
const VALID_STATUS = new Set(['draft', 'published', 'offline'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const admin = await requireAdmin(req)
    const { id, title, content, type, target, status, startsAt, endsAt } = req.body || {}
    const t = String(title || '').trim()
    const c = String(content || '').trim()
    const ty = VALID_TYPE.has(String(type || '')) ? String(type) : 'system'
    const tg = VALID_TARGET.has(String(target || '')) ? String(target) : 'all'
    const st = VALID_STATUS.has(String(status || '')) ? String(status) : 'draft'
    if (!t || !c) return sendJson(res, 400, { success: false, error: '标题和内容不能为空' })

    const nowIso = new Date().toISOString()
    const payload: any = {
      title: t,
      content: c,
      type: ty,
      target: tg,
      status: st,
      starts_at: startsAt || null,
      ends_at: endsAt || null,
      updated_by: admin.userId,
      updated_at: nowIso,
    }
    if (st === 'published') payload.published_at = nowIso

    let resp: Response
    if (id) {
      resp = await fetch(`${baseUrl()}/rest/v1/announcements?id=eq.${encodeURIComponent(String(id))}&select=*`, {
        method: 'PATCH',
        headers: {
          ...serviceHeaders(),
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      })
    } else {
      resp = await fetch(`${baseUrl()}/rest/v1/announcements`, {
        method: 'POST',
        headers: {
          ...serviceHeaders(),
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify([{ ...payload, created_by: admin.userId }]),
      })
    }
    const data = await parseJson(resp)
    if (!resp.ok) return sendJson(res, 200, { success: false, error: data?.message || '保存公告失败', raw: data })
    return sendJson(res, 200, { success: true, announcement: Array.isArray(data) ? data[0] : data })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}
