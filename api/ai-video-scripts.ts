type OpenAICompatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAICompatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAICompatContentPart[]
}

async function callOpenAICompatJSON<T>({
  apiKey,
  baseUrl,
  request,
}: {
  apiKey: string
  baseUrl: string
  request: {
    model: string
    messages: OpenAICompatMessage[]
    temperature?: number
    response_format?: { type: 'json_object' } | { type: 'text' }
  }
}): Promise<T> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
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
    const msg = (data as any)?.error?.message || (data as any)?.message || `LLM请求失败(${resp.status})`
    throw new Error(msg)
  }

  const content =
    (data as any)?.choices?.[0]?.message?.content ??
    (data as any)?.choices?.[0]?.text ??
    (data as any)?.output_text ??
    (data as any)?.data?.output_text
  const refusal = (data as any)?.choices?.[0]?.message?.refusal
  if (refusal && typeof refusal === 'string') {
    throw new Error(`LLM拒绝响应：${refusal}`)
  }
  if (!content || typeof content !== 'string') {
    const snippet = rawText.slice(0, 300)
    throw new Error(`LLM响应为空（raw: ${snippet}）`)
  }

  try {
    return JSON.parse(content) as T
  } catch {
    const m = content.match(/\{[\s\S]*\}/)
    if (m?.[0]) return JSON.parse(m[0]) as T
    throw new Error('LLM未返回可解析的JSON')
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { product, language, refImage } = req.body || {}
    if (!product) return res.status(400).json({ success: false, error: '缺少product' })
    if (!refImage) return res.status(400).json({ success: false, error: '缺少refImage' })

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        scripts: [
          '脚本1：开箱展示 + 3个核心卖点快速扫过 + 结尾引导下单',
          '脚本2：痛点场景切入 + 对比前后效果 + 关键参数强调',
          '脚本3：真人口播测评 + 细节特写 + 结尾优惠信息',
        ],
        _mock: true,
      })
    }

    const data = await callOpenAICompatJSON<{ scripts: any[] }>({
      apiKey,
      baseUrl,
      request: {
        model,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是电商短视频编导（TikTok风格），擅长输出“可直接拍摄”的镜头脚本。请基于商品图与商品信息生成 3 条短视频脚本。',
              '',
              '输出要求（必须严格）：',
              '- 只输出 JSON：{"scripts":[...]}，scripts 必须是长度为3的字符串数组',
              '- 不要输出任何解释、Markdown、前后缀',
              '',
              '硬约束：',
              '1) 禁止编造参数/材质/功效/认证/优惠信息。只能使用商品信息里给定卖点 + 图片可见内容。拿不准就不要写。',
              '2) 每条脚本适配 10-15 秒竖屏：总共 7-9 行（每行一句），节奏快、口语化。',
              '3) 每条脚本必须是“镜头化”格式，严格用以下模板（每行都要可拍摄）：',
              '',
              '【开场钩子】<1行>',
              '【镜头1】画面：<…>｜字幕：<…>｜口播：<…>',
              '【镜头2】画面：<…>｜字幕：<…>｜口播：<…>',
              '...',
              '【镜头6】画面：<…>｜字幕：<…>｜口播：<…>',
              '【收尾CTA】<1行（中性引导：收藏/关注/了解更多/去看看；避免强引导下单/承诺收益）>',
              '',
              '4) 卖点覆盖：sellingPoints 中前 3 个卖点必须至少各出现 1 次，并且要用“画面证明”方式呈现（特写/演示/对比）。',
              '5) 三条脚本风格必须明显不同：',
              '   - 脚本1：开箱测评风（开箱→细节→上手→总结）',
              '   - 脚本2：痛点对比风（痛点→对比→解决→结果）',
              '   - 脚本3：场景种草风（目标人群场景→体验→推荐理由）',
              '6) 合规：避免医疗、绝对化、夸大承诺；不要暗示“治愈/100%有效/永久”等；不要包含歧视/暴力/成人/政治内容。',
              '',
              '语言：按用户要求语言输出。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `输出语言：${language || product.language || '简体中文'}` },
              { type: 'text', text: `商品信息（必须遵守，不要编造）：\n${JSON.stringify(product)}` },
              { type: 'text', text: '请结合商品图的外观与使用场景生成 3 条“镜头化脚本”。' },
              { type: 'image_url', image_url: { url: String(refImage) } },
            ],
          },
        ],
      },
    })

    const scriptsRaw = Array.isArray(data.scripts) ? data.scripts.filter(Boolean).slice(0, 3) : []
    const scripts = scriptsRaw.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const title = (item as any).title || (item as any).name || (item as any).style
        const body = (item as any).script || (item as any).text || (item as any).content
        if (title && body) return `${title}\n${body}`
        if (body) return String(body)
        return JSON.stringify(item)
      }
      return String(item)
    })
    if (scripts.length < 3) throw new Error('脚本生成结果不足3条')

    return res.status(200).json({ success: true, scripts })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

