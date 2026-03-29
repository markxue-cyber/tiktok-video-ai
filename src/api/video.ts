import { apiRefresh } from './auth'

export type VideoSubmitResult = { taskId: string; message: string }
export type VideoStatusResult = { status: string; videoUrl: string; progress: string; failReason?: string; failCode?: string }

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

// 视频生成API调用
export const generateVideoAPI = async (
  prompt: string,
  model: string,
  opts?: { durationSec?: number; aspectRatio?: string; resolution?: string; refImage?: string },
): Promise<VideoSubmitResult> => {
  // 映射UI模型到API模型
  const modelMap: Record<string, string> = {
    sora: 'sora-2',
    kling: 'doubao-seedance-1-5-pro-251215', // kling不可用，用seedance
    runway: 'veo3',
    seedance: 'doubao-seedance-1-5-pro-251215',
  }

  // 如果传入的本身就是聚合API支持的模型字符串，则直接透传
  const apiModel = modelMap[model] || model || 'doubao-seedance-1-5-pro-251215'

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
        prompt,
        model: apiModel,
        duration: opts?.durationSec,
        aspect_ratio: opts?.aspectRatio,
        resolution: opts?.resolution,
        refImage: opts?.refImage,
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

    if (!data.taskId) {
      throw new Error('提交成功但未返回taskId')
    }

    return { taskId: data.taskId, message: data.message || '视频生成中，预计需要3-5分钟' }
  }

  let token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录再生成视频')

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

// 查询视频状态（需登录：成片成功时服务端幂等扣积分）
export const checkVideoStatus = async (taskId: string): Promise<VideoStatusResult> => {
  const callOnce = async (token: string) => {
    const response = await fetch(`/api/generate?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()
    if (response.status === 401) {
      const err: any = new Error(data?.error || '未登录或登录已失效')
      err.code = 'AUTH_REQUIRED'
      throw err
    }
    return {
      status: data.status || 'unknown',
      videoUrl: data.videoUrl || '',
      progress: data.progress || '0%',
      failReason: data.failReason || data.fail_reason,
      failCode: data.failCode || data.fail_code || data.failCode,
    } as VideoStatusResult
  }

  let token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录')

  const maxAttempts = 4
  let lastErr: any
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callOnce(token)
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
  throw lastErr || new Error('查询失败')
}
