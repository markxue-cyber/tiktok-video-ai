// 为「视频画质提升」大文件（最大 50MB）签发 Supabase Storage 直传 URL，避免经过 Vercel 4.5MB 请求体限制
import { getSupabaseAdmin, requireUser } from './_supabase.js'

function mustEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function baseUrl() {
  return String(mustEnv('SUPABASE_URL')).replace(/\/$/, '')
}

async function ensureAssetsBucket(serviceKey: string) {
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

const MAX_BYTES = 50 * 1024 * 1024

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const { user } = await requireUser(req)
    const userId = user.id
    const body = req.body || {}
    const fileName = String(body.fileName || 'video.mp4').slice(0, 200)
    const contentType = String(body.contentType || 'video/mp4').toLowerCase()
    const fileSize = Number(body.fileSize)
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return res.status(200).json({ success: false, error: '缺少有效 fileSize', code: 'BAD_REQUEST' })
    }
    if (fileSize > MAX_BYTES) {
      return res.status(200).json({ success: false, error: '视频超过 50MB 上限', code: 'FILE_TOO_LARGE' })
    }
    if (!contentType.startsWith('video/')) {
      return res.status(200).json({ success: false, error: '仅支持视频文件', code: 'BAD_REQUEST' })
    }

    const safe = fileName.replace(/[^\w.\-]/g, '_')
    const objectPath = `${userId}/video-upscale/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`

    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    await ensureAssetsBucket(serviceKey)

    const admin = getSupabaseAdmin()
    const bucket = admin.storage.from('assets')
    const anyBucket = bucket as any
    if (typeof anyBucket.createSignedUploadUrl !== 'function') {
      return res.status(200).json({
        success: false,
        error: '当前运行环境不支持直传签名（需 @supabase/supabase-js storage createSignedUploadUrl）',
        code: 'UNSUPPORTED',
      })
    }

    const { data, error } = await anyBucket.createSignedUploadUrl(objectPath)
    if (error || !data?.signedUrl || !data?.token) {
      return res.status(200).json({
        success: false,
        error: error?.message || '签发上传地址失败',
        code: 'SIGN_FAILED',
      })
    }

    const publicUrl = `${baseUrl()}/storage/v1/object/public/assets/${objectPath}`
    return res.status(200).json({
      success: true,
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path || objectPath,
      publicUrl,
    })
  } catch (e: any) {
    return res.status(200).json({ success: false, error: e?.message || '服务器错误', code: 'UNKNOWN' })
  }
}
