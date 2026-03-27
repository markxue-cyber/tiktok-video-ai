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

async function readJsonOrText(resp: Response): Promise<any> {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, error: text }
  }
}

export type HomeChatTurnPayload = {
  mediaType: 'image' | 'video'
  mediaUrl: string
  userMessage: string
  /** 先分析后出图：首轮仅返回分析，需配合 generateOnly 第二轮 */
  splitPipeline?: boolean
  /** 第二轮：仅执行出图（须带 analysisText） */
  generateOnly?: boolean
  analysisText?: string
  generateMode?: 'preview' | 'final'
  previewToken?: string
  history: { role: 'user' | 'assistant'; text: string }[]
  params: {
    resolution: string
    aspectRatio: string
    imageCount?: number
    style: string
    refWeight: number
    optimizePrompt: boolean
    hdEnhance: boolean
    negativePrompt: boolean
    subjectLock?: 'high' | 'medium'
    multiRatio?: boolean
    targetRatios?: string[]
    abVariant?: boolean
    qcEnabled?: boolean
    generateMode?: 'preview' | 'final'
    previewToken?: string
  }
}

export type HomeChatImageItem = {
  url: string
  ratio?: string
  variant?: string
  qcScore?: number
  qcIssues?: string[]
}

export type HomeChatTurnResult = {
  success: boolean
  kind?: 'analysis' | 'mixed' | 'blocked' | 'mock'
  /** 服务端将出图放到第二轮，首轮可先展示分析 */
  deferredImageGen?: boolean
  code?: string
  error?: string
  message?: string
  analysisText?: string
  optimizedPrompt?: string
  imageUrls?: string[]
  images?: HomeChatImageItem[]
  nextQuestion?: string
  quickActions?: string[]
  previewToken?: string
  opsPack?: {
    titles?: string[]
    sellingPoints?: string[]
    detailLead?: string
  }
  meta?: Record<string, unknown>
}

export async function homeChatTurnAPI(
  body: HomeChatTurnPayload,
  init?: { signal?: AbortSignal },
): Promise<HomeChatTurnResult> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录')

  const idem =
    typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`

  const callOnce = async (t: string) => {
    const resp = await fetch('/api/home-chat-turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${t}`,
        'Idempotency-Key': idem,
        'X-Confirm-Billable': 'true',
      },
      body: JSON.stringify(body),
      signal: init?.signal,
    })
    return readJsonOrText(resp)
  }

  let data = await callOnce(token)
  if (data && data.success === false) {
    const msg = String(data.error || '')
    if (msg.includes('登录') || msg.includes('JWT') || msg.includes('token')) {
      const next = await refreshAccessTokenIfPossible()
      if (next) data = await callOnce(next)
    }
  }
  return data as HomeChatTurnResult
}
