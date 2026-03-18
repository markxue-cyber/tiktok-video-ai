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

    const { tag, language, parts, prompt, negativePrompt, aspectRatio, resolution } = req.body || {}
    const styleTag = String(tag || '').trim()
    if (!styleTag) return res.status(400).json({ success: false, error: '缺少tag' })

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
              '你是电商图片提示词“可控优化器”。输入是一份可编辑的提示词结构(parts)与可选的负面词，目标是根据风格标签做“最小改动”增强，同时保持商品真实、画面干净、可投放。',
              '',
              '输出必须是 JSON：',
              '{"prompt": string, "negativePrompt": string, "parts": {"subject": string, "scene": string, "composition": string, "lighting": string, "camera": string, "style": string, "quality": string, "extra": string}}',
              '',
              '硬约束：',
              '- 禁止新增任何文字/水印/Logo（除非输入明确要求且参考图可见，仍需保守）。',
              '- 禁止编造商品参数/功效/认证/价格等。',
              '- 改动要小：优先只改 style/lighting/composition/quality/extra，除非标签明确要求。',
              '',
              '风格标签说明（仅从中选择匹配的规则执行）：',
              '- 主图干净：纯色/渐变背景、无杂物、主体占比更高、留白用于贴标、减少道具。',
              '- 高端棚拍：柔光箱、精致高光、干净反射、质感细节、商业摄影。',
              '- 生活场景：加入弱化的场景语义，但背景不抢戏，保持主体清晰。',
              '- 细节特写：更近景/微距、强调材质纹理与结构细节，背景更虚化。',
              '- 信息清晰：构图更规整、对焦更锐利、减少艺术化效果，提升可读性。',
              '- 质感提升：更自然的光影与材质表现，避免塑料感/油腻感/过度磨皮。',
              '',
              '画幅约束：如果提供了 aspectRatio/resolution，构图要适配它（如 9:16 竖版上方留白）。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `输出语言：${language || '简体中文'}`,
              `风格标签：${styleTag}`,
              aspectRatio || resolution ? `画幅约束：比例=${aspectRatio || '未指定'}，目标分辨率档位=${resolution || '未指定'}` : '',
              `parts(JSON)：${JSON.stringify(parts || {})}`,
              `prompt(可选)：${String(prompt || '')}`,
              `negativePrompt(可选)：${String(negativePrompt || '')}`,
              '请按风格标签对 parts 做最小改动增强，并生成最终 prompt/negativePrompt。',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      },
    })

    return res.status(200).json({
      success: true,
      prompt: (data as any)?.prompt || String(prompt || ''),
      negativePrompt: (data as any)?.negativePrompt || String(negativePrompt || ''),
      parts: (data as any)?.parts || parts || {},
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

