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
  /** 链式改图：上一张成品图 URL（须为资产库公开链接） */
  refImageUrl?: string
  /** 会话内最近一次商品分析摘要，供第二轮提示词优化 */
  contextSummary?: string
  /** 是否本会话已产出过图（用于动态快捷指令） */
  hasSessionGenerated?: boolean
  sessionId?: string
  locale?: string
  /** 先分析后出图：首轮仅返回分析，需配合 generateOnly 第二轮 */
  splitPipeline?: boolean
  /** 第二轮：仅执行出图（须带 analysisText） */
  generateOnly?: boolean
  analysisText?: string
  /** 分析阶段使用 SSE，首字更快（与 generateOnly 互斥） */
  streamAnalysis?: boolean
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

/** 首页专用埋点/反馈：写入服务端任务表 raw 字段，不计入出图计费 */
export async function postHomeTelemetry(homeTelemetry: Record<string, unknown>): Promise<void> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) return
  try {
    await fetch('/api/home-chat-turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ homeTelemetryOnly: true, homeTelemetry }),
    })
  } catch {
    // ignore
  }
}

type StreamHandlers = {
  onDelta?: (chunk: string) => void
  onOps?: (ops: HomeChatTurnResult['opsPack']) => void
}

function parseSseBuffer(
  buffer: string,
  handlers: StreamHandlers,
): { buffer: string; done: HomeChatTurnResult | null; error: Error | null } {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  let done: HomeChatTurnResult | null = null
  let error: Error | null = null
  for (const part of parts) {
    for (const rawLine of part.split('\n')) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const jsonStr = line.slice(5).trimStart()
      if (!jsonStr || jsonStr === '[DONE]') continue
      try {
        const json = JSON.parse(jsonStr) as Record<string, unknown>
        if (json.type === 'delta' && typeof json.text === 'string') handlers.onDelta?.(json.text)
        if (json.type === 'ops' && json.opsPack) handlers.onOps?.(json.opsPack as HomeChatTurnResult['opsPack'])
        if (json.type === 'done') {
          const { type: _t, ...rest } = json as Record<string, unknown> & { type: string }
          done = rest as unknown as HomeChatTurnResult
        }
        if (json.type === 'error') {
          error = new Error(String((json as { error?: string }).error || '流式失败'))
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }
  return { buffer: rest, done, error }
}

/** 首轮：分析阶段流式（SSE），done 事件与 JSON 接口一致 */
export async function homeChatTurnStreamAPI(
  body: HomeChatTurnPayload,
  init?: { signal?: AbortSignal } & StreamHandlers,
): Promise<HomeChatTurnResult> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录')

  const idem =
    typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`

  const callOnce = async (t: string): Promise<HomeChatTurnResult> => {
    const { onDelta, onOps, signal } = init || {}
    const resp = await fetch('/api/home-chat-turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${t}`,
        'Idempotency-Key': idem,
        'X-Confirm-Billable': 'true',
      },
      body: JSON.stringify({ ...body, streamAnalysis: true }),
      signal,
    })

    const ct = resp.headers.get('content-type') || ''
    if (!ct.includes('text/event-stream')) {
      return readJsonOrText(resp) as Promise<HomeChatTurnResult>
    }

    const reader = resp.body?.getReader()
    if (!reader) throw new Error('无法读取流式响应')
    const decoder = new TextDecoder()
    let buf = ''
    let result: HomeChatTurnResult | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parsed = parseSseBuffer(buf, { onDelta, onOps })
      buf = parsed.buffer
      if (parsed.error) throw parsed.error
      if (parsed.done) result = parsed.done
    }
    const tail = parseSseBuffer(buf + '\n\n', { onDelta, onOps })
    if (tail.error) throw tail.error
    if (tail.done) result = tail.done

    if (!result) return { success: false, error: '流式响应未完整' }
    return result
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
