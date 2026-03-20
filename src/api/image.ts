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

export async function generateImageAPI(params: {
  prompt: string
  negativePrompt?: string
  model: string
  aspectRatio: string
  resolution: string
  refImage?: string
  imageCount?: number
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
      const raw = data?.raw ? `\nraw: ${JSON.stringify(data.raw).slice(0, 1200)}` : ''
      const message = (data?.error || `生成失败(${resp.status})`) + raw
      const err: any = new Error(message)
      err.code = data?.code || 'UNKNOWN'
      throw err
    }
    return data
  }

  let token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录再生成图片')
  let data: any
  try {
    data = await callOnce(token)
  } catch (e: any) {
    if (!looksLikeAuthInvalid(e)) throw e
    const refreshed = await refreshAccessTokenIfPossible()
    if (!refreshed) throw e
    data = await callOnce(refreshed)
  }

  if (!data?.imageUrl) throw new Error('生成成功但未返回图片地址')
  return { imageUrl: data.imageUrl, size: data.size }
}

