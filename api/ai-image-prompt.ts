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

    const { product, language } = req.body || {}
    if (!product) return res.status(400).json({ success: false, error: '缺少product' })

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        prompt: `${product.name || '产品'}，${product.category || ''}，突出：${product.sellingPoints || ''}，面向：${product.targetAudience || ''}`,
        _mock: true,
      })
    }

    const data = await callOpenAICompatJSON<{ prompt: string }>({
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
              '- 只输出 JSON：{"prompt": string, "negativePrompt": string}',
              '- 不要输出任何解释、Markdown、前后缀',
              '',
              '硬约束：',
              '1) 禁止编造商品参数/材质/成分/功效/认证/价格优惠/对比指标（除非商品信息明确给出）。不确定就不要写。',
              '2) 避免医疗/绝对化/夸大承诺，不写“治愈/100%有效/永久/最强”等。',
              '3) 画面要“电商可用”：主体清晰、构图干净、光影合理、背景不抢戏。',
              '',
              'prompt 写作模板（请在一段话内组织，但内容要覆盖这些点）：',
              '- 主体：商品名称 + 关键外观特征（颜色/形态/材质质感，仅限已知）',
              '- 场景：主图（纯背景/棚拍）或生活场景（二选一，优先主图更通用）',
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
              `商品信息：${JSON.stringify(product)}`,
              '请生成适用于“电商主图/投放素材”的图片生成提示词。',
            ].join('\n'),
          },
        ],
      },
    })

    const prompt = (data as any)?.prompt
    if (!prompt) throw new Error('图片提示词为空')
    // 保持向后兼容：前端当前只读取 prompt
    return res.status(200).json({ success: true, prompt, negativePrompt: (data as any)?.negativePrompt || '' })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

