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
    if (req.query?.mock === '1') {
      return res.status(200).json({
        success: true,
        data: {
          name: 'Mock产品',
          category: 'Mock类目',
          sellingPoints: 'Mock卖点',
          targetAudience: 'Mock人群',
          language: '简体中文',
          kind: 'video',
          _mock: true,
        },
      })
    }
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { refImage, language, kind } = req.body || {}

    if (!refImage) return res.status(400).json({ success: false, error: '缺少refImage' })
    if (!apiKey) {
      return res.status(200).json({
        success: true,
        data: {
          name: '示例产品',
          category: '电子产品',
          sellingPoints: '高性能 / 高颜值 / 易上手',
          targetAudience: '年轻用户',
          language: language || '简体中文',
          kind: kind || 'video',
          _mock: true,
        },
      })
    }

    const data = await callOpenAICompatJSON<{
      name: string
      category: string
      sellingPoints: string
      targetAudience: string
    }>({
      apiKey,
      baseUrl,
      request: {
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是电商商品信息抽取助手，面向“带货短视频/投放素材”场景。请仅基于图片中清晰可见的信息抽取商品信息，目标是“准确、可用、可拍”。',
              '',
              '输出格式要求（必须严格遵守）：',
              '- 只输出一个 JSON 对象，且仅包含以下字段：',
              '{"name": string, "category": string, "sellingPoints": string, "targetAudience": string}',
              '- 不要输出任何解释、前后缀、Markdown、代码块。',
              '',
              '关键原则（非常重要）：',
              '1) 证据优先：只能使用图片中“明确可见”的品牌/品名/型号/规格/材质/功能词/卖点文案/适用场景来推断。看不清或不存在的信息不要猜。',
              '2) 不确定就写“未知”：任何字段如果缺乏足够证据，请输出“未知”，不要编造。',
              '3) 面向卖货可用：sellingPoints 要尽量是“画面可表现、可验证”的点（外观细节、结构设计、使用动作、场景对比、规格参数、材质工艺）。避免抽象词（如“高端”“顶配”“性价比”）作为卖点。',
              '',
              '字段填写规范：',
              '- name：',
              '  - 尽量写“品牌 + 品名 + 关键规格/型号（如有）”',
              '  - 品名要具体（如“电动牙刷”“真无线耳机”“保温杯”“洗衣液”“防晒霜”），不要只写“产品/商品”',
              '  - 若品牌不清晰：不要猜品牌；只写品名+规格；只有当“连品名/品类都无法判断”时才输出“未知”',
              '  - “未知”只能单独作为字段值出现，禁止输出类似“未知 床头灯/未知-耳机”这种混合形式',
              '- category（电商类目路径风格，尽量两级）：',
              '  - 示例：3C-耳机/耳麦；个护-电动牙刷；家清-洗衣液；美妆-口红；家居-收纳；食品-坚果',
              '  - 若只能确定大类，写到大类；都不确定则“未知”',
              '- sellingPoints：',
              '  - 用 3-6 个短语，用 “/” 分隔（允许少于3个；看不出则“未知”）',
              '  - 每个短语尽量具体：规格、参数（仅限图中写明）、材质、功能、结构、场景、对比点',
              '  - 禁止凭空编造：续航时长、功率、成分含量、功效承诺、认证资质、价格优惠等（除非图片明确写出）',
              '- targetAudience：',
              '  - 用 2-4 个短语，用 “/” 分隔（例如：通勤人群/学生党/宝妈/健身人群/送礼人群/租房党/办公室人群）',
              '  - 只做“场景/需求”层面的画像；不要推断敏感属性（年龄、性别等）；不确定就“未知”',
              '',
              '合规边界：',
              '- 不要生成医疗/夸大功效/绝对化承诺等表述（除非图片明确且仍需保守）。',
              '- 最终输出必须是可被 JSON.parse 解析的纯 JSON。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `输出语言：${language || '简体中文'}` },
              { type: 'text', text: '场景：电商带货短视频（用于生成脚本与视频生成提示词）' },
              { type: 'text', text: '请根据下方商品图抽取信息。任何不清晰或不可见的信息请填“未知”，不要猜测。' },
              { type: 'image_url', image_url: { url: String(refImage) } },
            ],
          },
        ],
      },
    })

    const normalizedName = (() => {
      const v = String((data as any)?.name || '').trim()
      if (!v) return '未知'
      const m = v.match(/^未知[\s\-:：,，/]+(.+)$/)
      if (m?.[1]?.trim()) return m[1].trim()
      return v
    })()

    return res.status(200).json({
      success: true,
      data: {
        ...data,
        name: normalizedName,
        language: language || '简体中文',
        kind: kind || 'video',
      },
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

