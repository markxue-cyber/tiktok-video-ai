/**
 * 基于「基础出图描述」用 GPT-4o 规划 6 组电商场景（文案 + 每场景可合并的 imagePrompt）
 */
async function callOpenAICompatJSON<T>({
  apiKey,
  baseUrl,
  request,
}: {
  apiKey: string
  baseUrl: string
  request: { model: string; messages: { role: 'system' | 'user'; content: string }[]; temperature?: number; response_format?: any }
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

const KEYS = ['commercial_white', 'selling_focus', 'lifestyle', 'comparison', 'detail', 'atmosphere'] as const
const TITLES: Record<string, string> = {
  commercial_white: '商业白底主图',
  selling_focus: '卖点聚焦图',
  lifestyle: '场景生活图',
  comparison: '对比/效果图',
  detail: '产品细节图',
  atmosphere: '氛围创意图',
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { basePrompt, negativePrompt, product, productAnalysisNotes, hotSellingStyle, language } = req.body || {}
    const bp = String(basePrompt || '').trim()
    if (!bp) return res.status(400).json({ success: false, error: '缺少basePrompt' })

    if (!apiKey) {
      const scenes = KEYS.map((k) => ({
        key: k,
        title: TITLES[k] || k,
        description:
          k === 'commercial_white'
            ? '纯白或极浅灰棚拍背景，主体居中，柔光箱均匀布光，电商主图标准构图。'
            : k === 'selling_focus'
              ? '微距或近景特写，突出核心卖点结构（如触控区/接口/材质纹理），浅景深。'
              : k === 'lifestyle'
                ? '真实生活场景弱化背景，产品与使用情境结合，自然光或柔光，温馨干净。'
                : k === 'comparison'
                  ? '对比或效果暗示构图（前后/数据可视化氛围），避免编造未给出的参数。'
                  : k === 'detail'
                    ? '多角度或细节拼接感构图，展示结构与做工，背景干净不抢戏。'
                    : '低照度氛围光、轮廓光或色温对比，强调情绪与夜间使用场景感。',
        imagePrompt: `在保持参考商品一致的前提下，强化「${TITLES[k]}」方向：光影与构图与其它场景要有明显差异，适合电商投放。`,
      }))
      return res.status(200).json({ success: true, scenes, _mock: true })
    }

    const data = await callOpenAICompatJSON<{ scenes?: any[] }>({
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
              '你是电商图片「多场景出图」策划。把【基础出图描述】视为拍法基因 DNA（材质、光型气质、色调、主体标准）；你为 6 个 key 各写「本张增量」——只补充本格的背景合同、景别、构图任务，不要重复整段 DNA。',
              '',
              '必须输出 JSON：{"scenes":[...]}，且 scenes 必须恰好 6 条，顺序与 key 严格对应：',
              '1) commercial_white  2) selling_focus  3) lifestyle  4) comparison  5) detail  6) atmosphere',
              '',
              '每条对象字段：',
              '{"key": string, "title": string, "description": string, "imagePrompt": string}',
              '- key：必须与上述英文 key 完全一致。',
              '- title：中文展示名，需包含规范含义（可加括号补充如「母婴哺乳」）。',
              '- description：给运营看的 1–3 行：本格相对 DNA 的分工说明。',
              '- imagePrompt：写给图片模型的中文增量，拼在 DNA 之后；建议开头用短句承接 DNA（如「延续上文材质与光型气质」），再写本格差异；禁止编造未给出的参数/功效/认证/续航数字；不写 JSON。',
              '',
              '分层与效果最大化：',
              '- DNA 提供全组一致性；每条 imagePrompt 负责「这一张和别张差在哪」。避免 6 条都复述同一段背景；也避免在某条里再写一套与 DNA 完全无关的新品牌气质。',
              '- 承接 DNA：可点名延续的词汇（冷灰高光、柔光箱、暖杏色调等），但本格的背景/环境以本条为准。',
              '',
              '分 key 要点：',
              '- commercial_white：纯白或极浅灰无缝棚拍底、柔光均匀、主体居中电商留白；不得延续 DNA 里的深色全图底/夜景墙/水泥场。工业风等只写在商品布光与材质对比上。',
              '- selling_focus：近景/微距、浅景深、对准核心结构；背景极简虚化或棚拍，不抢细节。',
              '- lifestyle：可辨认生活/使用环境，背景虚化；释放 DNA 中未展开的生活联想，但仍主体清晰。',
              '- comparison：对比或效果暗示构图、信息层级；勿编造数据。',
              '- detail：角度/陈列/做工细节；背景干净，不大场景叙事。',
              '- atmosphere：允许强氛围光、冷暖对比、情绪环境；DNA 里压抑的「暗夜/霓虹/工业墙」气质优先在本条落地，但仍需商品可识别。',
              '',
              '硬约束：',
              '- 6 组之间构图与光影差异清晰；都适合电商素材。',
              '- 若信息不足，保守可执行，不胡编参数。',
              '- 只输出 JSON。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `输出语言：${String(language || '简体中文')}`,
              hotSellingStyle?.title || hotSellingStyle?.description
                ? `用户选择的爆款风格：${String(hotSellingStyle.title || '').trim()} —— ${String(hotSellingStyle.description || '').trim()}`
                : '',
              productAnalysisNotes ? `商品分析笔记：\n${String(productAnalysisNotes).slice(0, 6000)}` : '',
              product ? `商品结构化信息：${JSON.stringify(product)}` : '',
              negativePrompt ? `可参考的负面词（不必原样重复）：${String(negativePrompt).slice(0, 2000)}` : '',
              '【基础出图描述｜拍法基因 DNA，以下为 6 条增量的共同基底】',
              bp.slice(0, 12000),
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
      },
    })

    const rawList = Array.isArray(data?.scenes) ? data.scenes : []
    const byKey = new Map<string, any>()
    for (const row of rawList) {
      const k = String(row?.key || '').trim()
      if (k) byKey.set(k, row)
    }

    const scenes = KEYS.map((k) => {
      const row = byKey.get(k) || {}
      return {
        key: k,
        title: String(row.title || TITLES[k] || k).trim() || TITLES[k],
        description: String(row.description || '').trim() || '适合电商投放的画面变体。',
        imagePrompt: String(row.imagePrompt || row.prompt || '').trim() || `强调「${TITLES[k]}」的构图与光影，与基础描述一致延展。`,
      }
    })

    return res.status(200).json({ success: true, scenes })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}
