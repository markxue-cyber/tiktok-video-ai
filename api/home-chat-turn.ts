/**
 * 首页对话模块 · 单轮编排（GPT-4o 理解 / 意图；nano-banana-2 出图）
 * 禁止在本接口内调用任何视频生成/编辑类上游。
 */
import { requireUser } from './_supabase.js'
import { checkAndConsume, finalizeConsumption } from './_billing.js'

const BLOCKED_VIDEO_EDIT_MSG =
  '当前对话模块暂不支持视频生成、剪辑、二次创作类功能，仅支持视频内容分析、脚本拆解、拍摄手法解读、台词提取等需求，请您调整提问内容后重试'

const DEFAULT_NEG =
  '模糊、低分辨率、变形、失真、水印、多余文字、过曝、欠曝、构图混乱、肢体畸形、画面杂乱'

/** 拼入最终出图 prompt，降低明显违规与虚假宣传风险（首页专用） */
const COMPLIANCE_TAIL =
  '【合规】商品外观真实一致，禁止虚假功效与极限用语；画面不含低俗、侵权或明显仿冒元素；不生成可识别真实人物肖像。'

const RATE_ERR = '请求过于频繁，请稍后再试'
const ECOM_ANALYSIS_FORMAT = [
  '请严格按以下结构输出，中文，分点简洁，不写无关寒暄：',
  '【商品主体识别】',
  '- 商品品类：',
  '- 主体颜色：',
  '- 材质质感：',
  '- 风格定位：',
  '【商用视觉诊断】',
  '- 构图优点：',
  '- 构图问题：',
  '- 可提炼视觉卖点（3-5条，可直接用于标题/卖点）：',
  '【平台适配建议】',
  '- 淘宝：',
  '- 抖音：',
  '- 小红书：',
  '- 亚马逊：',
  '【场景与人群】',
  '- 适用场景：',
  '- 目标人群：',
  '若媒体为视频，再额外输出：',
  '【视频关键帧与动态卖点】',
  '- 关键帧1/2/3（时间点 + 画面内容）：',
  '- 动态展示功能亮点：',
  '要求：所有结论必须对电商运营可执行，避免空泛描述；看不清的内容明确标注“无法确认”。',
].join('\n')

/** 同参考图、已出过完整分析后的改图跟进轮（含自定义长句）：只写执行说明，禁止重复首轮大模板 */
const ECOM_MINIMAL_EXEC_FOLLOWUP = [
  '这是同一会话、同一参考图上的「改图跟进轮」：对话中已出现过完整的【商品主体识别】等首轮分析。',
  '禁止：再次输出【商品主体识别】【商用视觉诊断】【平台适配建议】【场景与人群】等长模板；禁止复述历史轮次写过的品类/材质/颜色档案。',
  '用户可能使用快捷按钮，也可能自定义任意长句描述改图要求；你必须把其**本轮文字中的核心改图诉求**提炼进【执行确认】，可适度引用原话关键词。',
  '请用中文，总行数不超过 16 行，严格按：',
  '【执行确认】3-5 行：逐条对齐用户本轮指令（无论长短），说明将如何落实；明确商品主体与款式与参考图一致、禁止换款。',
  '【本轮画面要点】2-5 条：只写与本轮生成直接相关的背景/光线/构图/风格；不写分平台长列表。',
  '【一句话运营提示】1 行即可。',
  '若媒体为视频且确有必要，最多补 2 行「动态卖点」；否则不写视频段。',
  '结尾必须单独一行：系统将基于参考图按你的指令生成新的商品图。',
].join('\n')

type MediaType = 'image' | 'video'

type ChatTurn = { role: 'user' | 'assistant'; text: string }

type IntentJson = {
  blockedVideoEdit?: boolean
  needsAnalysis?: boolean
  needsImageGen?: boolean
  imageCount?: number
}

type GenerateMode = 'preview' | 'final'

type PreviewDraft = {
  userId: string
  mediaType: MediaType
  mediaUrl: string
  /** 出图时传给上游的参考图（可与 mediaUrl 不同，用于链式改图） */
  refImageUrl?: string
  optimizedPrompt: string
  finalPrompt: string
  createdAt: number
  style: string
  aspectRatio: string
  resolution: string
}

type QcResult = {
  score: number
  issues: string[]
}

const imageGenHits = new Map<string, number[]>()
const previewDrafts = new Map<string, PreviewDraft>()

function allowImageGenPerMinute(userId: string): boolean {
  const now = Date.now()
  const arr = (imageGenHits.get(userId) || []).filter((t) => now - t < 60_000)
  if (arr.length >= 5) return false
  arr.push(now)
  imageGenHits.set(userId, arr)
  return true
}

function putPreviewDraft(d: PreviewDraft): string {
  const token = `hprev_${Date.now()}_${Math.random().toString(16).slice(2)}`
  previewDrafts.set(token, d)
  return token
}

function getPreviewDraft(token: string, userId: string): PreviewDraft | null {
  const row = previewDrafts.get(token)
  if (!row) return null
  if (row.userId !== userId) return null
  // 30 分钟有效期
  if (Date.now() - row.createdAt > 30 * 60_000) {
    previewDrafts.delete(token)
    return null
  }
  return row
}

function mustEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function supabaseBaseUrl() {
  return String(mustEnv('SUPABASE_URL')).replace(/\/$/, '')
}

async function writeTaskRow(payload: any) {
  try {
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    await fetch(`${supabaseBaseUrl()}/rest/v1/generation_tasks`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([payload]),
    })
  } catch {
    // ignore
  }
}

async function ensureModelEnabled(modelId: string, type: 'video' | 'image' | 'llm') {
  try {
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    const resp = await fetch(
      `${supabaseBaseUrl()}/rest/v1/model_controls?model_id=eq.${encodeURIComponent(modelId)}&type=eq.${encodeURIComponent(type)}&select=enabled`,
      {
        method: 'GET',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    )
    const text = await resp.text()
    const data = (() => {
      try {
        return text ? JSON.parse(text) : []
      } catch {
        return []
      }
    })()
    const row = Array.isArray(data) ? data[0] : null
    if (row && row.enabled === false) return false
    return true
  } catch {
    return true
  }
}

function isAllowedPublicAssetUrl(urlStr: string, supabaseBaseUrlRaw: string): boolean {
  try {
    const u = new URL(urlStr.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const base = new URL(supabaseBaseUrlRaw)
    if (u.host !== base.host) return false
    return u.pathname.includes('/storage/v1/object/public/assets/')
  } catch {
    return false
  }
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } }

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

function extractAssistantText(data: any): string {
  const c = data?.choices?.[0]?.message?.content
  if (typeof c === 'string') return c.trim()
  if (Array.isArray(c)) {
    const texts = c
      .map((x: any) => (x?.type === 'text' && typeof x?.text === 'string' ? x.text : ''))
      .filter(Boolean)
    return texts.join('\n').trim()
  }
  const t = data?.choices?.[0]?.text ?? data?.output_text ?? data?.data?.output_text
  return typeof t === 'string' ? t.trim() : ''
}

async function gpt4oJson<T>(apiKey: string, baseUrl: string, system: string, user: string): Promise<T> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  const rawText = await resp.text()
  const data = (() => {
    try {
      return rawText ? JSON.parse(rawText) : null
    } catch {
      return null
    }
  })()
  if (!resp.ok) throw new Error((data as any)?.error?.message || (data as any)?.message || `LLM请求失败(${resp.status})`)
  const content = (data as any)?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('LLM响应为空')
  const m = content.match(/\{[\s\S]*\}/)
  return JSON.parse(m?.[0] || content) as T
}

async function gpt4oChat(
  apiKey: string,
  baseUrl: string,
  messages: ChatMessage[],
  temperature = 0.35,
): Promise<string> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o',
      temperature,
      messages,
    }),
  })
  const rawText = await resp.text()
  const data = (() => {
    try {
      return rawText ? JSON.parse(rawText) : null
    } catch {
      return null
    }
  })()
  if (!resp.ok) throw new Error((data as any)?.error?.message || (data as any)?.message || `LLM请求失败(${resp.status})`)
  return extractAssistantText(data)
}

/** OpenAI 兼容流式：尽快把首 token 推到前端 */
async function* streamGpt4oChat(
  apiKey: string,
  baseUrl: string,
  messages: ChatMessage[],
  temperature = 0.35,
): AsyncGenerator<string, void, unknown> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o',
      temperature,
      messages,
      stream: true,
    }),
  })
  if (!resp.ok) {
    const errText = await resp.text()
    let msg = `LLM请求失败(${resp.status})`
    try {
      const j = JSON.parse(errText)
      msg = String((j as any)?.error?.message || (j as any)?.message || msg)
    } catch {
      msg = errText.slice(0, 500) || msg
    }
    throw new Error(msg)
  }
  if (!resp.body) throw new Error('上游未返回流式 body')
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let carry = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    carry += decoder.decode(value, { stream: true })
    let splitAt: number
    while ((splitAt = carry.indexOf('\n\n')) !== -1) {
      const evt = carry.slice(0, splitAt)
      carry = carry.slice(splitAt + 2)
      for (const rawLine of evt.split('\n')) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.replace(/^data:\s?/, '').trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const piece = json?.choices?.[0]?.delta?.content
          if (typeof piece === 'string' && piece) yield piece
        } catch {
          // 单行非 JSON 时忽略
        }
      }
    }
  }
}

function mapResolutionLabel(label: string): string {
  const x = String(label || '').toUpperCase()
  if (x === '4K' || x === '4096') return '4096'
  if (x === 'HD' || x === '高清') return '1024'
  return '2048'
}

function normalizeAspectRatio(input: string): string {
  const x = String(input || '').trim()
  // 首页模块优先电商常用比例；若传入异常则回落到 1:1
  if (x === '1:1' || x === '3:4' || x === '9:16') return x
  if (x === '16:9') return '9:16'
  if (x === '4:3') return '3:4'
  return '1:1'
}

function normalizeAspectRatios(input: unknown): string[] {
  const list = Array.isArray(input) ? input : []
  const out = list
    .map((x) => normalizeAspectRatio(String(x || '')))
    .filter((x, i, arr) => !!x && arr.indexOf(x) === i)
  if (out.length) return out
  return ['1:1', '3:4', '9:16']
}

function styleKeywords(style: string): string {
  const s = String(style || '写实')
  const map: Record<string, string> = {
    写实: 'photorealistic, highly detailed, professional photography lighting',
    动漫: 'anime style, clean lineart, vibrant colors',
    国潮: 'Chinese trendy illustration, guochao aesthetic, bold colors',
    手绘: 'hand-drawn illustration, artistic texture',
    赛博朋克: 'cyberpunk, neon lights, futuristic city mood',
    水墨: 'Chinese ink wash painting style, elegant brush strokes',
  }
  return map[s] || map['写实']!
}

function buildUserMultimodalContent(text: string, mediaType: MediaType, mediaUrl: string, supabaseUrl: string): string | ContentPart[] {
  const t = String(text || '').trim() || '请根据上传的媒体回答我的问题。'
  if (mediaType === 'video') {
    if (!isAllowedPublicAssetUrl(mediaUrl, supabaseUrl)) {
      throw new Error('非法 mediaUrl：仅支持本平台资产库公开地址')
    }
    return [
      { type: 'video_url', video_url: { url: mediaUrl } },
      { type: 'text', text: t },
    ]
  }
  if (!isAllowedPublicAssetUrl(mediaUrl, supabaseUrl)) {
    throw new Error('非法 mediaUrl：仅支持本平台资产库公开地址')
  }
  return [
    { type: 'image_url', image_url: { url: mediaUrl } },
    { type: 'text', text: t },
  ]
}

function historyToMessages(
  history: ChatTurn[],
  currentUserContent: string | ContentPart[],
  supabaseUrl: string,
  analysisCtx?: {
    mediaType: MediaType
    userMessage: string
    newSubjectMediaThisTurn?: boolean
    /** 意图合并后的最终值：同图且为 true 时与历史完整分析并存则走极简要跟进 */
    needsImageGen: boolean
  },
): ChatMessage[] {
  const out: ChatMessage[] = []
  const wantsExecImage = analysisCtx?.needsImageGen === true
  const minimalFollowup =
    !!analysisCtx &&
    !analysisCtx.newSubjectMediaThisTurn &&
    analysisCtx.needsImageGen === true &&
    priorHasFullProductAnalysis(history)
  const formatBlock = minimalFollowup ? ECOM_MINIMAL_EXEC_FOLLOWUP : ECOM_ANALYSIS_FORMAT
  const execBlock = wantsExecImage
    ? minimalFollowup
      ? [
          '【出图指令·跟进轮】同一参考图、会话内已有完整商品分析；本轮无论是快捷按钮还是用户自定义长句，均禁止复述首轮长模板。',
          '禁止：第三方修图软件教程；禁止【商品主体识别】等整段结构。',
          '输出：仅使用下方「极简要跟进格式」，把用户本轮改图要求写进【执行确认】。',
        ].join('\n')
      : [
          '【出图指令已识别】用户本轮要基于参考图生成/修改商品图（含快捷指令：更亮、换场景、白底、信息流等）。',
          '禁止：推荐或提及 Photoshop、Lightroom、Canva、Pixlr、美图秀秀、手机相册、任何第三方修图软件或「自己去软件里调」类教程；不要写分步骤修图指南。',
          '必须：仍按下方「电商结构化格式」输出，但内容服务于即将自动出图：商用诊断只写与当前画面相关的简短要点；用一行收尾：「系统将基于参考图按你的指令生成新的商品图。」',
        ].join('\n')
    : ''
  const sys: ChatMessage = {
    role: 'system',
    content: [
      '你是面向电商商家的商品素材分析助手（首页模块）。',
      '语气要求：自然、简洁、专业，避免冗余。',
      '上下文要求：自动继承历史轮次中的商品主体信息，除非用户明确要求换品，不要反复确认同一主体。',
      '事实要求：仅基于可见信息下结论；不确定就明确写“无法确认”。',
      '任务边界：本阶段只做理解分析与运营建议，不执行视频生成/剪辑指令。',
      execBlock,
      formatBlock,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
  out.push(sys)
  const tail = history.slice(-40)
  for (const m of tail) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: String(m.text || '').trim() || '…' })
    } else {
      out.push({ role: 'user', content: String(m.text || '').trim() || '…' })
    }
  }
  out.push({ role: 'user', content: currentUserContent })
  return out
}

function forkReqWithIdem(req: any, idem: string) {
  const headers = { ...(req?.headers || {}) }
  headers['idempotency-key'] = idem
  headers['Idempotency-Key'] = idem
  return { ...req, headers }
}

function quickActionsFor(mediaType: MediaType): string[] {
  if (mediaType === 'video') {
    return ['提炼3个电商卖点', '按抖音风格总结', '输出可用标题与卖点']
  }
  // 与 nextQuestion 去重：正文不再枚举白底/信息流等，由按钮承担
  return ['换场景', '更亮一点', '改成白底主图', '改成信息流风格']
}

/** 结合上一轮指令与会话是否已出过图，动态排序快捷指令（仅首页） */
function quickActionsDynamic(
  mediaType: MediaType,
  userMessage: string,
  opts?: { hasSessionGenerated?: boolean },
): string[] {
  const base = quickActionsFor(mediaType)
  if (mediaType !== 'video' && opts?.hasSessionGenerated) {
    const core = stripHomeParamLine(userMessage)
    const extras: string[] = []
    if (/白底|纯白|#fff|#ffffff/i.test(core)) {
      extras.push('换场景', '生成同款风格图片')
    } else if (/场景|换场景|换背景/.test(core)) {
      extras.push('改成白底主图', '更亮一点')
    } else {
      extras.push('改成白底主图', '换场景', '生成同款风格图片')
    }
    return [...new Set([...extras, ...base])].slice(0, 8)
  }
  return base
}

async function writeHomeTelemetry(userId: string, payload: Record<string, unknown>) {
  await writeTaskRow({
    user_id: userId,
    type: 'image',
    model: 'home_telemetry',
    status: 'succeeded',
    provider_task_id: null,
    output_url: null,
    raw: { source: 'home_chat', ...payload, at: Date.now() },
  })
}

function normalizeOptionalRefUrl(
  urlStr: string,
  supabaseBase: string,
): string {
  const u = String(urlStr || '').trim()
  if (!u || !isAllowedPublicAssetUrl(u, supabaseBase)) return ''
  return u
}

function pickNanoRefImage(
  mediaType: MediaType,
  mediaUrl: string,
  clientRefUrl: string,
  draftRefUrl: string | undefined,
  supabaseBase: string,
): string | undefined {
  if (mediaType !== 'image') return undefined
  const ordered = [clientRefUrl, draftRefUrl, mediaUrl].map((x) => normalizeOptionalRefUrl(String(x || ''), supabaseBase))
  for (const x of ordered) {
    if (x) return x
  }
  return undefined
}

/** 轻量判断参考图是否像可上架商品主体；失败返回 null 不拦截 */
async function visionSellableProductRef(
  apiKey: string,
  baseUrl: string,
  imageUrl: string,
): Promise<boolean | null> {
  try {
    const multimodal: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You classify e-commerce reference images. Reply with JSON only: {"sellable":true|false}. sellable=true if a clear physical product (or sellable item) is the main subject suitable as a listing main image. sellable=false for landscapes-only, documents/screenshots, memes, portraits with no product, abstract noise.',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: 'sellable for e-commerce main image?' },
        ],
      },
    ]
    const txt = await gpt4oChat(apiKey, baseUrl, multimodal, 0.05)
    const m = txt.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(m?.[0] || '{}')
    if (typeof parsed?.sellable === 'boolean') return parsed.sellable
    return null
  } catch {
    return null
  }
}

function nextQuestionFor(mediaType: MediaType): string {
  if (mediaType === 'video') {
    return '需要拆解脚本、总结风格或上架文案时，可直接点下方快捷指令。'
  }
  return '需要继续生成或微调画面时，可直接点下方快捷指令。'
}

/** 去掉首页 composer 注入的参数行，避免干扰意图判断 */
function stripHomeParamLine(text: string): string {
  return String(text || '')
    .replace(/^【[^】]{1,160}】\s*/u, '')
    .trim()
}

/** 界面快捷指令与强动作词：必须走出图（仅首页模块使用） */
const HOME_FORCE_IMAGE_PHRASES: string[] = [
  '换场景',
  '更亮一点',
  '更亮一些',
  '再亮一点',
  '改成白底主图',
  '改成信息流风格',
  '生成同款风格图片',
  '确认高清生成',
  '换背景',
  '调亮',
  '提亮',
  '生成白底',
  '白底图',
  '白底主图',
]

/**
 * 首页意图兜底：修正模型把「执行出图」误判为纯咨询的问题。
 * 不修改其他模块；与 LLM 意图并存时，执行类优先于 consultOnly。
 */
function inferHomeIntentOverride(
  userMessage: string,
  mediaType: MediaType,
): { needsImageGen?: true; consultOnly?: true } {
  const raw = String(userMessage || '')
  const core = stripHomeParamLine(raw)

  if (
    /仅分析|只要分析|不要生成|不要出图|不生成图|只分析|只要文案|不制图|别生成|无需出图/.test(raw)
  ) {
    return { consultOnly: true }
  }

  for (const p of HOME_FORCE_IMAGE_PHRASES) {
    if (raw.includes(p) || core.includes(p)) return { needsImageGen: true }
  }

  const execRe =
    /(生成|出图|做图|来一张|做一张|来张|做张|张图|改成|换场景|换背景|换一换|更亮|调亮|提亮|白底|主图|信息流|9\s*:\s*16|竖版|制作|去除|去掉|加字|加品牌|加logo|同款|确认高清|高清正式|p图|修图|重绘|加水印|去水印)/i
  if (execRe.test(core) || execRe.test(raw)) return { needsImageGen: true }

  if (mediaType === 'video') {
    const wantStillFromVideo = /(生成|做|出).{0,8}(图|张|画面|海报|主图|同款)/i.test(core)
    if (wantStillFromVideo) return { needsImageGen: true }
  }

  return {}
}

function priorHasFullProductAnalysis(history: ChatTurn[]): boolean {
  return history.some(
    (m) =>
      m.role === 'assistant' &&
      String(m.text || '').includes('【商品主体识别】') &&
      String(m.text || '').includes('【商用视觉诊断】'),
  )
}

/** 快捷指令绑定的出图约束，写入最终 prompt（仅首页出图链路） */
function homeExecutionDirectives(userMessage: string): string {
  const m = String(userMessage || '')
  const parts: string[] = []

  if (m.includes('改成白底主图') || /白底主图|纯\s*白\s*底|#FFFFFF|#fff\b/i.test(m)) {
    parts.push(
      '【执行模板·白底主图】背景必须为纯白#FFFFFF；商品主体居中，约占画面70%-80%；无投影、无杂物、无文字水印；符合国内电商平台主图常见规范；商品款式/颜色/材质/图案必须与参考图一致，禁止换款或变形。',
    )
  }
  if (m.includes('换场景') || m.includes('换背景')) {
    parts.push(
      '【执行模板·换场景】仅替换背景与环境氛围，商品主体、款式、颜色、细节必须与参考图一致，禁止换款、变形或改变商品本体。',
    )
  }
  if (m.includes('更亮一点') || m.includes('调亮') || m.includes('提亮')) {
    parts.push(
      '【执行模板·提亮】适度提升整体曝光与明暗层次，保留材质与色彩准确，商品外形与细节不变。',
    )
  }
  if (m.includes('信息流') || m.includes('改成信息流')) {
    parts.push(
      '【执行模板·信息流】信息流广告风格，主体突出、画面干净；禁止虚假夸大文案与违规元素；商品外观真实一致。',
    )
  }
  if (m.includes('生成同款风格图片') || (m.includes('同款') && /风格|样式/.test(m))) {
    parts.push(
      '【执行模板·同款风格】在保持商品主体与参考图一致的前提下，统一整体色调与质感，使新图与原商品视觉风格协调。',
    )
  }

  return parts.filter(Boolean).join('\n')
}

async function runNanoBananaGeneration(params: {
  req: any
  idempotencyKey: string
  apiKey: string
  baseUrl: string
  userId: string
  prompt: string
  negative: string
  aspectRatio: string
  resolution: string
  refImage?: string
  imageCount: number
  model: string
}) {
  const reqBill = forkReqWithIdem(params.req, params.idempotencyKey)
  const billableConfirmed = String(reqBill.headers?.['x-confirm-billable'] || '').toLowerCase() === 'true'
  if (!billableConfirmed) throw new Error('已拦截：缺少 X-Confirm-Billable: true（防止误触发计费）')

  const consumed = await checkAndConsume(reqBill, { type: 'image' })
  if (consumed.already) {
    const r = consumed.result as any
    return { imageUrl: r?.imageUrl as string, size: r?.size as string | undefined, cached: true as const }
  }

  const aspect = String(params.aspectRatio || '1:1')
  const resStr = String(params.resolution || '2048')
  const base = Number.parseInt(resStr, 10)
  const safeBase = Number.isFinite(base) && base > 0 ? base : 1024
  const roundTo = (n: number, m: number) => {
    const v = Math.round(n / m) * m
    return Math.max(m, v)
  }
  const computeSize = () => {
    const [wRatio, hRatio] = aspect.split(':').map((x) => Number.parseFloat(x))
    if (!Number.isFinite(wRatio) || !Number.isFinite(hRatio) || wRatio <= 0 || hRatio <= 0) return `${safeBase}x${safeBase}`
    const isLandscape = wRatio >= hRatio
    const longSide = safeBase
    const shortSide = (safeBase * Math.min(wRatio, hRatio)) / Math.max(wRatio, hRatio)
    const w = isLandscape ? longSide : shortSide
    const h = isLandscape ? shortSide : longSide
    const ww = roundTo(w, 64)
    const hh = roundTo(h, 64)
    return `${ww}x${hh}`
  }
  const reqSize = computeSize()
  const [reqW, reqH] = reqSize.split('x').map((x) => Number.parseInt(x, 10))

  const modelId = String(params.model || '').toLowerCase()
  const modelFamily = modelId.includes('nano-banana') ? 'nano-banana' : 'other'
  const refFields = (() => {
    if (!params.refImage) return {}
    const refImage = params.refImage
    const base = {
      image: refImage,
      input_image: refImage,
      reference_image: refImage,
      image_url: refImage,
      input_image_url: refImage,
      reference_image_url: refImage,
    }
    if (modelFamily === 'flux') return { ...base, image: refImage, input_image: refImage }
    if (modelFamily === 'seedream') return { ...base, reference_image: refImage }
    return base
  })()

  const neg = String(params.negative || '').trim()
  const negativeFields = {
    negative_prompt: neg || undefined,
    negativePrompt: neg || undefined,
    negative: neg || undefined,
  }
  const sizeFields = {
    size: reqSize,
    width: Number.isFinite(reqW) ? reqW : undefined,
    height: Number.isFinite(reqH) ? reqH : undefined,
  }

  const n = Math.max(1, Math.min(4, Math.floor(params.imageCount || 1)))

  const usedModel = String(params.model || 'nano-banana-2').trim()
  if (usedModel) {
    const enabled = await ensureModelEnabled(usedModel, 'image')
    if (!enabled) {
      await writeTaskRow({
        user_id: params.userId,
        type: 'image',
        model: usedModel,
        status: 'failed',
        provider_task_id: null,
        output_url: null,
        raw: { reason: 'model disabled by admin', from: 'home_chat' },
      })
      throw new Error(`模型 ${usedModel} 已被后台禁用`)
    }
  }

  const resp = await fetch(`${params.baseUrl.replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: params.prompt,
      ...negativeFields,
      model: usedModel || undefined,
      n,
      count: n,
      num_images: n,
      ...sizeFields,
      ...refFields,
    }),
  })
  const raw = await resp.text()
  const data = (() => {
    try {
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })()

  if (!resp.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      (typeof raw === 'string' && raw.slice(0, 1000)) ||
      `上游错误(${resp.status})`
    await writeTaskRow({
      user_id: params.userId,
      type: 'image',
      model: usedModel,
      status: 'failed',
      provider_task_id: null,
      output_url: null,
      raw: { upstream_status: resp.status, upstream: data || raw, from: 'home_chat' },
    })
    throw new Error(String(msg))
  }

  const pick = (v: any) => (typeof v === 'string' ? v : '')
  const first = Array.isArray(data?.data) ? data.data[0] : null
  const url = pick(first?.url) || pick(data?.output) || pick(data?.result?.url)
  const b64 = pick(first?.b64_json) || pick(data?.b64_json) || pick(data?.image_base64)

  if (b64) {
    const result = { imageUrl: `data:image/png;base64,${b64}`, size: reqSize }
    await writeTaskRow({
      user_id: params.userId,
      type: 'image',
      model: usedModel,
      status: 'succeeded',
      provider_task_id: null,
      output_url: result.imageUrl,
      raw: { ...data, from: 'home_chat' },
    })
    await finalizeConsumption(reqBill, result)
    return { ...result, cached: false as const }
  }
  if (url) {
    const result = { imageUrl: url, size: reqSize }
    await writeTaskRow({
      user_id: params.userId,
      type: 'image',
      model: usedModel,
      status: 'succeeded',
      provider_task_id: null,
      output_url: result.imageUrl,
      raw: { ...data, from: 'home_chat' },
    })
    await finalizeConsumption(reqBill, result)
    return { ...result, cached: false as const }
  }

  await writeTaskRow({
    user_id: params.userId,
    type: 'image',
    model: usedModel,
    status: 'failed',
    provider_task_id: null,
    output_url: null,
    raw: data || raw,
  })
  throw new Error('上游未返回可识别的图片地址（url/b64_json）')
}

async function buildOpsPack(
  apiKey: string,
  baseUrl: string,
  analysisText: string,
  userMessage: string,
): Promise<{ titles: string[]; sellingPoints: string[]; detailLead: string }> {
  try {
    const j = await gpt4oJson<{
      titles?: string[]
      sellingPoints?: string[]
      detailLead?: string
    }>(
      apiKey,
      baseUrl,
      [
        '你是电商文案助手。请基于分析内容输出可直接使用的文案 JSON。',
        '输出 JSON 字段：titles(3条)、sellingPoints(5条)、detailLead(1段)。',
        '要求：简洁、可商用、避免夸张违规词。',
      ].join('\n'),
      JSON.stringify({ analysisText: analysisText.slice(0, 2200), userMessage: userMessage.slice(0, 800) }),
    )
    const titles = (Array.isArray(j.titles) ? j.titles : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .slice(0, 3)
    const sellingPoints = (Array.isArray(j.sellingPoints) ? j.sellingPoints : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .slice(0, 5)
    const detailLead = String(j.detailLead || '').trim()
    if (titles.length && sellingPoints.length && detailLead) {
      return { titles, sellingPoints, detailLead }
    }
  } catch {
    // fallback below
  }
  return {
    titles: ['高质感主图，突出产品细节', '场景化展示，提升点击兴趣', '电商可用素材，一图多平台适配'],
    sellingPoints: [
      '主体识别清晰，突出核心卖点',
      '构图简洁，利于移动端快速理解',
      '风格统一，适配主流电商平台',
      '材质质感表达明确，减少决策成本',
      '可直接用于上架与投放素材',
    ],
    detailLead:
      '这款商品在视觉上具备明确主体与可提炼卖点，建议优先使用高识别度主图与场景图组合，强化点击吸引与转化效率。',
  }
}

async function runLightQc(
  apiKey: string,
  baseUrl: string,
  imageUrl: string,
): Promise<QcResult> {
  try {
    const multimodal: ChatMessage[] = [
      {
        role: 'system',
        content: '你是电商图片质检助手。请返回 JSON：{"score":0-100,"issues":["..."]}。关注主体完整性、清晰度、背景杂乱、文字污染。',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: '请做轻量质检评分并列出问题。' },
        ],
      },
    ]
    const txt = await gpt4oChat(apiKey, baseUrl, multimodal, 0.1)
    const m = txt.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(m?.[0] || '{}')
    const score = Math.max(0, Math.min(100, Math.floor(Number(parsed?.score) || 0)))
    const issues = Array.isArray(parsed?.issues)
      ? parsed.issues.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 6)
      : []
    return { score: score || 80, issues }
  } catch {
    return { score: 80, issues: [] }
  }
}

type ParsedHomeParams = {
  aspectRatio: string
  resolution: string
  style: string
  refWeight: number
  optimizePrompt: boolean
  hdEnhance: boolean
  useNeg: boolean
  subjectLock: 'high' | 'medium'
  multiRatio: boolean
  ratioList: string[]
  abVariant: boolean
  qcEnabled: boolean
  imageCount: number
}

function parseHomeParams(params: any, intentImageCount?: number): ParsedHomeParams {
  const aspectRatio = normalizeAspectRatio(String(params.aspectRatio || '1:1'))
  const resolution = mapResolutionLabel(String(params.resolution || '2K'))
  const style = String(params.style || '写实')
  const refWeight = Number.isFinite(Number(params.refWeight)) ? Number(params.refWeight) : 0.7
  const optimizePrompt = params.optimizePrompt !== false
  const hdEnhance = params.hdEnhance !== false
  const useNeg = params.negativePrompt !== false
  const subjectLock = String(params.subjectLock || 'high').toLowerCase() === 'medium' ? 'medium' : 'high'
  const multiRatio = params.multiRatio === true
  const ratioList = multiRatio ? normalizeAspectRatios(params.targetRatios) : [aspectRatio]
  const abVariant = params.abVariant === true
  const qcEnabled = params.qcEnabled !== false
  const imageCount = Math.max(
    1,
    Math.min(4, Math.floor(Number(params.imageCount) || Math.floor(Number(intentImageCount ?? 1)))),
  )
  return {
    aspectRatio,
    resolution,
    style,
    refWeight,
    optimizePrompt,
    hdEnhance,
    useNeg,
    subjectLock,
    multiRatio,
    ratioList,
    abVariant,
    qcEnabled,
    imageCount,
  }
}

type ImageGenCtx = {
  req: any
  res: any
  startedAt: number
  userId: string
  apiKey: string
  baseUrl: string
  supabaseUrl: string
  mediaType: MediaType
  mediaUrl: string
  /** 链式改图：上一张成品图作为参考（须为同域公开资产 URL） */
  refImageUrl?: string
  /** 会话内商品分析摘要，供第二轮优化提示词 */
  contextSummary?: string
  locale?: string
  hasSessionGenerated?: boolean
  sessionId?: string
  userMessage: string
  analysisText: string
  generateMode: GenerateMode
  previewToken: string
} & ParsedHomeParams

async function runImageGenerationAfterAnalysis(ctx: ImageGenCtx): Promise<void> {
  const {
    req,
    res,
    startedAt,
    userId,
    apiKey,
    baseUrl,
    supabaseUrl,
    mediaType,
    mediaUrl,
    refImageUrl: refImageUrlRaw,
    contextSummary,
    locale,
    hasSessionGenerated,
    sessionId,
    userMessage,
    analysisText,
    generateMode,
    previewToken,
    aspectRatio,
    resolution,
    style,
    refWeight,
    optimizePrompt,
    hdEnhance,
    useNeg,
    subjectLock,
    multiRatio,
    ratioList,
    abVariant,
    qcEnabled,
    imageCount,
  } = ctx

  if (!allowImageGenPerMinute(userId)) {
    res.status(200).json({ success: false, error: RATE_ERR, code: 'RATE_LIMITED' })
    return
  }

  const clientRef = normalizeOptionalRefUrl(String(refImageUrlRaw || ''), supabaseUrl)
  const draftEarly = previewToken ? getPreviewDraft(previewToken, userId) : null
  const nanoRefEarly = pickNanoRefImage(mediaType, mediaUrl, clientRef, draftEarly?.refImageUrl, supabaseUrl)
  if (nanoRefEarly) {
    const ok = await visionSellableProductRef(apiKey, baseUrl, nanoRefEarly)
    if (ok === false) {
      res.status(200).json({
        success: false,
        code: 'NOT_PRODUCT_IMAGE',
        error:
          '参考图不太像可上架的商品主体（如风景、文档、人像等）。请上传清晰的商品图后再试，或先使用「仅分析」获取建议。',
      })
      return
    }
  }

  let optimizedPrompt = userMessage
  let finalPrompt = userMessage
  const localeStr = String(locale || '').trim()
  const localeEn = /^en\b/i.test(localeStr)

  if (optimizePrompt) {
    try {
      const execDir = homeExecutionDirectives(userMessage)
      const op = await gpt4oJson<{ optimized?: string }>(apiKey, baseUrl, [
        '你是电商图片生成提示词工程师，将用户需求改写为适配 nano-banana-2 的高质量提示词。',
        '核心原则：严格保留商品主体结构/颜色/比例，不变形、不换款；仅按用户意图做局部修改。',
        '若用户是“换场景/更亮一点/突出质感/改白底主图”等微调意图，只改指定部分，不重做无关元素。',
        '若输入中含 executionDirectives 非空，必须完整并入 optimized，不得忽略。',
        '这是执行类出图任务：禁止只输出拍摄/修图教程文字，提示词必须能直接用于生成成品图。',
        '优先商业可用图：白底主图、场景图、氛围种草图、信息流图；画面干净高级、无多余文字、无侵权元素。',
        `比例优先使用 ${aspectRatio}（已做平台适配，常用 1:1 / 3:4 / 9:16）。`,
        localeEn
          ? 'User locale is English: put English visual keywords first, keep necessary Chinese only if user wrote Chinese.'
          : '输出要包含中文描述 + 必要英文视觉关键词，便于模型稳定出图。',
        '输出 JSON：{"optimized":"..."}',
      ].join('\n'),
        JSON.stringify({
          baseAnalysis: analysisText.slice(0, 2000),
          sessionProductSummary: String(contextSummary || '').slice(0, 1200) || undefined,
          userMessage,
          executionDirectives: execDir || undefined,
          style: styleKeywords(style),
          aspectRatio,
          refWeight,
        }),
      )
      optimizedPrompt = String(op?.optimized || userMessage).trim() || userMessage
    } catch {
      optimizedPrompt = userMessage
    }
  }

  const negBase = useNeg ? DEFAULT_NEG : ''
  const preserveLine =
    subjectLock === 'high'
      ? '严格锁定商品主体结构、颜色与比例，仅对背景与光影做改动，不可换款/变形'
      : '尽量保持商品主体结构、颜色与比例，允许轻微构图变化'

  const execBlock = homeExecutionDirectives(userMessage)
  const extra = [
    styleKeywords(style),
    `画幅比例 ${aspectRatio}`,
    hdEnhance ? 'high detail, sharp focus, clean texture' : '',
    'ecommerce product photography, preserve product geometry and color fidelity',
    'clean premium background, no extra text, no watermark, no irrelevant objects',
    preserveLine,
    `参考图权重约 ${refWeight.toFixed(2)}（请在构图中体现参考关系）`,
    execBlock,
    COMPLIANCE_TAIL,
  ]
    .filter(Boolean)
    .join('；')

  finalPrompt = [optimizedPrompt, extra].join('\n\n')

  const nanoRefPreview = pickNanoRefImage(mediaType, mediaUrl, clientRef, undefined, supabaseUrl)

  if (generateMode === 'preview') {
    const previewId = putPreviewDraft({
      userId,
      mediaType,
      mediaUrl,
      refImageUrl: nanoRefPreview,
      optimizedPrompt,
      finalPrompt,
      createdAt: Date.now(),
      style,
      aspectRatio,
      resolution,
    })
    const idem = `home-preview-${Date.now()}_${Math.random().toString(16).slice(2)}`
    const prev = await runNanoBananaGeneration({
      req,
      idempotencyKey: idem,
      apiKey,
      baseUrl,
      userId,
      prompt: `${finalPrompt}\n（预览图，仅用于确认方向）`,
      negative: useNeg ? DEFAULT_NEG : '',
      aspectRatio,
      resolution,
      refImage: nanoRefPreview,
      imageCount: 1,
      model: 'nano-banana-2',
    })
    const previewImage = { url: prev.imageUrl, ratio: aspectRatio, variant: 'preview', qcScore: 80, qcIssues: [] as string[] }
    void writeHomeTelemetry(userId, {
      event: 'home_image_gen_ok',
      mode: 'preview',
      sessionId: sessionId || undefined,
      hasSessionGenerated: !!hasSessionGenerated,
    })
    res.status(200).json({
      success: true,
      kind: 'mixed',
      analysisText: analysisText || undefined,
      optimizedPrompt,
      imageUrls: [prev.imageUrl],
      images: [previewImage],
      previewToken: previewId,
      nextQuestion: '预览方向已生成，是否按该方向生成高清正式图？',
      quickActions: quickActionsDynamic(mediaType, userMessage, { hasSessionGenerated }),
      opsPack: undefined,
      meta: { aspectRatio, resolution, style, refWeight, imageCount: 1, mode: 'preview' },
    })
    return
  }

  const draft = previewToken ? getPreviewDraft(previewToken, userId) : null
  const finalPromptToUse = draft?.finalPrompt || finalPrompt
  const mediaTypeToUse = draft?.mediaType || mediaType
  const mediaUrlToUse = draft?.mediaUrl || mediaUrl
  const styleToUse = draft?.style || style
  const resolutionToUse = draft?.resolution || resolution
  const nanoRefFinal = pickNanoRefImage(mediaTypeToUse, mediaUrlToUse, clientRef, draft?.refImageUrl, supabaseUrl)

  const ratioListSafe = ratioList.slice(0, 2)
  const variants = abVariant ? (['conservative', 'aggressive'] as const) : (['normal'] as const)
  const variantsSafe = variants.slice(0, 2)
  const imageCountSafe = Math.max(1, Math.min(imageCount, 2))
  const maxJobs = 4
  const images: Array<{ url: string; ratio: string; variant: string; qcScore: number; qcIssues: string[] }> = []
  const baseIdem = String(req.headers?.['idempotency-key'] || req.headers?.['Idempotency-Key'] || '').trim() || `home-${Date.now()}`
  for (const ratio of ratioListSafe) {
    for (const variant of variantsSafe) {
      for (let i = 0; i < imageCountSafe; i++) {
        if (images.length >= maxJobs) break
        if (Date.now() - startedAt > 18_000) {
          break
        }
        const idem = `${baseIdem}:homeimg:${ratio}:${variant}:${i}:${Date.now()}_${Math.random().toString(16).slice(2)}`
        const variantHint =
          variant === 'conservative'
            ? '保守商业版：更稳健、主图可用性优先'
            : variant === 'aggressive'
              ? '增强吸引版：氛围更强、视觉冲击更高'
              : '标准商业版'
        const r = await runNanoBananaGeneration({
          req,
          idempotencyKey: idem,
          apiKey,
          baseUrl,
          userId,
          prompt:
            i === 0
              ? `${finalPromptToUse}\n${variantHint}\n输出比例 ${ratio}`
              : `${finalPromptToUse}\n${variantHint}\n输出比例 ${ratio}\n（变体 ${i + 1}/${imageCount}，保持同一风格与主体）`,
          negative: negBase,
          aspectRatio: ratio,
          resolution: resolutionToUse,
          refImage: nanoRefFinal,
          imageCount: 1,
          model: 'nano-banana-2',
        })
        let qc: QcResult = { score: 80, issues: [] }
        if (qcEnabled && images.length < 1 && Date.now() - startedAt < 16_000) {
          qc = await runLightQc(apiKey, baseUrl, r.imageUrl)
        }
        images.push({
          url: r.imageUrl,
          ratio,
          variant,
          qcScore: qc.score,
          qcIssues: qc.issues,
        })
      }
    }
  }

  void writeHomeTelemetry(userId, {
    event: 'home_image_gen_ok',
    mode: 'final',
    sessionId: sessionId || undefined,
    imageCount: images.length,
    hasSessionGenerated: !!hasSessionGenerated,
  })

  res.status(200).json({
    success: true,
    kind: 'mixed',
    analysisText: analysisText || undefined,
    optimizedPrompt: draft?.optimizedPrompt || optimizedPrompt,
    imageUrls: images.map((x) => x.url),
    images,
    nextQuestion: nextQuestionFor(mediaTypeToUse),
    quickActions: quickActionsDynamic(mediaTypeToUse, userMessage, { hasSessionGenerated }),
    opsPack: undefined,
    meta: {
      aspectRatio: ratioList.length === 1 ? ratioList[0] : ratioList,
      resolution: resolutionToUse,
      style: styleToUse,
      refWeight,
      imageCount: imageCountSafe,
      mode: 'final',
      subjectLock,
      multiRatio: multiRatio && ratioListSafe.length > 1,
      abVariant: abVariant && variantsSafe.length > 1,
    },
  })
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const startedAt = Date.now()
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const supabaseUrl = process.env.SUPABASE_URL || ''

    const { user } = await requireUser(req)
    const userId = user.id || user.sub

    const body = req.body || {}

    if (body.homeTelemetryOnly === true) {
      const ht = body.homeTelemetry
      if (!ht || typeof ht !== 'object') {
        return res.status(200).json({ success: false, error: '缺少 homeTelemetry', code: 'BAD_REQUEST' })
      }
      await writeHomeTelemetry(userId, ht as Record<string, unknown>)
      return res.status(200).json({ success: true })
    }

    const mediaType = String(body.mediaType || '') as MediaType
    const mediaUrl = String(body.mediaUrl || '').trim()
    const userMessage = String(body.userMessage || '')
      .trim()
      .normalize('NFC')
    const history = (Array.isArray(body.history) ? body.history : []) as ChatTurn[]
    const params = body.params || {}
    const generateMode = String(body.generateMode || params.generateMode || 'final') as GenerateMode
    const previewToken = String(body.previewToken || params.previewToken || '').trim()
    const refImageUrlIn = String(body.refImageUrl || '').trim()
    const contextSummary = String(body.contextSummary || '').trim().slice(0, 2500)
    const localeRaw =
      String(body.locale || '').trim() ||
      String(req.headers?.['accept-language'] || '')
        .split(',')[0]
        ?.trim() ||
      ''
    const hasSessionGenerated = body.hasSessionGenerated === true
    const sessionId = String(body.sessionId || '').trim().slice(0, 120)
    const newSubjectMediaThisTurn = body.newSubjectMediaThisTurn === true

    if (mediaType !== 'image' && mediaType !== 'video') {
      return res.status(200).json({ success: false, error: 'mediaType 无效', code: 'BAD_REQUEST' })
    }
    if (!mediaUrl || !isAllowedPublicAssetUrl(mediaUrl, supabaseUrl)) {
      return res.status(200).json({ success: false, error: '请先上传有效媒体到资产库后再发送', code: 'BAD_MEDIA' })
    }
    if (!userMessage) {
      return res.status(200).json({ success: false, error: '请输入有效内容', code: 'BAD_REQUEST' })
    }

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        kind: 'mock',
        analysisText:
          '【演示模式】未配置 XIAO_DOU_BAO_API_KEY。正式环境将使用 GPT-4o 理解媒体，并在需要时使用 nano-banana-2 出图。\n\n你的问题：' +
          userMessage.slice(0, 400),
        _mock: true,
      })
    }

    const generateOnly = body.generateOnly === true
    if (generateOnly) {
      const analysisTextOnly = String(body.analysisText || '').trim()
      if (!analysisTextOnly) {
        return res.status(200).json({ success: false, error: '缺少 analysisText', code: 'BAD_REQUEST' })
      }
      const parsedGen = parseHomeParams(params)
      await runImageGenerationAfterAnalysis({
        req,
        res,
        startedAt,
        userId,
        apiKey,
        baseUrl,
        supabaseUrl,
        mediaType,
        mediaUrl,
        refImageUrl: refImageUrlIn,
        contextSummary,
        locale: localeRaw,
        hasSessionGenerated,
        sessionId,
        userMessage,
        analysisText: analysisTextOnly,
        generateMode,
        previewToken,
        ...parsedGen,
      })
      return
    }

    // --- 意图识别（快速 JSON）---
    const intentSystem = [
      '你是首页「电商商品图」模块的意图分类器。根据用户上传媒体与用户问题输出 JSON。',
      '字段：blockedVideoEdit(boolean), needsAnalysis(boolean), needsImageGen(boolean), imageCount(number 1-4)。',
      'blockedVideoEdit=true：用户主要诉求是「生成视频、剪辑视频、拼接、转场、加字幕导出成片、改视频画面、视频特效合成」等视频生成/编辑类动作。',
      'blockedVideoEdit=false：纯分析、或「根据视频/参考生成商品图、改图、换背景」等允许组合。',
      '【执行类·必须 needsImageGen=true】用户要产出图片/修改图片，包括：界面快捷指令（换场景、更亮一点、改成白底主图、改成信息流风格、生成同款风格等）、以及含「生成、出图、做图、改成、换、加、修改、制作、去除、白底、主图、同款、确认高清」等动作且目标是得到新图的诉求。',
      '【咨询类·needsImageGen=false】用户只要方法说明/教程/技巧，明确不要求出图，例如仅问「怎么拍、如何布光、为什么模糊」且无任何出图动作词。',
      '若执行类与咨询类同时出现，以执行类为准（必须先满足出图）。',
      '视频：若用户要从视频生成静态商品图、海报、同款画面，needsImageGen=true。',
      '若仅分析视频脚本/镜头/台词/节奏且不要图，needsAnalysis=true，needsImageGen=false。',
      'imageCount：按用户要求取 1-4，未说明则 1-2。',
      mediaType === 'video'
        ? '当前媒体为视频：禁止满足任何视频生成/剪辑成片类诉求（blockedVideoEdit）；但允许基于视频出静态商品图。'
        : '当前媒体为图片：允许分析、出图、修图、换背景、白底主图等（不涉及视频剪辑）。',
    ].join('\n')

    const intentUser = JSON.stringify({
      mediaType,
      userMessage,
      recentTurns: history.slice(-6),
    })

    let intent: IntentJson
    try {
      intent = await gpt4oJson<IntentJson>(apiKey, baseUrl, intentSystem, intentUser)
    } catch (e: any) {
      return res.status(200).json({ success: false, error: e?.message || '意图识别失败', code: 'INTENT_FAILED' })
    }

    if (intent.blockedVideoEdit) {
      return res.status(200).json({
        success: true,
        kind: 'blocked',
        message: BLOCKED_VIDEO_EDIT_MSG,
      })
    }

    let needsAnalysis = intent.needsAnalysis !== false
    let needsImageGen = !!intent.needsImageGen
    const splitPipeline = body.splitPipeline === true

    const homeIo = inferHomeIntentOverride(userMessage, mediaType)
    if (homeIo.needsImageGen) needsImageGen = true
    else if (homeIo.consultOnly) needsImageGen = false

    // 双保险：快捷词在部分模型/字符集下未命中 exec 正则时仍强制出图
    if (!homeIo.consultOnly) {
      const coreForce = stripHomeParamLine(userMessage).trim()
      if (HOME_FORCE_IMAGE_PHRASES.some((p) => userMessage.includes(p) || coreForce === p)) {
        needsImageGen = true
      }
    }

    // 首页要求：用户上传媒体后默认先做结构化商用分析；生成诉求可与分析并行返回
    needsAnalysis = true
    if (!needsAnalysis && !needsImageGen) needsAnalysis = true

    const parsed = parseHomeParams(params, intent.imageCount)

    let analysisText = ''
    let opsPack: { titles: string[]; sellingPoints: string[]; detailLead: string } | undefined
    const streamAnalysis = body.streamAnalysis === true
    /** 单次请求内同时出图（非 split）仍走整包 JSON，避免与出图响应混流 */
    const useStreamForAnalysis = streamAnalysis && !(needsImageGen && !splitPipeline)

    if (needsAnalysis) {
      if (useStreamForAnalysis) {
        try {
          const multimodal = buildUserMultimodalContent(userMessage, mediaType, mediaUrl, supabaseUrl)
          const messages = historyToMessages(history, multimodal, supabaseUrl, {
            mediaType,
            userMessage,
            newSubjectMediaThisTurn,
            needsImageGen,
          })

          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache, no-transform')
          res.setHeader('Connection', 'keep-alive')
          res.setHeader('X-Accel-Buffering', 'no')

          analysisText = ''
          for await (const piece of streamGpt4oChat(apiKey, baseUrl, messages, 0.35)) {
            analysisText += piece
            res.write(`data: ${JSON.stringify({ type: 'delta', text: piece })}\n\n`)
          }

          // 已要走分支出图时，opsPack 易把「修图教程」包装成标题卖点，干扰用户；仅纯分析轮再生成 opsPack
          if (!needsImageGen) {
            opsPack = await buildOpsPack(apiKey, baseUrl, analysisText, userMessage)
            res.write(`data: ${JSON.stringify({ type: 'ops', opsPack })}\n\n`)
          }

          if (splitPipeline && needsImageGen) {
            res.write(
              `data: ${JSON.stringify({
                type: 'done',
                success: true,
                kind: 'analysis',
                analysisText,
                opsPack,
                nextQuestion: nextQuestionFor(mediaType),
                quickActions: quickActionsDynamic(mediaType, userMessage, { hasSessionGenerated }),
                deferredImageGen: true,
              })}\n\n`,
            )
            res.end()
            return
          }

          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              success: true,
              kind: 'analysis',
              analysisText,
              opsPack,
              nextQuestion: nextQuestionFor(mediaType),
              quickActions: quickActionsDynamic(mediaType, userMessage, { hasSessionGenerated }),
              deferredImageGen: false,
            })}\n\n`,
          )
          res.end()
          return
        } catch (e: any) {
          if (res.headersSent) {
            res.write(
              `data: ${JSON.stringify({
                type: 'error',
                error: String(e?.message || '分析失败'),
                code: 'ANALYSIS_FAILED',
              })}\n\n`,
            )
            res.end()
            return
          }
          return res.status(200).json({ success: false, error: e?.message || '分析失败', code: 'ANALYSIS_FAILED' })
        }
      }

      try {
        const multimodal = buildUserMultimodalContent(userMessage, mediaType, mediaUrl, supabaseUrl)
        const messages = historyToMessages(history, multimodal, supabaseUrl, {
          mediaType,
          userMessage,
          newSubjectMediaThisTurn,
          needsImageGen,
        })
        analysisText = await gpt4oChat(apiKey, baseUrl, messages, 0.35)
        if (!needsImageGen) {
          opsPack = await buildOpsPack(apiKey, baseUrl, analysisText, userMessage)
        }
      } catch (e: any) {
        return res.status(200).json({ success: false, error: e?.message || '分析失败', code: 'ANALYSIS_FAILED' })
      }
    }

    // 分两段：先返回分析，再由前端单独请求出图，缩短首包等待
    if (splitPipeline && needsImageGen) {
      return res.status(200).json({
        success: true,
        kind: 'analysis',
        analysisText,
        opsPack,
        nextQuestion: nextQuestionFor(mediaType),
        quickActions: quickActionsDynamic(mediaType, userMessage, { hasSessionGenerated }),
        deferredImageGen: true,
      })
    }

    if (needsImageGen) {
      await runImageGenerationAfterAnalysis({
        req,
        res,
        startedAt,
        userId,
        apiKey,
        baseUrl,
        supabaseUrl,
        mediaType,
        mediaUrl,
        refImageUrl: refImageUrlIn,
        contextSummary,
        locale: localeRaw,
        hasSessionGenerated,
        sessionId,
        userMessage,
        analysisText,
        generateMode,
        previewToken,
        ...parsed,
      })
      return
    }

    return res.status(200).json({
      success: true,
      kind: 'analysis',
      analysisText,
      nextQuestion: nextQuestionFor(mediaType),
      quickActions: quickActionsDynamic(mediaType, userMessage, { hasSessionGenerated }),
      opsPack,
    })
  } catch (e: any) {
    const rawMsg = String(e?.message || 'Unknown error')
    let msg = rawMsg
    let code = 'UNKNOWN'
    const t = rawMsg.toLowerCase()
    if (t.includes('请先完成本产品内') || t.includes('付费订单')) {
      code = 'PAYMENT_REQUIRED'
      msg = '当前套餐暂不支持继续生成，请先开通或升级后重试。'
    } else if (t.includes('今日额度已用尽') || t.includes('upgrade') || t.includes('quota')) {
      code = 'QUOTA_EXHAUSTED'
      msg = '今日额度已用尽，建议升级套餐或明日再试。'
    } else if (rawMsg.includes(RATE_ERR)) {
      code = 'RATE_LIMITED'
      msg = '操作过于频繁，请等待 10-20 秒后重试；可先减少同时生成张数。'
    } else if (t.includes('非法 mediaurl') || t.includes('bad_media')) {
      code = 'BAD_MEDIA'
      msg = '素材地址无效，请重新上传到资产库后再发起分析或生成。'
    } else if (
      t.includes('function_invocation_timeout') ||
      t.includes('timeout') ||
      t.includes('timed out')
    ) {
      code = 'UPSTREAM_TIMEOUT'
      msg = '请求超时，请先用 1 张预览图确认方向，或关闭多比例/A-B 后重试。'
    } else if (t.includes('上游') || t.includes('llm请求失败') || t.includes('analysis_failed')) {
      code = 'UPSTREAM_FAILED'
      msg = '模型服务暂时繁忙，请稍后重试；如多次失败，建议简化需求后再提交。'
    }
    return res.status(200).json({ success: false, error: msg, code })
  }
}
