/**
 * 图片工作台：商品分析 + 爆款风格（GPT-4o 视觉，主参考图为第一张上传图）
 */
import { buildEcommerceTargetingBlock } from './_ecommerceTargetingPrompt.js'
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

/** 爆款主描述 = DNA 层：与下方「6 场景」分格叠加；勿写死整张图唯一强环境，避免与白底/生活/氛围格冲突 */
function synthesizeImagePrompt(title: string, description: string): string {
  return [
    '参考图同款商品保持一致（外形/配色/结构/材质以图为准）。',
    `【爆款风格｜${title}】${description}`,
    '',
    '【拍法基因 DNA】整套素材统一：突出材质做工、光型（柔光/轮廓/冷暖对比）、色彩气质与商业摄影清晰度；气质落实到商品本体的明暗与高光，而非整张图单一背景合同。',
    '勿写死「整幅只能是黑底/夜景窗外/唯一水泥墙」等强环境；需要的生活感、夜景氛围、纯白主图由后续「场景格」分别追加。',
    '电商基准：主体占画面约60–80%，对焦锐利，写实商业摄影，高清细节，留白便于贴标；默认棚拍级干净基底即可，具体白底/虚化生活底由各场景格定义。',
  ].join('')
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
    '偏暖色家居光感基因：柔光箱+轻轮廓，低饱和奶白与木色气质；景别与背景类型由场景格决定，此处强调亲肤材质与温馨档位。',
    '冷灰工业科技基因：高对比布光落在金属/磨砂结构上，对称稳重构图偏好；用材质高光体现工业感，不写死整张暗场底。',
    '自然侧光基因：柔和阴影过渡、清新生活色调；使用联想交给生活场景格，DNA 只定光型与色彩倾向。',
    '高饱和点缀色与中性灰底对比的基因：动感斜线构图偏好、信息流吸睛气质；具体道具与背景强度由场景格追加。',
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
      'DNA：暖黄与奶白色调、黄昏感柔光气质、对角线构图偏好、母婴亲和情绪；具体卧室/床头虚化由场景生活格承担，白底格仅继承柔光与材质。',
    imagePrompt: synthesizeImagePrompt(
      '温馨治愈',
      '暖黄与奶白色调，模拟黄昏柔光气质，对角线构图偏好，宁静亲和情绪；材质柔和反光控制。不写死唯一床头实景，强生活场由场景格追加。',
    ),
  },
  {
    title: '极简科技',
    description:
      'DNA：冷灰与中性高光、漫反射柔光+轻轮廓、对称稳重、工业材质清晰；工业感靠金属/磨砂高光体现，不写死整张暗色环境底。',
    imagePrompt: synthesizeImagePrompt(
      '极简科技',
      '冷灰科技气质，高亮漫反射柔光与轻轮廓光，中心对称偏好，触控与结构细节锐利，工业设计质感。避免「整图黑底」；白底主图格可纯白无缝底。',
    ),
  },
  {
    title: '深夜守护',
    description:
      'DNA：深蓝与暖橙冷暖对比、局部聚光气质、低角度/沉浸视角偏好、柔和不刺眼；走廊夜景等具体环境交给氛围/生活格。',
    imagePrompt: synthesizeImagePrompt(
      '深夜守护',
      '深蓝与暖橙对比光型，局部柔聚光落在商品上，低角度沉浸气质，起夜灯柔和不刺眼。环境叙事由场景格追加，DNA 只定光色与情绪。',
    ),
  },
  {
    title: '多变生活',
    description:
      'DNA：明亮美式高调色系、自然侧光、斜线动感偏好；书籍绿植等道具与生活场由生活场景格写清，避免与 DNA 重复抢背景合同。',
    imagePrompt: synthesizeImagePrompt(
      '多变生活',
      '明亮高调色系与自然侧光基因，斜线动感构图偏好，多用途生活气质。具体道具与虚化生活底由场景格增量描述。',
    ),
  },
]

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { refImage, language, mode, targetPlatform, targetMarket } = req.body || {}
    const lang = String(language || '简体中文')
    const targetingBlock = buildEcommerceTargetingBlock({
      targetPlatform: String(targetPlatform || 'unspecified'),
      targetMarket: String(targetMarket || 'china'),
      copyLanguage: lang,
    })
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
      '若用户消息含【投放定向】（目标平台/市场/文案语言）：期望场景与目标人群可适度贴合该市场常见用途与审美，但仍仅依据图中可见信息，禁止编造本地化法规、认证、销量与医疗功效。',
      '禁止输出 Markdown、代码块或解释。',
    ].join('\n')

    const systemStyles = [
      '你是电商主图「爆款风格 + 出图主描述（DNA）」策划。用户选中风格后，系统会在同一段 DNA 上再叠加「6 场景」每格独立的镜头/背景增量，因此你必须避免 DNA 与后续场景格「抢同一件事」。',
      '',
      '输出 JSON：{"styles":[{"title": string, "description": string, "imagePrompt": string}, ...]}，styles 必须恰好 4 个。',
      'title：必须恰好 4 个汉字（不要英文、不要标点、不要空格）。',
      'description：80–160 字，给运营看；建议以「DNA：」起头或明显体现：材质、光型偏好、色彩气质、构图/情绪倾向；说明「具体白底/生活/氛围环境由场景格承担」时可简短一笔。',
      'imagePrompt：180–420 字完整中文，作为「拍法基因 DNA」主描述，不是单张成图合同。必须开头写「参考图同款商品保持一致（外形/配色/结构/材质以图为准）」。',
      'DNA 写法（必须遵守）：',
      '- 多写：材质做工、光型（柔光箱/轮廓光/冷暖对比）、色彩气质、商业清晰度、主体占比标准、情绪词。',
      '- 少写或不写：「整张图只能是/必须是」某一种强环境（全黑底、唯一水泥墙、固定夜景窗外、整张暗场等）；若风格偏工业/暗夜/霓虹，请改为「高对比布光落在商品结构、冷金属高光、明暗在形体上」等可在白底/特写/氛围各格延续的表述。',
      '- 明确一句：白底主图、虚化生活场、强氛围夜景等由后续「场景规划」分格追加，本段不写死与白底主图冲突的全图背景。',
      '- 结尾可提醒：默认棚拍级干净基底/电商标准即可，勿强制暗色全图底。',
      '四套方案须在 DNA 维度（冷暖、软硬光、色彩倾向、情绪、材质强调点）上有明显差异；禁止编造未在图中出现的参数、功效、认证、续航数字。',
      '须响应用户消息中的【投放定向】：气质与光型适配目标电商平台主图习惯（如 Amazon 白底清晰、TikTok 动感生活、东南亚明亮暖调等），并与 DNA+6 场景分层兼容，不写死与白底主图互斥的全图暗环境。',
      '不要输出 Markdown 或其它字段。',
    ].join('\n')

    const systemFull = [
      '你是电商图片工作台助手，同时完成：商品结构化分析 + 4 组「爆款风格 DNA（说明 + 主描述）」。',
      '仅依据参考图中清晰可见的信息；不确定写「未知」或「未标注」，禁止编造功效、认证与参数。',
      '',
      '输出 JSON：',
      '{"productAnalysisText": string, "product": {"name": string, "category": string, "sellingPoints": string, "targetAudience": string}, "styles":[{"title": string, "description": string, "imagePrompt": string}, ...]}',
      '',
      'productAnalysisText 格式要求：多行中文，依次包含小节：产品名称 / 产品类目 / 产品卖点 / 目标人群 / 期望场景 / 尺寸参数（规则同单任务）。',
      'styles：恰好 4 个；title 必须恰好 4 个汉字；description 80–160 字，侧重 DNA（材质/光型/色调气质/构图偏好），避免写死整张图唯一强环境。',
      '每个 imagePrompt：180–420 字，为「拍法基因 DNA」主描述，非单张背景合同。开头须「参考图同款商品保持一致」；多写材质与光型气质，少写「整图只能是黑底/夜景墙」；须说明或与下列策略一致：白底/生活/氛围由后续 6 场景分格追加；禁止编造图中没有的信息。',
      '四套方案在 DNA 维度须互不重复且可和 6 场景叠加而不矛盾；须落实用户消息中的【投放定向】（平台主图习惯、市场审美、文案语言）。',
      '不要输出 Markdown、代码块或解释。',
    ].join('\n')

    const userImage: OpenAICompatContentPart[] = [
      { type: 'text', text: `输出语言：${lang}` },
      { type: 'text', text: targetingBlock },
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
