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
  /**
   * 本轮主参考 mediaUrl 与会话内「上一轮用户附件主图」不一致（含新上传/换资产），
   * 服务端应对新图走完整电商分析，勿用同图快捷改图的极简要跟进模板。
   */
  newSubjectMediaThisTurn?: boolean
  /** 先分析后出图：首轮仅返回分析，需配合 generateOnly 第二轮 */
  splitPipeline?: boolean
  /** 第二轮：仅执行出图（须带 analysisText） */
  generateOnly?: boolean
  /**
   * 默认异步：Vercel 上 202 + imageJobId，由前端轮询 /api/home-chat-gen-status。
   * 设为 false 则同步等待整段出图（易触发函数超时）。
   */
  asyncImageGen?: boolean
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
    /** auto：服务端根据话术与是否链式参考上一张成图推断；iterative：在上一版基础上微调；fresh：按新要求整图重做 */
    refinementIntent?: 'auto' | 'iterative' | 'fresh'
    /** OpenAI 兼容 images/generations 的 model id，须与后台 model_controls 中已启用的图像模型一致 */
    imageModel?: string
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
  /** 异步出图：首轮响应 */
  async?: boolean
  imageJobId?: string
}

export type HomeChatGenStatusResult = {
  success: boolean
  status?: string
  result?: HomeChatTurnResult | Record<string, unknown>
  /** failed 且 result 为空时，服务端从 raw.error 透出 */
  jobError?: string | null
  outputUrl?: string | null
  /** 便于排查：任务行 updated_at / created_at（ISO） */
  updatedAt?: string | null
  createdAt?: string | null
  error?: string
  code?: string
}

export async function homeChatGenStatusAPI(
  jobId: string,
  init?: { signal?: AbortSignal },
): Promise<HomeChatGenStatusResult> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录')
  const bust = typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
    ? globalThis.crypto.randomUUID()
    : String(Date.now())
  const resp = await fetch(
    `/api/home-chat-gen-status?id=${encodeURIComponent(jobId)}&_=${encodeURIComponent(bust)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
      signal: init?.signal,
    },
  )
  if (resp.status === 304) {
    return {
      success: false,
      error: '状态查询被缓存拦截（304），请刷新页面后重试',
      code: 'GEN_STATUS_CACHE_304',
    }
  }
  return readJsonOrText(resp) as Promise<HomeChatGenStatusResult>
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
export async function postHomeTelemetry(homeTelemetry: Record<string, unknown>): Promise<boolean> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) return false
  try {
    const resp = await fetch('/api/home-chat-turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ homeTelemetryOnly: true, homeTelemetry }),
    })
    const data = await readJsonOrText(resp)
    return data?.success !== false
  } catch {
    return false
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
