async function callOpenAICompatJSON<T>({
  apiKey,
  baseUrl,
  request,
}: {
  apiKey: string
  baseUrl: string
  request: { model: string; messages: { role: 'system' | 'user' | 'assistant'; content: any }[]; temperature?: number; response_format?: any }
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
    // 保险栓 + 鉴权/额度：仅在用户确认的前端动作触发（避免后台/爬虫触发计费）
    const billableConfirmed = String(req.headers?.['x-confirm-billable'] || '').toLowerCase() === 'true'
    if (!billableConfirmed) return res.status(403).json({ success: false, error: '已拦截：缺少 X-Confirm-Billable: true（防止误触发计费）' })
    // LLM 成本控制：需要登录 + 额度
    const { checkAndConsume } = await import('./_billing.js')
    const consumed = await checkAndConsume(req, { type: 'llm' })
    if (consumed.already) return res.status(200).json({ success: true, qc: (consumed.result || {}).qc })

    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { imageUrl, refImage, product, aspectRatio, resolution, language } = req.body || {}
    if (!imageUrl) return res.status(400).json({ success: false, error: '缺少imageUrl' })

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        qc: {
          score: 80,
          verdict: 'pass',
          issues: [],
          suggestions: ['（mock）画面清晰，主体突出，适合电商主图。'],
          fix: { addToNegative: '文字水印, 杂乱背景, 低清晰度', promptTweaks: { composition: '主体居中占比更高，四周留白用于贴标，背景干净纯色' } },
        },
        _mock: true,
      })
    }

    const qc = await callOpenAICompatJSON<{
      score: number
      verdict: 'pass' | 'warn' | 'fail'
      issues: string[]
      suggestions: string[]
      fix: {
        addToNegative?: string
        promptTweaks?: Record<string, string>
      }
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
              '你是“电商主图/投放素材”质量检查员。你只基于图片可见内容给出判断，目标是提升“可投放性”。',
              '',
              '输出必须是 JSON：',
              '{"score": number(0-100), "verdict":"pass|warn|fail", "issues": string[], "suggestions": string[], "fix": {"addToNegative": string, "promptTweaks": {"subject": string, "scene": string, "composition": string, "lighting": string, "camera": string, "style": string, "quality": string, "extra": string}}}',
              '',
              '检查要点（电商主图优先）：',
              '- 主体是否清晰、占比是否足够（建议 60-80%）',
              '- 背景是否干净、是否有多余物体/手/奇怪道具',
              '- 是否出现乱码文字/水印/错误Logo（尤其是“生成的文字”）',
              '- 结构是否畸形（变形、缺角、重复、融合）',
              '- 光影是否自然（不过曝/不过暗）、是否偏油腻/塑料感',
              '- 是否与参考图一致（若提供 refImage：颜色/形态/包装一致性）',
              '',
              '给 fix：',
              '- addToNegative：给出可直接追加的负面词（用逗号分隔）',
              '- promptTweaks：给出“最小改动”的分字段修改建议（只写需要改的字段，其他可空字符串）',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `输出语言：${language || '简体中文'}` },
              { type: 'text', text: `画幅：比例=${aspectRatio || '未指定'}；分辨率档位=${resolution || '未指定'}` },
              { type: 'text', text: `商品信息：${JSON.stringify(product || {})}` },
              { type: 'text', text: '这是“生成结果图”，请做电商主图质检。' },
              { type: 'image_url', image_url: { url: String(imageUrl) } },
              ...(refImage
                ? [
                    { type: 'text', text: '这是“参考图”，用于一致性对比（如不适用可忽略）。' },
                    { type: 'image_url', image_url: { url: String(refImage) } },
                  ]
                : []),
            ],
          },
        ],
      },
    })

    const { finalizeConsumption } = await import('./_billing.js')
    await finalizeConsumption(req, { qc })
    return res.status(200).json({ success: true, qc })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

