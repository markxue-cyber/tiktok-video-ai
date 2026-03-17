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

    const { script, tags, language } = req.body || {}
    if (!script) return res.status(400).json({ success: false, error: '缺少script' })

    const tagText = Array.isArray(tags) ? tags.filter(Boolean).join('，') : ''

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        optimized: `${script}${tagText ? `（风格：${tagText}）` : ''}`,
        _mock: true,
      })
    }

    const data = await callOpenAICompatJSON<{ optimized: string }>({
      apiKey,
      baseUrl,
      request: {
        model,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是提示词优化助手。根据用户标签对脚本进行更适合视频生成模型的提示词优化：更具体、更具镜头感、包含风格与关键细节。严格输出JSON：{"optimized":"..."}。',
          },
          {
            role: 'user',
            content: [
              `输出语言：${language || '简体中文'}`,
              `优化标签：${tagText || '无'}`,
              `原脚本：${script}`,
              '请输出优化后的提示词，长度适中，结构清晰。',
            ].join('\n'),
          },
        ],
      },
    })

    if (!data.optimized) throw new Error('优化结果为空')
    return res.status(200).json({ success: true, optimized: data.optimized })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

