/**
 * 图片工作台：商品分析 + 爆款风格（GPT-4o 视觉，主参考图为第一张上传图）
 */
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

function normalizeFourCharTitle(raw: string): string {
  const s = String(raw || '')
    .trim()
    .replace(/[\s·．.]/g, '')
  const arr = Array.from(s).filter((ch) => ch.trim())
  if (arr.length >= 4) return arr.slice(0, 4).join('')
  const pad = '爆款风格精选推荐'
  const out = [...arr]
  let i = 0
  while (out.length < 4 && i < pad.length) {
    out.push(pad[i++])
  }
  return out.slice(0, 4).join('') || '爆款风格'
}

function normalizeStyles(styles: any): { title: string; description: string }[] {
  const list = Array.isArray(styles) ? styles : []
  const mapped = list.slice(0, 8).map((x: any) => ({
    title: normalizeFourCharTitle(String(x?.title || x?.name || '')),
    description: String(x?.description || x?.desc || '').trim() || '适合电商主图与投放素材的爆款视觉方向。',
  }))
  while (mapped.length < 4) {
    mapped.push({
      title: ['温馨治愈', '极简科技', '深夜守护', '多变生活'][mapped.length] || '风格备选',
      description: '请上传清晰的商品主参考图后重新分析，以生成更贴合类目的风格建议。',
    })
  }
  return mapped.slice(0, 4)
}

const MOCK_PRODUCT_TEXT = [
  '产品名称：多功能床头氛围灯',
  '产品类目：家居/灯具/小夜灯',
  '产品卖点：柔和护眼光 / 触控调光 / 便携充电 / 卧室床头场景适配',
  '目标人群：租房族 / 新手父母 / 追求卧室氛围的年轻用户',
  '期望场景：卧室床头伴睡、起夜柔光、喂奶换尿布弱光、书桌氛围补光',
  '尺寸参数：未标注（以参考图比例为准）',
].join('\n')

const MOCK_STYLES: { title: string; description: string }[] = [
  {
    title: '温馨治愈',
    description:
      '暖黄与奶白色调，模拟黄昏窗边柔光，温馨卧室床头场景，对角线构图，营造宁静伴睡与喂奶的母婴亲和氛围。',
  },
  {
    title: '极简科技',
    description:
      '冷灰与纯白背景，高亮漫反射柔光，展示触控感应细节，中心对称构图，强调产品工业设计感与耐用性。',
  },
  {
    title: '深夜守护',
    description:
      '深蓝与暖橙强对比，局部聚光模拟起夜光效，走廊或床底低角度拍摄，沉浸式第一视角构图，突出不刺眼照明。',
  },
  {
    title: '多变生活',
    description:
      '明亮高调美式家居色系，自然侧光，书桌与床头多场景拼贴构图，加入书籍、绿植等生活化道具，体现多用途适应性。',
  },
]

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { refImage, language, mode } = req.body || {}
    const lang = String(language || '简体中文')
    const m = String(mode || 'full') as 'full' | 'product' | 'styles'

    if (!refImage) return res.status(400).json({ success: false, error: '缺少refImage（请使用第一张主参考图）' })

    if (!apiKey) {
      const baseProduct = {
        name: '多功能床头氛围灯',
        category: '家居/灯具/小夜灯',
        sellingPoints: '柔和护眼光 / 触控调光 / 便携充电 / 卧室床头场景适配',
        targetAudience: '租房族 / 新手父母 / 追求氛围的年轻用户',
        language: lang,
      }
      if (m === 'product') {
        return res.status(200).json({
          success: true,
          productAnalysisText: MOCK_PRODUCT_TEXT,
          product: baseProduct,
          _mock: true,
        })
      }
      if (m === 'styles') {
        return res.status(200).json({ success: true, styles: MOCK_STYLES, _mock: true })
      }
      return res.status(200).json({
        success: true,
        productAnalysisText: MOCK_PRODUCT_TEXT,
        product: baseProduct,
        styles: MOCK_STYLES,
        _mock: true,
      })
    }

    const systemProduct = [
      '你是电商「商品分析」专家，仅依据参考图中清晰可见的信息做推断。',
      '',
      '输出必须是 JSON 对象，字段：',
      '{"productAnalysisText": string, "product": {"name": string, "category": string, "sellingPoints": string, "targetAudience": string}}',
      '',
      'productAnalysisText：多行中文，必须包含以下小节（按顺序，每节一行或多行）：',
      '产品名称：',
      '产品类目：',
      '产品卖点：',
      '目标人群：',
      '期望场景：（可列 3–8 条具体用途/场景，用顿号或换行分隔）',
      '尺寸参数：（图中有标注则写清；没有则写「未标注」）',
      '',
      'product 四字段需与 productAnalysisText 一致；看不清的信息写「未知」，禁止编造功效/认证/参数。',
      '禁止输出 Markdown、代码块或解释。',
    ].join('\n')

    const systemStyles = [
      '你是电商主图「爆款风格」策划，根据参考图中的商品品类与视觉特征，给出 4 组可执行的拍摄/画面风格方案。',
      '',
      '输出 JSON：{"styles":[{"title": string, "description": string}, ...]}，styles 必须恰好 4 个。',
      'title：必须恰好 4 个汉字（不要英文、不要标点、不要空格）。',
      'description：80–160 字，写清色调、光影、构图、氛围、道具倾向；要具体可拍，避免空泛形容词堆砌。',
      '不要输出 Markdown 或其它字段。',
    ].join('\n')

    const systemFull = [
      '你是电商图片工作台助手，同时完成：商品结构化分析 + 4 组爆款主图风格推荐。',
      '仅依据参考图中清晰可见的信息；不确定写「未知」或「未标注」，禁止编造功效、认证与参数。',
      '',
      '输出 JSON：',
      '{"productAnalysisText": string, "product": {"name": string, "category": string, "sellingPoints": string, "targetAudience": string}, "styles":[{"title": string, "description": string}, ...]}',
      '',
      'productAnalysisText 格式要求：多行中文，依次包含小节：产品名称 / 产品类目 / 产品卖点 / 目标人群 / 期望场景 / 尺寸参数（规则同单任务）。',
      'styles：恰好 4 个；title 必须恰好 4 个汉字；description 80–160 字。',
      '不要输出 Markdown、代码块或解释。',
    ].join('\n')

    const userImage: OpenAICompatContentPart[] = [
      { type: 'text', text: `输出语言：${lang}` },
      { type: 'text', text: '以下为主参考商品图（若用户有多张图，仅以本张为准）。' },
      { type: 'image_url', image_url: { url: String(refImage) } },
    ]

    if (m === 'product') {
      const data = await callOpenAICompatJSON<{
        productAnalysisText?: string
        product?: { name?: string; category?: string; sellingPoints?: string; targetAudience?: string }
      }>({
        apiKey,
        baseUrl,
        request: {
          model,
          temperature: 0.25,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemProduct },
            { role: 'user', content: userImage },
          ],
        },
      })
      const product = {
        name: String(data?.product?.name || '').trim() || '未知',
        category: String(data?.product?.category || '').trim() || '未知',
        sellingPoints: String(data?.product?.sellingPoints || '').trim() || '未知',
        targetAudience: String(data?.product?.targetAudience || '').trim() || '未知',
        language: lang,
      }
      const productAnalysisText = String(data?.productAnalysisText || '').trim() || MOCK_PRODUCT_TEXT
      return res.status(200).json({ success: true, productAnalysisText, product })
    }

    if (m === 'styles') {
      const data = await callOpenAICompatJSON<{ styles?: any[] }>({
        apiKey,
        baseUrl,
        request: {
          model,
          temperature: 0.55,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemStyles },
            { role: 'user', content: userImage },
          ],
        },
      })
      const styles = normalizeStyles(data?.styles)
      return res.status(200).json({ success: true, styles })
    }

    const data = await callOpenAICompatJSON<{
      productAnalysisText?: string
      product?: { name?: string; category?: string; sellingPoints?: string; targetAudience?: string }
      styles?: any[]
    }>({
      apiKey,
      baseUrl,
      request: {
        model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemFull },
          { role: 'user', content: userImage },
        ],
      },
    })

    const product = {
      name: String(data?.product?.name || '').trim() || '未知',
      category: String(data?.product?.category || '').trim() || '未知',
      sellingPoints: String(data?.product?.sellingPoints || '').trim() || '未知',
      targetAudience: String(data?.product?.targetAudience || '').trim() || '未知',
      language: lang,
    }
    const productAnalysisText = String(data?.productAnalysisText || '').trim() || MOCK_PRODUCT_TEXT
    const styles = normalizeStyles(data?.styles)

    return res.status(200).json({
      success: true,
      productAnalysisText,
      product,
      styles,
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
