/**
 * 视频分析 · 多轮对话：GPT-4o 多模态（视频/图 + 文本）
 * 兼容 OpenAI Chat Completions；部分网关支持 video_url，否则由上游报错提示。
 */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } }

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

type ClientTurn = {
  role: 'user' | 'assistant'
  text: string
  videoDataUrl?: string | null
  imageDataUrls?: string[] | null
}

const MAX_BODY_CHARS = 2_400_000
const MAX_VIDEO_CHARS = 1_800_000
const MAX_IMAGES = 6

function isDataUrl(u: string) {
  return typeof u === 'string' && u.startsWith('data:') && u.includes('base64,')
}

function buildUserContent(turn: ClientTurn): string | ContentPart[] {
  const text = String(turn.text || '').trim()
  const v = turn.videoDataUrl && isDataUrl(turn.videoDataUrl) ? turn.videoDataUrl : ''
  const imgs = (turn.imageDataUrls || []).filter((x) => isDataUrl(String(x))).slice(0, MAX_IMAGES)

  if (!v && imgs.length === 0) {
    return text || '（用户未输入文字）'
  }

  const parts: ContentPart[] = []
  if (v) {
    parts.push({ type: 'video_url', video_url: { url: v } })
  }
  for (const url of imgs) {
    parts.push({ type: 'image_url', image_url: { url } })
  }
  parts.push({
    type: 'text',
    text: text || '请根据上述视频与图片内容回答我的问题。',
  })
  return parts
}

function turnsToMessages(turns: ClientTurn[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const t of turns) {
    if (t.role === 'assistant') {
      out.push({ role: 'assistant', content: String(t.text || '').trim() || '…' })
      continue
    }
    out.push({ role: 'user', content: buildUserContent(t) })
  }
  return out
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
    if (raw.length > MAX_BODY_CHARS) {
      return res.status(200).json({
        success: false,
        error: '请求体过大：请缩短视频时长、压缩画质或减少附件后重试。',
        code: 'PAYLOAD_TOO_LARGE',
      })
    }

    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { turns, language } = req.body || {}
    if (!Array.isArray(turns) || turns.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 turns' })
    }

    let videoChars = 0
    for (const t of turns) {
      if (t?.videoDataUrl && typeof t.videoDataUrl === 'string') {
        videoChars += t.videoDataUrl.length
      }
    }
    if (videoChars > MAX_VIDEO_CHARS) {
      return res.status(200).json({
        success: false,
        error: '单段视频编码过大，请选择较短或较低分辨率的文件（建议 30 秒内、720p 以下）。',
        code: 'VIDEO_TOO_LARGE',
      })
    }

    const lang = String(language || '简体中文')

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        reply:
          '【演示模式】未配置 XIAO_DOU_BAO_API_KEY。若已上传视频/图片，正式环境将由 GPT-4o 结合画面生成回答。\n\n' +
          '你刚才的问题摘要：' +
          String(turns.filter((x: ClientTurn) => x.role === 'user').pop()?.text || '').slice(0, 200),
        _mock: true,
      })
    }

    const system: ChatMessage = {
      role: 'system',
      content: [
        '你是 GPT-4o 多模态助手，擅长理解用户上传的短视频与图片，并按要求用中文作答。',
        '规则：',
        '- 输出清晰可读的正文；仅在用户需要时使用少量 Markdown 标题/列表。',
        '- 若无法可靠识别视频中的语音、字幕或画面细节，请明确说明「未识别/不确定」，不要编造对白或字幕。',
        '- 不要编造商品功效、认证、销量与价格；仅基于画面与用户提供信息推断。',
        `输出语言偏好：${lang}`,
      ].join('\n'),
    }

    const messages: ChatMessage[] = [system, ...turnsToMessages(turns as ClientTurn[])]

    const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        messages,
      }),
    })

    const rawText = await resp.text()
    const data = (() => {
      try {
        return JSON.parse(rawText)
      } catch {
        return { _raw: rawText }
      }
    })()

    if (!resp.ok) {
      const msg = data?.error?.message || data?.message || `LLM请求失败(${resp.status})`
      return res.status(200).json({ success: false, error: msg, code: 'UPSTREAM_ERROR' })
    }

    const refusal = data?.choices?.[0]?.message?.refusal
    if (refusal && typeof refusal === 'string') {
      return res.status(200).json({ success: false, error: `模型拒绝：${refusal}`, code: 'REFUSAL' })
    }

    const reply = extractAssistantText(data)
    if (!reply) {
      return res.status(200).json({
        success: false,
        error: '模型返回为空，可能是当前网关不支持视频输入格式，请尝试更短视频或仅上传图片。',
        code: 'EMPTY_REPLY',
        rawSnippet: rawText.slice(0, 400),
      })
    }

    return res.status(200).json({ success: true, reply })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
