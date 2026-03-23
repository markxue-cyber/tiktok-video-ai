async function callOpenAICompatJSON<T>({
  apiKey,
  baseUrl,
  request,
}: {
  apiKey: string
  baseUrl: string
  request: { model: string; messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; temperature?: number; response_format?: any }
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
  if (!resp.ok) throw new Error((data as any)?.error?.message || (data as any)?.message || `LLM请求失败(${resp.status})`)
  const content = (data as any)?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') throw new Error('LLM响应为空')
  const m = content.match(/\{[\s\S]*\}/)
  return JSON.parse(m?.[0] || content) as T
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { product, language, aspectRatio, resolution, sceneMode, hotSellingStyle, productAnalysisNotes } = req.body || {}
    if (!product) return res.status(400).json({ success: false, error: '缺少product' })

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        prompt: `${product.name || '产品'}，${product.category || ''}，突出：${product.sellingPoints || ''}，面向：${product.targetAudience || ''}${
          hotSellingStyle?.description ? `，风格：${hotSellingStyle.title || ''} ${hotSellingStyle.description}` : ''
        }`,
        _mock: true,
      })
    }

    const data = await callOpenAICompatJSON<{
      categoryHint?: string
      prompt: string
      negativePrompt?: string
      parts?: {
        subject?: string
        scene?: string
        composition?: string
        lighting?: string
        camera?: string
        style?: string
        quality?: string
        extra?: string
      }
    }>({
      apiKey,
      baseUrl,
      request: {
        model,
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是电商“图片投放素材/主图”提示词专家。你的目标是产出可直接用于图片生成模型的提示词，要求真实可控、清晰可执行、适合商业图片。',
              '',
              '输出要求（必须严格）：',
              '- 只输出 JSON，字段如下：',
              '  {"categoryHint": string, "prompt": string, "negativePrompt": string, "parts": {"subject": string, "scene": string, "composition": string, "lighting": string, "camera": string, "style": string, "quality": string, "extra": string}}',
              '- 不要输出任何解释、Markdown、前后缀',
              '',
              '硬约束：',
              '1) 禁止编造商品参数/材质/成分/功效/认证/价格优惠/对比指标（除非商品信息明确给出）。不确定就不要写。',
              '2) 避免医疗/绝对化/夸大承诺，不写“治愈/100%有效/永久/最强”等。',
              '3) 画面要“电商可用”：主体清晰、构图干净、光影合理、背景不抢戏。',
              '4) 禁止在画面中生成任何新增文字/水印/Logo（除非商品信息里明确包含且“参考图”本身可见，仍需尽量保守）。',
              '5) 电商默认标准（必须纳入第一次生成，避免质检后重来）：主体占画面 60–80%，对焦锐利，背景干净；如需要场景感，也必须是“轻场景元素”，且虚化/弱化不抢主体。',
              '6) 「爆款风格 + 6 场景」分层：若用户提供了爆款风格，将其气质拆解进 parts 时，parts.scene 与合并后的 prompt 应作为「DNA」——写可迁移的棚拍/轻场景基因（柔光、渐变、轻虚化），禁止写死「整幅画面只能是黑底/唯一夜景/固定实景墙」；强环境留给后续场景格。',
              '',
              '品类自适配（非常重要）：你必须输出 categoryHint，并基于不同品类的拍法生成 parts。',
              'categoryHint 必须从下列枚举中选择一个最匹配的：',
              '- lamp（灯具/台灯/氛围灯）',
              '- fishing_rod（钓鱼竿/渔具）',
              '- skincare（护肤/美妆）',
              '- haircare（洗护发/个人护理）',
              '- snack（零食/食品）',
              '- beverage（饮品/咖啡/茶）',
              '- apparel（服饰/鞋靴/箱包）',
              '- jewelry（首饰/手表）',
              '- 3c_accessory（3C配件/数码小物）',
              '- home_kitchen（家居/厨具/小家电/收纳）',
              '- cleaning（清洁/家清）',
              '- pet（宠物用品）',
              '- baby（母婴）',
              '- sports_outdoor（运动户外，非钓鱼竿）',
              '- other（以上都不匹配）',
              '',
              '各品类拍法要点（用于生成 parts；遵循“主图干净/轻场景”模式）：',
              '- lamp：强调灯光氛围与材质质感（开灯暖光/柔光），展示灯罩/底座/触控或调光细节；轻场景可选床头/书桌但要虚化。',
              '- fishing_rod：展示竿身延展与导环/握把细节，斜线构图体现长度；轻场景可选水边/户外但背景虚化；避免多根竿/结构畸形。',
              '- skincare：干净高端棚拍，玻璃/金属反光控制，允许少量“洁净道具”（水滴/叶片/石材）但不杂乱；避免夸大功效文案。',
              '- haircare：浴室/梳妆台轻场景可用但保持干净，突出瓶身材质与泵头/盖子细节；避免泡沫遮挡主体。',
              '- snack/beverage：突出包装与口感联想（少量道具如坚果/咖啡豆/冰块），但主体占比仍要高；避免脏乱油腻。',
              '- apparel/jewelry：自然柔光、材质纹理清晰；服饰主图建议平铺或挂拍；若文案含真人穿搭/生活场景，须写清中景或半身、完整头部入画，避免仅胸部裁切的无头构图。首饰强调高光与细节，背景更干净。',
              '- 3c_accessory：科技感棚拍，边缘轮廓光，材质纹理与接口细节清晰；避免多余反光与多件重复。',
              '- home_kitchen/cleaning：干净明亮，强调功能相关场景但弱化背景；主体占比高。',
              '- pet/baby：明亮温和，安全干净，轻场景可用但不出现复杂人脸/文字。',
              '',
              'prompt 写作模板（请用 parts 分段写清楚，再在 prompt 中合并为一段）：',
              '- 主体：商品名称 + 关键外观特征（颜色/形态/材质质感，仅限已知）',
              '- 场景：写「棚拍/纯色/轻渐变/轻虚化」等可兼容多场景格的基底，不写死与「商业白底主图」互斥的唯一暗环境',
              '- 构图：居中/三分法、留白、前景/背景层次',
              '- 光影：柔光箱/自然侧光/轮廓光等（选择一个明确方案）',
              '- 镜头：焦段/景别（如：50mm，近景特写）',
              '- 风格：写实商业摄影、高清、细节清晰',
              '',
              'negativePrompt：列出需要避免的元素（模糊/低清/畸形/多余物体/文字水印/过曝欠曝/噪点/杂乱背景等）。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `输出语言：${language || product.language || '简体中文'}`,
              `模式：${String(sceneMode || 'clean')}（clean=主图干净；lite=轻场景）`,
              aspectRatio || resolution ? `画幅约束：比例=${aspectRatio || '未指定'}，目标分辨率档位=${resolution || '未指定'}` : '',
              hotSellingStyle?.description || hotSellingStyle?.title
                ? `用户选择的爆款风格（作拍法基因 DNA 融入 parts 与 prompt；气质落在材质与光型，勿写死整图唯一强环境；不编造商品事实）：${String(hotSellingStyle.title || '').trim()} —— ${String(hotSellingStyle.description || '').trim()}`
                : '',
              productAnalysisNotes
                ? `商品分析全文（用户可编辑，优先参考其中的场景与人群细节；仍须遵守禁止编造规则）：\n${String(productAnalysisNotes).slice(0, 12000)}`
                : '',
              `商品信息：${JSON.stringify(product)}`,
              [
                '请生成适用于“电商主图/投放素材”的图片生成提示词。构图必须适配画幅约束：主体清晰占比高、留白合理（便于后期贴标/标题）、背景干净不抢戏。',
                '',
                '与「6 场景分张出图」兼容：主提示词 = DNA；每格会再追加增量。若爆款风格含深色/工业风/夜景气质，请用材质高光、对比布光、色温写在商品与局部光上；scene/prompt 均不得规定「整幅只能是黑底/暗场/唯一实景墙」。',
                '效果最大化：DNA 负责「像同一套片」，留出让 selling_focus/lifestyle/atmosphere 等格发挥的差异空间。',
                '',
                '模式细则（必须执行）：',
                '- clean（主图干净）：scene 选择棚拍/纯色或轻渐变背景；允许极少道具但不可出现杂乱；composition 强调主体占比 70% 左右、居中或三分法。',
                '- lite（轻场景）：scene 加 1–2 个“弱化场景元素/道具”（需虚化/弱化，不抢主体）；composition 仍需主体占比 60–80%，背景干净。',
              ].join('\n'),
            ].join('\n'),
          },
        ],
      },
    })

    const prompt = (data as any)?.prompt
    if (!prompt) throw new Error('图片提示词为空')
    // 保持向后兼容：前端当前只读取 prompt
    return res.status(200).json({
      success: true,
      categoryHint: (data as any)?.categoryHint || 'other',
      prompt,
      negativePrompt: (data as any)?.negativePrompt || '',
      parts: (data as any)?.parts || {},
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

