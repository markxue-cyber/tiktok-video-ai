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

function synthesizeImagePrompt(title: string, description: string): string {
  return `参考图同款商品保持一致（外形/配色/结构/材质以图为准），${title}：${description}。电商主图/投放素材，主体占画面约60–80%，对焦清晰锐利，背景干净不抢戏，写实商业摄影，高清细节，留白便于后期贴标与标题。`
}

type WorkbenchStyleRow = { title: string; description: string; imagePrompt: string }

function normalizeStyles(styles: any): WorkbenchStyleRow[] {
  const list = Array.isArray(styles) ? styles : []
  const mapped = list.slice(0, 8).map((x: any) => {
    const title = normalizeFourCharTitle(String(x?.title || x?.name || ''))
    const description =
      String(x?.description || x?.desc || '').trim() || '适合电商主图与投放素材的爆款视觉方向。'
    let imagePrompt = String(x?.imagePrompt || x?.image_prompt || x?.fullPrompt || x?.promptText || '').trim()
    if (!imagePrompt) {
      imagePrompt = synthesizeImagePrompt(title, description)
    }
    return { title, description, imagePrompt }
  })
  /** 模型偶尔返回不足 4 条时补齐；不得使用「请上传图」类文案（用户已传图也会触发补齐） */
  const PAD_DESCRIPTIONS = [
    '偏暖色家居光感，主体居中略俯拍，背景轻虚化突出商品轮廓与材质，适合主图延展与投放测试。',
    '冷灰棚拍高光，对称构图强调工业质感与细节，留白充足便于后期加卖点与价格条。',
    '自然侧光生活场景，低对比柔和阴影，加入弱化环境道具增强使用联想，仍保持主体清晰。',
    '高饱和点缀色与大面积中性底形成对比，动感斜构图，适合活动页与信息流吸睛版本。',
  ] as const
  while (mapped.length < 4) {
    const i = mapped.length
    const title = ['温馨治愈', '极简科技', '深夜守护', '多变生活'][i] || '风格备选'
    const description =
      PAD_DESCRIPTIONS[i % PAD_DESCRIPTIONS.length] ||
      '适合电商主图与投放素材的爆款视觉方向，可在编辑中细化光线、构图与卖点呈现。'
    mapped.push({
      title,
      description,
      imagePrompt: synthesizeImagePrompt(title, description),
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

const MOCK_STYLES: WorkbenchStyleRow[] = [
  {
    title: '温馨治愈',
    description:
      '暖黄与奶白色调，模拟黄昏窗边柔光，温馨卧室床头场景，对角线构图，营造宁静伴睡与喂奶的母婴亲和氛围。',
    imagePrompt:
      '参考图同款多功能床头氛围灯保持一致，温馨治愈：暖黄与奶白色调，黄昏窗边柔光，卧室床头轻场景背景虚化，对角线构图，母婴亲和氛围。电商主图，主体占画面约70%，写实商业摄影，高清细节，背景干净，留白贴标。',
  },
  {
    title: '极简科技',
    description:
      '冷灰与纯白背景，高亮漫反射柔光，展示触控感应细节，中心对称构图，强调产品工业设计感与耐用性。',
    imagePrompt:
      '参考图同款商品保持一致，极简科技：冷灰与纯白棚拍背景，高亮漫反射柔光，中心对称构图，突出触控与结构细节，工业设计质感。电商主图，主体清晰占比高，边缘锐利，无杂乱道具，写实商业摄影。',
  },
  {
    title: '深夜守护',
    description:
      '深蓝与暖橙强对比，局部聚光模拟起夜光效，走廊或床底低角度拍摄，沉浸式第一视角构图，突出不刺眼照明。',
    imagePrompt:
      '参考图同款商品保持一致，深夜守护：深蓝与暖橙对比，局部柔聚光模拟起夜灯效，走廊或床底低角度，第一视角沉浸构图，光线柔和不刺眼。电商投放素材，主体明确，背景弱化，高清写实。',
  },
  {
    title: '多变生活',
    description:
      '明亮高调美式家居色系，自然侧光，书桌与床头多场景拼贴构图，加入书籍、绿植等生活化道具，体现多用途适应性。',
    imagePrompt:
      '参考图同款商品保持一致，多变生活：明亮美式家居色调，自然侧光，书桌与床头轻场景拼贴感构图，书籍与绿植作弱化道具，多用途生活感。主体占画面60–80%，背景不抢戏，写实商业摄影，适合电商主图延展。',
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
      '你是电商主图「爆款风格 + 出图提示词」策划，根据参考图中的商品做 4 套互不重复的方案。',
      '',
      '输出 JSON：{"styles":[{"title": string, "description": string, "imagePrompt": string}, ...]}，styles 必须恰好 4 个。',
      'title：必须恰好 4 个汉字（不要英文、不要标点、不要空格）。',
      'description：80–160 字，给运营看的短说明（色调、光影、构图、氛围）。',
      'imagePrompt：单独一段完整的中文出图提示词（建议 180–420 字），可直接用于文生图/图生图；必须开头强调「参考图同款商品保持一致」；融合该风格与图中可见的商品信息；写清主体占比、光影、背景、镜头感；遵守电商主图规范；禁止编造未在图中出现的参数、功效、认证、续航数字等。',
      '四套方案的 imagePrompt 必须在场景/光影/构图上有明显差异。',
      '不要输出 Markdown 或其它字段。',
    ].join('\n')

    const systemFull = [
      '你是电商图片工作台助手，同时完成：商品结构化分析 + 4 组「风格说明 + 完整出图提示词」。',
      '仅依据参考图中清晰可见的信息；不确定写「未知」或「未标注」，禁止编造功效、认证与参数。',
      '',
      '输出 JSON：',
      '{"productAnalysisText": string, "product": {"name": string, "category": string, "sellingPoints": string, "targetAudience": string}, "styles":[{"title": string, "description": string, "imagePrompt": string}, ...]}',
      '',
      'productAnalysisText 格式要求：多行中文，依次包含小节：产品名称 / 产品类目 / 产品卖点 / 目标人群 / 期望场景 / 尺寸参数（规则同单任务）。',
      'styles：恰好 4 个；title 必须恰好 4 个汉字；description 80–160 字（运营可读短说明）。',
      '每个 style 必须包含 imagePrompt：完整一段中文出图提示词（180–420 字），用户选中该风格后可直接作为主提示词；须强调与参考图商品一致；须体现该 title/description 的差异化光影与构图；禁止编造图中没有的信息。',
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
