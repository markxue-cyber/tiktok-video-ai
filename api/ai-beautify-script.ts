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
  const refusal = (data as any)?.choices?.[0]?.message?.refusal
  if (refusal && typeof refusal === 'string') throw new Error(`LLM拒绝响应：${refusal}`)
  const content = (data as any)?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') throw new Error(`LLM响应为空（raw: ${rawText.slice(0, 300)}）`)
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
    const tagList: string[] = Array.isArray(tags) ? tags.filter(Boolean).map(String) : []
    const tagRules: Record<string, string> = {
      '真人感': '口播更口语、第一人称体验；画面偏手持、自然光、生活场景；字幕简短有情绪但不夸大。',
      '高端': '画面强调质感（柔光、轮廓光、干净背景、材质特写）；用词克制高级；字幕短而有力。',
      '简洁': '每行更短更干净；字幕尽量≤10字；去掉重复修饰，保留核心信息与镜头动作。',
      '详实': '信息密度提高；把已知卖点拆分到不同镜头并“画面证明”；不得新增未给出的参数/功效。',
      '电影感': '加入镜头语言（景别/推拉/慢动作/光影氛围）；更有叙事与节奏，但仍可拍与合规。',
      '强钩子': '开场钩子更抓人（提问/反常识/对比/痛点一句话），不做收益承诺，不夸大功效。',
      '痛点对比': '强化前后/有无/传统方案 vs 本品的对比镜头描述，用画面证明，不虚构指标。',
      '测评感': '更像开箱实测：手部操作、细节特写、关键点逐条验证；口播更像测评口吻。',
      '种草口吻': '口播更像朋友安利：自然、轻情绪、带个人体验但不夸张；字幕更像口播要点。',
      'TikTok风格': '短句+强节奏；字幕更像短视频爆点；镜头切换更快但保持结构不变。',
      '口播优先': '口播更顺嘴，字幕与口播一致；避免过长从句；每句更像真实说话。',
      '字幕更强': '字幕更有冲击力（更短、更抓眼），但不夸大承诺；保证与口播一致或为口播提炼。',
      '价格友好（不报价格）': '强调“划算/值/性价比/同价位更好”但不出现具体价格与优惠承诺。',
    }
    const tagRuleText = tagList.map((t) => `- ${t}：${tagRules[t] || '按标签名称语义优化，但必须遵守硬性规则。'}`).join('\n')

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
            content: [
              '你是短视频“镜头脚本”优化器。输入是一条镜头化脚本，请在不改变事实、不编造参数的前提下，根据风格标签优化表达。',
              '',
              '硬性规则：',
              '1) 保持原有结构与行数：必须保留并仅使用这些行类型：',
              '   【开场钩子】…、【镜头1】… 到【镜头6】…、【收尾CTA】…',
              '2) 不允许新增或删除镜头编号；每个镜头仍包含：画面/字幕/口播（三段用｜分隔）。',
              '3) 只允许改写“措辞、镜头语言、字幕节奏、口播口吻、画面细节描述”，不得编造新参数/功效/认证/价格优惠等。',
              '4) 避免医疗/绝对化/夸大承诺；CTA 用中性引导（收藏/关注/了解更多/去看看）。',
              '',
              '输出必须严格是 JSON：{"optimized":"<优化后的完整脚本>"}，不要输出任何其他内容。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `输出语言：${language || '简体中文'}`,
              `风格标签：${tagText || '无'}`,
              tagRuleText ? `标签细则：\n${tagRuleText}` : '',
              `原脚本：\n${script}`,
              '请按标签细则优化，并保持镜头结构不变。',
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

