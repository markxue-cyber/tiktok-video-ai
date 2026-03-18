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
    // LLM 成本控制：需要登录 + 额度（AI精修属于计费动作）
    const { checkAndConsume, finalizeConsumption } = await import('./_billing')
    const consumed = await checkAndConsume(req, { type: 'llm' })
    if (consumed.already) return res.status(200).json({ success: true, ...(consumed.result || {}) })
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { tag, tags, language, parts, prompt, negativePrompt, aspectRatio, resolution, product, categoryHint, sceneMode, learnedTweaks } = req.body || {}
    const normalizedTags: string[] = Array.isArray(tags) ? tags.map(String).map((s) => s.trim()).filter(Boolean) : []
    const legacy = String(tag || '').trim()
    if (!normalizedTags.length && legacy) normalizedTags.push(legacy)
    if (!normalizedTags.length) return res.status(400).json({ success: false, error: '缺少tags' })

    const data = await callOpenAICompatJSON<{
      prompt: string
      negativePrompt?: string
      parts?: Record<string, string>
    }>({
      apiKey,
      baseUrl,
      request: {
        model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是电商图片提示词“可控精修器”。输入是一份可编辑的提示词结构(parts)、可选负面词，以及商品信息与已选风格标签。你的目标是：在不改变商品主体的前提下，让画面更符合电商投放/主图标准。',
              '',
              '输出必须是 JSON：',
              '{"prompt": string, "negativePrompt": string, "parts": {"subject": string, "scene": string, "composition": string, "lighting": string, "camera": string, "style": string, "quality": string, "extra": string}}',
              '',
              '硬约束：',
              '- 主体一致性（必须遵守）：不得改变商品的品类/形态/结构/颜色方案，不得新增第二个主体或重复主体，不得把商品替换成其他产品。',
              '- 禁止编造：不得新增未给出的参数/功效/认证/品牌背书/价格优惠等。',
              '- 文字规则：默认不在画面里生成新增文字/水印/Logo（除非 parts.extra 明确要求生成“可读文字海报”，且仍需尽量减少乱码）。',
              '- 最小改动：优先只改 scene/composition/lighting/camera/style/quality/extra；尽量不动 subject，除非为了“主体一致性/更清晰”而微调。',
              '- 电商合格线：主体占画面 60–80%（建议约70%），对焦锐利，背景干净；如需要场景感，只能加 1–2 个弱化场景元素并虚化，不抢主体。',
              '',
              '风格标签说明（可多选，需综合执行，冲突时优先级：信息清晰 > 主图干净 > 高端棚拍 > 质感提升 > 细节特写 > 生活场景）：',
              '- 主图干净：纯色/渐变背景、无杂物、主体占比更高、留白用于贴标、减少道具。',
              '- 高端棚拍：柔光箱、精致高光、干净反射、质感细节、商业摄影。',
              '- 生活场景：加入弱化的场景语义，但背景不抢戏，保持主体清晰。',
              '- 细节特写：更近景/微距、强调材质纹理与结构细节，背景更虚化。',
              '- 信息清晰：构图更规整、对焦更锐利、减少艺术化效果，提升可读性。',
              '- 质感提升：更自然的光影与材质表现，避免塑料感/油腻感/过度磨皮。',
              '',
              '品类提示（可选）：如果提供了 categoryHint，请让 scene/composition 更贴合该品类常见电商拍法，但不得编造具体参数。',
              '',
              '画幅约束：如果提供了 aspectRatio/resolution，构图要适配它（如 9:16 竖版上方留白）。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `输出语言：${language || '简体中文'}`,
              `风格标签（多选）：${normalizedTags.join('、')}`,
              sceneMode ? `模式：${String(sceneMode)}（clean=主图干净；lite=轻场景）` : '',
              categoryHint ? `categoryHint：${String(categoryHint)}` : '',
              aspectRatio || resolution ? `画幅约束：比例=${aspectRatio || '未指定'}，目标分辨率档位=${resolution || '未指定'}` : '',
              product ? `商品信息：${JSON.stringify(product)}` : '',
              learnedTweaks ? `同品类历史微调(learnedTweaks)：${JSON.stringify(learnedTweaks)}` : '',
              `parts(JSON)：${JSON.stringify(parts || {})}`,
              `prompt(可选)：${String(prompt || '')}`,
              `negativePrompt(可选)：${String(negativePrompt || '')}`,
              '请综合所选风格标签对 parts 做最小改动精修，并生成最终 prompt/negativePrompt。优先保证电商可用与主体一致性。',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      },
    })

    const result = {
      success: true,
      prompt: (data as any)?.prompt || String(prompt || ''),
      negativePrompt: (data as any)?.negativePrompt || String(negativePrompt || ''),
      parts: (data as any)?.parts || parts || {},
    }
    await finalizeConsumption(req, { prompt: result.prompt, negativePrompt: result.negativePrompt, parts: result.parts })
    return res.status(200).json(result)
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

