function safeFilename(raw: string) {
  const name = String(raw || 'preview')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return name || 'preview'
}

function inferExt(contentType: string) {
  const ct = String(contentType || '').toLowerCase()
  if (ct.includes('image/png')) return 'png'
  if (ct.includes('image/jpeg')) return 'jpg'
  if (ct.includes('image/webp')) return 'webp'
  if (ct.includes('image/gif')) return 'gif'
  if (ct.includes('video/mp4')) return 'mp4'
  if (ct.includes('video/webm')) return 'webm'
  return ''
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const src = String(req.query?.url || '').trim()
    if (!src) return res.status(400).json({ success: false, error: '缺少 url' })
    if (!/^https?:\/\//i.test(src)) {
      return res.status(400).json({ success: false, error: '仅支持 http/https 链接' })
    }

    const upstream = await fetch(src)
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ success: false, error: '资源预览失败' })
    }

    const contentType = String(upstream.headers.get('content-type') || 'application/octet-stream')
    const ext = inferExt(contentType)
    const askedName = safeFilename(String(req.query?.name || 'preview'))
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(askedName)
    const filename = hasExt || !ext ? askedName : `${askedName}.${ext}`

    const ab = await upstream.arrayBuffer()
    const buf = Buffer.from(ab)
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(buf.length))
    res.setHeader('Cache-Control', 'private, no-store, max-age=0')
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return res.status(200).send(buf)
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '预览失败' })
  }
}

