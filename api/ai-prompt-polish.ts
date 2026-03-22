/**
 * 图片生成（简版）· 提示词润色：固定使用 GPT-4o（与 XIAO_DOU_BAO 兼容网关）
 */
async function callOpenAICompatJSON<T>({
  apiKey,
  baseUrl,
  request,
}: {
  apiKey: string
  baseUrl: string
  request: {
    model: string
    messages: { role: 'system' | 'user'; content: string }[]
    temperature?: number
    response_format?: { type: 'json_object' }
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
  if (!resp.ok) throw new Error((data as any)?.error?.message || (data as any)?.message || `LLM请求失败(${resp.status})`)
  const content = (data as any)?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') throw new Error('LLM响应为空')
  const m = content.match(/\{[\s\S]*\}/)
  return JSON.parse(m?.[0] || content) as T
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const billableConfirmed = String(req.headers?.['x-confirm-billable'] || '').toLowerCase() === 'true'
    if (!billableConfirmed) return res.status(403).json({ success: false, error: '已拦截：缺少 X-Confirm-Billable: true' })

    const { checkAndConsume, finalizeConsumption } = await import('./_billing.js')
    const consumed = await checkAndConsume(req, { type: 'llm' })
    if (consumed.already) {
      const r = consumed.result || {}
      return res.status(200).json({ success: true, polished: String((r as any).polished || '') })
    }

    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    /** 产品要求：本接口固定 GPT-4o 润色 */
    const model = 'gpt-4o'

    const { prompt, language } = req.body || {}
    const raw = String(prompt || '').trim()
    if (!raw) return res.status(400).json({ success: false, error: '缺少提示词' })

    if (!apiKey) {
      const polished = `${raw}\n\n（演示模式：未配置 API Key，未实际调用 GPT-4o）`
      await finalizeConsumption(req, { polished, _mock: true })
      return res.status(200).json({ success: true, polished, _mock: true })
    }

    const data = await callOpenAICompatJSON<{ polished?: string }>({
      apiKey,
      baseUrl,
      request: {
        model,
        temperature: 0.45,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是图像生成提示词润色专家，使用 GPT-4o 级别的理解与表达能力。',
              '用户会提供一段中文或中英混排的出图提示词，请你润色为更清晰、可执行、适合文生图/图生图模型的描述。',
              '',
              '硬性规则：',
              '1) 不得编造用户未提及的商品参数、功效、认证、品牌、价格。',
              '2) 保留用户的核心主体与意图；可补充光影、构图、镜头、材质、氛围等画面语言，但需克制、可执行。',
              '3) 默认避免画面内可读文字/水印/Logo；若用户明确要求文字海报可保留其意图但提醒减少乱码风险。',
              '4) 输出语言与输入一致（以中文为主时可夹少量必要英文专有词）。',
              '5) 只输出 JSON：{"polished":"润色后的完整提示词"}，不要 Markdown、不要解释。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [`输出语言偏好：${language || '简体中文'}`, `原始提示词：\n${raw}`].join('\n\n'),
          },
        ],
      },
    })

    const polished = String(data?.polished || '').trim() || raw
    await finalizeConsumption(req, { polished, model })
    return res.status(200).json({ success: true, polished })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
