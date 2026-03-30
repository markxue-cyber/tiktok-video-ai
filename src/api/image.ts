import { apiRefresh } from './auth'

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
  return s.includes('登录已失效') || s.includes('请重新登录') || s.includes('missing authorization') || s.includes('invalid token') || s.includes('jwt')
}

/** 浏览器 / 代理 / 冷启动等导致的瞬时失败，适合自动重试（每次请求使用新的 Idempotency-Key） */
function isTransientNetworkError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase()
  const name = String(err?.name || '')
  if (name === 'TypeError' && (msg.includes('fetch') || msg.includes('failed') || msg.includes('network')))
    return true
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('econnreset')
  )
}

/** 服务端已归类的瞬时上游错误，可自动重试（每次新 Idempotency-Key） */
function isTransientUpstreamImageCode(err: any): boolean {
  const code = String(err?.code || '')
  return code === 'UPSTREAM_BAD_RESPONSE' || code === 'UPSTREAM_TIMEOUT'
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

export async function generateImageAPI(params: {
  prompt: string
  negativePrompt?: string
  model: string
  aspectRatio: string
  resolution: string
  refImage?: string
  imageCount?: number
  signal?: AbortSignal
}): Promise<{ imageUrl: string; size?: string }> {
  const callOnce = async (token: string) => {
    const idem = (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`) as string
    const resp = await fetch('/api/image-generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': idem,
        'X-Confirm-Billable': 'true',
      },
      signal: params.signal,
      body: JSON.stringify({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        negative_prompt: params.negativePrompt,
        model: params.model,
        aspect_ratio: params.aspectRatio,
        resolution: params.resolution,
        refImage: params.refImage,
        n: params.imageCount || 1,
        count: params.imageCount || 1,
        num_images: params.imageCount || 1,
      }),
    })
    const text = await resp.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { success: false, error: text }
    }
    if (!resp.ok || !data?.success) {
      const code = data?.code || 'UNKNOWN'
      const omitRaw =
        code === 'AGGREGATE_API_KEY_INVALID' ||
        code === 'MODEL_UNAVAILABLE' ||
        code === 'PAYMENT_REQUIRED' ||
        code === 'UPSTREAM_BAD_RESPONSE'
      const raw =
        omitRaw || !data?.raw ? '' : `\nraw: ${JSON.stringify(data.raw).slice(0, 1200)}`
      const message = (data?.error || `生成失败(${resp.status})`) + raw
      const err: any = new Error(message)
      err.code = code
      throw err
    }
    return data
  }

  let token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录再生成图片')

  const maxAttempts = 4
  let data: any
  let lastErr: any

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      data = await callOnce(token)
      lastErr = null
      break
    } catch (e: any) {
      lastErr = e
      if (e?.name === 'AbortError' || params.signal?.aborted) throw e
      if (looksLikeAuthInvalid(e)) {
        const refreshed = await refreshAccessTokenIfPossible()
        if (!refreshed) throw e
        token = refreshed
        continue
      }
      if (attempt < maxAttempts - 1 && (isTransientNetworkError(e) || isTransientUpstreamImageCode(e))) {
        await sleep(500 + attempt * 1200)
        continue
      }
      throw e
    }
  }

  if (lastErr) throw lastErr

  if (!data?.imageUrl) throw new Error('生成成功但未返回图片地址')
  return { imageUrl: data.imageUrl, size: data.size }
}

