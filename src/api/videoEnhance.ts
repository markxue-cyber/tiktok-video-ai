import { apiRefresh } from './auth'
import type { VideoSubmitResult } from './video'

async function refreshAccessTokenIfPossible(): Promise<string> {
  try {
    const raw = localStorage.getItem('tikgen.session') || ''
    const parsed = raw ? JSON.parse(raw) : null
    const refreshToken = String(parsed?.refresh_token || '')
    if (!refreshToken) return ''
    const r = await apiRefresh(refreshToken)
    const nextSession = {
      access_token: String(r?.session?.access_token || ''),
      refresh_token: String(r?.session?.refresh_token || refreshToken),
      expires_at: r?.session?.expires_at,
      token_type: r?.session?.token_type,
    }
    if (!nextSession.access_token) return ''
    localStorage.setItem('tikgen.accessToken', nextSession.access_token)
    localStorage.setItem('tikgen.session', JSON.stringify(nextSession))
    return nextSession.access_token
  } catch {
    return ''
  }
}

function looksLikeAuthInvalid(err: any): boolean {
  const msg = String(err?.message || '')
  const code = String(err?.code || '')
  const s = `${code} ${msg}`.toLowerCase()
  return (
    s.includes('登录已失效') ||
    s.includes('请重新登录') ||
    s.includes('missing authorization') ||
    s.includes('invalid token') ||
    s.includes('jwt') ||
    s.includes('未登录') ||
    s.includes('缺少 authorization')
  )
}

function isTransientNetworkError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase()
  const name = String(err?.name || '')
  if (name === 'TypeError' && (msg.includes('fetch') || msg.includes('failed') || msg.includes('network'))) return true
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('econnreset')
  )
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

export type VideoUpscaleSignResult = {
  signedUrl: string
  token: string
  path: string
  publicUrl: string
}

/** 申请大视频直传签名（最大 50MB，由服务端校验） */
export async function requestVideoUpscaleUploadSign(params: {
  fileName: string
  contentType: string
  fileSize: number
}): Promise<VideoUpscaleSignResult> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录')
  const resp = await fetch('/api/video-upscale-sign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })
  const rawText = await resp.text()
  let data: any = {}
  try {
    data = rawText ? JSON.parse(rawText) : {}
  } catch {
    data = { error: rawText?.slice(0, 400) || '响应非 JSON' }
  }
  if (!resp.ok || !data?.success) {
    const detail =
      data?.error ||
      data?.message ||
      (typeof data?.raw === 'object' ? JSON.stringify(data.raw).slice(0, 200) : '') ||
      (resp.status >= 500 ? `服务暂不可用(${resp.status})，请稍后重试或联系管理员` : '')
    throw new Error(detail || `签名失败(${resp.status})`)
  }
  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path,
    publicUrl: data.publicUrl,
  }
}

/**
 * 按 Supabase storage-js uploadToSignedUrl：PUT + FormData（token 已在 signedUrl 查询参数中）
 * @param _uploadToken 保留兼容，可忽略
 */
export async function uploadVideoFileToSignedUrl(signedUrl: string, _uploadToken: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('cacheControl', '3600')
  form.append('', file)
  const r = await fetch(signedUrl, {
    method: 'PUT',
    body: form,
    headers: {
      'x-upsert': 'true',
    },
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(t?.slice(0, 400) || `直传失败(${r.status})`)
  }
}

export type VideoEnhanceSubmitParams = {
  inputVideoUrl: string
  targetResolution: '1080p' | '2k' | '4k'
  targetFps: 30 | 60
  videoDurationSec: number
  aspectRatio: string
}

/** 提交「画质提升」任务（Sora 2.0 + 源视频 URL），计费与轮询同 /api/generate */
export async function submitVideoEnhanceJob(params: VideoEnhanceSubmitParams): Promise<VideoSubmitResult> {
  const callOnce = async (token: string) => {
    const idem = (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`) as string
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': idem,
        'X-Confirm-Billable': 'true',
      },
      body: JSON.stringify({
        videoEnhance: true,
        inputVideoUrl: params.inputVideoUrl,
        targetResolution: params.targetResolution,
        targetFps: params.targetFps,
        videoDurationSec: params.videoDurationSec,
        aspect_ratio: params.aspectRatio,
        model: 'sora-2',
        resolution:
          params.targetResolution === '4k' ? '2160p' : params.targetResolution === '2k' ? '1440p' : '1080p',
      }),
    })
    const data = await response.json()
    if (!response.ok || !data?.success) {
      const raw = data?.raw ? `\nraw: ${JSON.stringify(data.raw).slice(0, 1200)}` : ''
      const message = (data?.error || `提交失败(${response.status})`) + raw
      const err: any = new Error(message)
      err.code = data?.code || 'UNKNOWN'
      throw err
    }
    if (!data.taskId) throw new Error('提交成功但未返回 taskId')
    return { taskId: data.taskId, message: data.message || '创建视频处理中，请稍候…' } as VideoSubmitResult
  }

  let token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录再提交任务')

  const maxAttempts = 4
  let result: VideoSubmitResult | null = null
  let lastErr: any

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      result = await callOnce(token)
      lastErr = null
      break
    } catch (e: any) {
      lastErr = e
      if (looksLikeAuthInvalid(e)) {
        const refreshed = await refreshAccessTokenIfPossible()
        if (!refreshed) throw e
        token = refreshed
        continue
      }
      if (attempt < maxAttempts - 1 && isTransientNetworkError(e)) {
        await sleep(500 + attempt * 1200)
        continue
      }
      throw e
    }
  }

  if (lastErr) throw lastErr
  if (!result) throw new Error('提交失败')
  return result
}
