import { apiRefresh } from './auth'
import { clampRefImageForVercel } from '../utils/refImagePayloadClamp'

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

export async function removeBackgroundAPI(params: {
  refImage: string
  resolution: '1024' | '2048'
  outputFormat: 'png' | 'webp'
}): Promise<{ imageUrl: string; size?: string; outputFormat?: string }> {
  const refImage = await clampRefImageForVercel(params.refImage)

  const callOnce = async (token: string) => {
    const idem = (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`) as string
    const resp = await fetch('/api/remove-background', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': idem,
        'X-Confirm-Billable': 'true',
      },
      body: JSON.stringify({
        refImage,
        resolution: params.resolution,
        outputFormat: params.outputFormat,
      }),
    })
    if (resp.status === 413) {
      const err: any = new Error(
        '请求体过大（平台限制）。请换一张更小的图片，或用手机截图后重试。',
      )
      err.code = 'PAYLOAD_TOO_LARGE'
      throw err
    }
    const text = await resp.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { success: false, error: text }
    }
    if (!resp.ok || !data?.success) {
      const raw = data?.raw ? `\nraw: ${JSON.stringify(data.raw).slice(0, 1200)}` : ''
      const message = (data?.error || `处理失败(${resp.status})`) + raw
      const err: any = new Error(message)
      err.code = data?.code || 'UNKNOWN'
      throw err
    }
    return data
  }

  let token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录')

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
  if (!data?.imageUrl) throw new Error('处理成功但未返回图片地址')
  return { imageUrl: data.imageUrl, size: data.size, outputFormat: data.outputFormat }
}
