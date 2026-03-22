// 签发 Supabase Storage 直传地址（REST，与 storage-js createSignedUploadUrl 一致）
import { requireUser } from './_supabase.js'

const MAX_BYTES = 50 * 1024 * 1024

function mustEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function baseUrl() {
  return String(mustEnv('SUPABASE_URL')).replace(/\/$/, '')
}

async function ensureAssetsBucket(serviceKey) {
  await fetch(`${baseUrl()}/storage/v1/bucket`, {
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
      file_size_limit: 52428800,
    }),
  })
}

function safeJson(res) {
  return res.text().then((t) => {
    try {
      return t ? JSON.parse(t) : {}
    } catch {
      return { _raw: t }
    }
  })
}

export default async function handler(req, res) {
  // 统一 JSON，避免前端只看到 500
  const ok = (payload) => res.status(200).json(payload)

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireUser(req)
    const userId = user?.id
    if (!userId) {
      return ok({ success: false, error: '无法识别用户', code: 'AUTH' })
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const fileName = String(body.fileName || 'video.mp4').slice(0, 200)
    const contentType = String(body.contentType || 'video/mp4').toLowerCase()
    const fileSize = Number(body.fileSize)

    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return ok({ success: false, error: '缺少有效 fileSize', code: 'BAD_REQUEST' })
    }
    if (fileSize > MAX_BYTES) {
      return ok({ success: false, error: '视频超过 50MB 上限', code: 'FILE_TOO_LARGE' })
    }
    if (!contentType.startsWith('video/')) {
      return ok({ success: false, error: '仅支持视频文件', code: 'BAD_REQUEST' })
    }

    const safe = fileName.replace(/[^\w.\-]/g, '_')
    const objectPath = `${userId}/video-upscale/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`

    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    await ensureAssetsBucket(serviceKey)

    const storageV1 = `${baseUrl()}/storage/v1`
    // bucketId/path → POST .../object/upload/sign/assets/userId/...
    const signPath = `assets/${objectPath}`
    const signUrl = `${storageV1}/object/upload/sign/${signPath}`

    const signResp = await fetch(signUrl, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    })

    const signJson = await safeJson(signResp)

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
    const fullSigned = relStr.startsWith('http://') || relStr.startsWith('https://')
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
        error: '签发地址中缺少 token，请确认 Storage 版本支持 upload/sign',
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
  } catch (e) {
    console.error('[video-upscale-sign]', e)
    return ok({
      success: false,
      error: e?.message || '签名服务异常',
      code: 'UNKNOWN',
    })
  }
}
