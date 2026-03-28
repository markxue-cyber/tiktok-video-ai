// 首页/资产：签发 Storage 直传，避免 JSON+data URL 超过 Vercel 请求体上限（视频必走此路径）
function sendJson(res: any, status: number, payload: any) {
  try {
    return res.status(status).json(payload)
  } catch {
    return res.status(status).end(JSON.stringify(payload))
  }
}

function mustEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function supabaseBase() {
  return String(mustEnv('SUPABASE_URL')).replace(/\/$/, '')
}

async function parseJson(resp: Response) {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { _raw: text }
  }
}

async function requireUser(req: any) {
  const auth = String(req.headers?.authorization || '')
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new Error('未登录（缺少 Authorization Bearer token）')
  const anonKey = mustEnv('SUPABASE_ANON_KEY')
  const resp = await fetch(`${supabaseBase()}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  })
  const data: any = await parseJson(resp as any)
  if (!resp.ok) throw new Error(data?.error_description || data?.message || '登录已失效，请重新登录')
  const user = data?.user || data
  const userId = user?.id || user?.sub
  if (!userId) throw new Error('登录已失效，请重新登录')
  return { userId: String(userId) }
}

async function ensureAssetsBucket(serviceKey: string) {
  await fetch(`${supabaseBase()}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: 'assets',
      name: 'assets',
      public: true,
      file_size_limit: null,
    }),
  })
}

const MAX_VIDEO_BYTES = 500 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export default async function handler(req: any, res: any) {
  const ok = (payload: any) => sendJson(res, 200, payload)

  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  }

  try {
    const { userId } = await requireUser(req)

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const fileName = String(body.fileName || 'upload.bin').slice(0, 200)
    const contentType = String(body.contentType || '').toLowerCase()
    const fileSize = Number(body.fileSize)
    const kind = String(body.kind || '').trim() as 'image' | 'video'

    if (!['image', 'video'].includes(kind)) {
      return ok({ success: false, error: 'kind 须为 image 或 video', code: 'BAD_REQUEST' })
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return ok({ success: false, error: '缺少有效 fileSize', code: 'BAD_REQUEST' })
    }

    const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
    if (fileSize > maxBytes) {
      return ok({
        success: false,
        error: kind === 'video' ? '视频超过 500MB 上限' : '图片超过 25MB 上限',
        code: 'FILE_TOO_LARGE',
      })
    }

    if (kind === 'video') {
      if (!contentType.startsWith('video/')) {
        return ok({ success: false, error: '视频 kind 须配合 video/* 的 Content-Type', code: 'BAD_REQUEST' })
      }
      if (contentType !== 'video/mp4' && contentType !== 'video/quicktime') {
        return ok({ success: false, error: '仅支持 MP4 / MOV（QuickTime）', code: 'BAD_REQUEST' })
      }
    } else {
      if (!contentType.startsWith('image/')) {
        return ok({ success: false, error: '图片 kind 须配合 image/* 的 Content-Type', code: 'BAD_REQUEST' })
      }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
        return ok({ success: false, error: '仅支持 JPG / PNG / WebP', code: 'BAD_REQUEST' })
      }
    }

    const safe = fileName.replace(/[^\w.\-]/g, '_')
    const objectPath = `${userId}/home-chat/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`

    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    await ensureAssetsBucket(serviceKey)

    const storageV1 = `${supabaseBase()}/storage/v1`
    const signPath = `assets/${objectPath}`
    const signUrl = `${storageV1}/object/upload/sign/${signPath}`

    const signResp = await fetch(signUrl, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })

    const signJson: any = await parseJson(signResp as any)

    if (!signResp.ok) {
      const msg =
        signJson?.message ||
        signJson?.error ||
        signJson?.statusCode ||
        (typeof signJson?._raw === 'string' ? signJson._raw.slice(0, 300) : '') ||
        `签发失败(${signResp.status})`
      return ok({
        success: false,
        error: String(msg),
        code: 'SIGN_FAILED',
        raw: signJson,
      })
    }

    const rel = signJson.url || signJson.signedUrl || signJson.signedURL
    if (!rel) {
      return ok({
        success: false,
        error: '签发接口未返回 url',
        code: 'SIGN_BAD_RESPONSE',
        raw: signJson,
      })
    }

    const relStr = String(rel).trim()
    const fullSigned =
      relStr.startsWith('http://') || relStr.startsWith('https://')
        ? relStr
        : `${storageV1}${relStr.startsWith('/') ? relStr : `/${relStr}`}`

    let token = ''
    try {
      token = new URL(fullSigned).searchParams.get('token') || ''
    } catch {
      token = ''
    }

    if (!token) {
      return ok({
        success: false,
        error: '签发地址中缺少 token',
        code: 'SIGN_BAD_RESPONSE',
        raw: signJson,
      })
    }

    const publicUrl = `${storageV1}/object/public/assets/${objectPath}`

    return ok({
      success: true,
      signedUrl: fullSigned,
      token,
      path: objectPath,
      publicUrl,
    })
  } catch (e: any) {
    console.error('[assets-upload-sign]', e)
    return ok({
      success: false,
      error: e?.message || '签名服务异常',
      code: 'UNKNOWN',
    })
  }
}
