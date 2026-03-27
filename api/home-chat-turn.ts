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
): ChatMessage[] {
  const out: ChatMessage[] = []
  const sys: ChatMessage = {
    role: 'system',
    content: [
      '你是面向电商商家的商品素材分析助手（首页模块）。',
      '语气要求：自然、简洁、专业，避免冗余。',
      '上下文要求：自动继承历史轮次中的商品主体信息，除非用户明确要求换品，不要反复确认同一主体。',
      '事实要求：仅基于可见信息下结论；不确定就明确写“无法确认”。',
      '任务边界：本阶段只做理解分析与运营建议，不执行视频生成/剪辑指令。',
      ECOM_ANALYSIS_FORMAT,
    ].join('\n\n'),
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
    return ['提炼3个电商卖点', '按抖音风格总结', '输出可用标题与卖点', '提取关键帧亮点']
  }
  return ['换场景', '更亮一点', '突出质感', '改成白底主图', '改成信息流风格', '改成9:16竖版']
}

function nextQuestionFor(mediaType: MediaType): string {
  if (mediaType === 'video') {
    return '你希望我优先给你「关键帧拆解」还是「可直接上架的标题+卖点文案」？'
  }
  return '下一步你想优先要哪类图：白底主图、场景图，还是信息流风格图？'
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const supabaseUrl = process.env.SUPABASE_URL || ''

    const { user } = await requireUser(req)
    const userId = user.id || user.sub

    const body = req.body || {}
    const mediaType = String(body.mediaType || '') as MediaType
    const mediaUrl = String(body.mediaUrl || '').trim()
    const userMessage = String(body.userMessage || '').trim()
    const history = (Array.isArray(body.history) ? body.history : []) as ChatTurn[]
    const params = body.params || {}
    const generateMode = String(body.generateMode || params.generateMode || 'final') as GenerateMode
    const previewToken = String(body.previewToken || params.previewToken || '').trim()

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

    // --- 意图识别（快速 JSON）---
    const intentSystem = [
      '你是意图分类器。根据用户上传媒体类型与用户问题，输出 JSON。',
      '字段：blockedVideoEdit(boolean), needsAnalysis(boolean), needsImageGen(boolean), imageCount(number 1-4)。',
      'blockedVideoEdit=true：当用户主要诉求是「生成视频、剪辑视频、拼接、转场、加字幕导出成片、改视频画面、视频特效合成」等视频生成/编辑类动作。',
      'blockedVideoEdit=false：纯分析类、或「根据视频风格生成若干张图片」等允许的组合。',
      '若仅想分析视频脚本/镜头/台词/节奏，needsAnalysis=true，needsImageGen=false。',
      '若需要出图（文生图/参考图二创），needsImageGen=true；并结合用户要求设置 imageCount。',
      mediaType === 'video'
        ? '当前媒体为视频：禁止满足任何视频生成/剪辑类诉求（blockedVideoEdit）。'
        : '当前媒体为图片：允许图片分析与出图、修图类诉求（不涉及视频）。',
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
    const imageCount = Math.max(1, Math.min(4, Math.floor(Number(intent.imageCount) || 1)))

    // 首页要求：用户上传媒体后默认先做结构化商用分析；生成诉求可与分析并行返回
    needsAnalysis = true
    if (!needsAnalysis && !needsImageGen) needsAnalysis = true

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

    let analysisText = ''
    let opsPack: { titles: string[]; sellingPoints: string[]; detailLead: string } | undefined
    if (needsAnalysis) {
      try {
        const multimodal = buildUserMultimodalContent(userMessage, mediaType, mediaUrl, supabaseUrl)
        const messages = historyToMessages(history, multimodal, supabaseUrl)
        analysisText = await gpt4oChat(apiKey, baseUrl, messages, 0.35)
        opsPack = await buildOpsPack(apiKey, baseUrl, analysisText, userMessage)
      } catch (e: any) {
        return res.status(200).json({ success: false, error: e?.message || '分析失败', code: 'ANALYSIS_FAILED' })
      }
    }

    let optimizedPrompt = userMessage
    let finalPrompt = userMessage

    if (needsImageGen) {
      if (!allowImageGenPerMinute(userId)) {
        return res.status(200).json({ success: false, error: RATE_ERR, code: 'RATE_LIMITED' })
      }

      if (optimizePrompt) {
        try {
          const op = await gpt4oJson<{ optimized?: string }>(apiKey, baseUrl, [
            '你是电商图片生成提示词工程师，将用户需求改写为适配 nano-banana-2 的高质量提示词。',
            '核心原则：严格保留商品主体结构/颜色/比例，不变形、不换款；仅按用户意图做局部修改。',
            '若用户是“换场景/更亮一点/突出质感/改白底主图”等微调意图，只改指定部分，不重做无关元素。',
            '优先商业可用图：白底主图、场景图、氛围种草图、信息流图；画面干净高级、无多余文字、无侵权元素。',
            `比例优先使用 ${aspectRatio}（已做平台适配，常用 1:1 / 3:4 / 9:16）。`,
            '输出要包含中文描述 + 必要英文视觉关键词，便于模型稳定出图。',
            '输出 JSON：{"optimized":"..."}',
          ].join('\n'),
            JSON.stringify({
              baseAnalysis: analysisText.slice(0, 2000),
              userMessage,
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

      const extra = [
        styleKeywords(style),
        `画幅比例 ${aspectRatio}`,
        hdEnhance ? 'high detail, sharp focus, clean texture' : '',
        'ecommerce product photography, preserve product geometry and color fidelity',
        'clean premium background, no extra text, no watermark, no irrelevant objects',
        preserveLine,
        `参考图权重约 ${refWeight.toFixed(2)}（请在构图中体现参考关系）`,
      ]
        .filter(Boolean)
        .join('；')

      finalPrompt = [optimizedPrompt, extra].join('\n\n')

      if (generateMode === 'preview') {
        const previewId = putPreviewDraft({
          userId,
          mediaType,
          mediaUrl,
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
          refImage: mediaType === 'image' ? mediaUrl : undefined,
          imageCount: 1,
          model: 'nano-banana-2',
        })
        const previewImage = { url: prev.imageUrl, ratio: aspectRatio, variant: 'preview', qcScore: 80, qcIssues: [] as string[] }
        return res.status(200).json({
          success: true,
          kind: 'mixed',
          analysisText: analysisText || undefined,
          optimizedPrompt,
          imageUrls: [prev.imageUrl],
          images: [previewImage],
          previewToken: previewId,
          nextQuestion: '预览方向已生成，是否按该方向生成高清正式图？',
          quickActions: quickActionsFor(mediaType),
          opsPack,
          meta: { aspectRatio, resolution, style, refWeight, imageCount: 1, mode: 'preview' },
        })
      }

      const draft = previewToken ? getPreviewDraft(previewToken, userId) : null
      const finalPromptToUse = draft?.finalPrompt || finalPrompt
      const mediaTypeToUse = draft?.mediaType || mediaType
      const mediaUrlToUse = draft?.mediaUrl || mediaUrl
      const styleToUse = draft?.style || style
      const resolutionToUse = draft?.resolution || resolution

      const variants = abVariant ? (['conservative', 'aggressive'] as const) : (['normal'] as const)
      const images: Array<{ url: string; ratio: string; variant: string; qcScore: number; qcIssues: string[] }> = []
      const baseIdem = String(req.headers?.['idempotency-key'] || req.headers?.['Idempotency-Key'] || '').trim() || `home-${Date.now()}`
      for (const ratio of ratioList) {
        for (const variant of variants) {
          for (let i = 0; i < imageCount; i++) {
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
              refImage: mediaTypeToUse === 'image' ? mediaUrlToUse : undefined,
              imageCount: 1,
              model: 'nano-banana-2',
            })
            let qc: QcResult = { score: 80, issues: [] }
            if (qcEnabled && images.length < 6) {
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

      return res.status(200).json({
        success: true,
        kind: 'mixed',
        analysisText: analysisText || undefined,
        optimizedPrompt: draft?.optimizedPrompt || optimizedPrompt,
        imageUrls: images.map((x) => x.url),
        images,
        nextQuestion: nextQuestionFor(mediaTypeToUse),
        quickActions: quickActionsFor(mediaTypeToUse),
        opsPack,
        meta: {
          aspectRatio: ratioList.length === 1 ? ratioList[0] : ratioList,
          resolution: resolutionToUse,
          style: styleToUse,
          refWeight,
          imageCount,
          mode: 'final',
          subjectLock,
          multiRatio,
          abVariant,
        },
      })
    }

    return res.status(200).json({
      success: true,
      kind: 'analysis',
      analysisText,
      nextQuestion: nextQuestionFor(mediaType),
      quickActions: quickActionsFor(mediaType),
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
    } else if (t.includes('上游') || t.includes('llm请求失败') || t.includes('analysis_failed')) {
      code = 'UPSTREAM_FAILED'
      msg = '模型服务暂时繁忙，请稍后重试；如多次失败，建议简化需求后再提交。'
    }
    return res.status(200).json({ success: false, error: msg, code })
  }
}
