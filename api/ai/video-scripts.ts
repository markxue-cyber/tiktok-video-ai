import { callOpenAICompatJSON } from '../lib/openaiCompat'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { product, language, refImage } = req.body || {}
    if (!product) return res.status(400).json({ success: false, error: '缺少product' })
    if (!refImage) return res.status(400).json({ success: false, error: '缺少refImage' })

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        scripts: [
          '脚本1：开箱展示 + 3个核心卖点快速扫过 + 结尾引导下单',
          '脚本2：痛点场景切入 + 对比前后效果 + 关键参数强调',
          '脚本3：真人口播测评 + 细节特写 + 结尾优惠信息',
        ],
        _mock: true,
      })
    }

    const data = await callOpenAICompatJSON<{ scripts: string[] }>({
      apiKey,
      baseUrl,
      request: {
        model,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是短视频编导（偏电商带货）。',
              '任务：基于商品图 + 商品信息，生成3条不同风格的“商品视频脚本/口播分镜提示”。',
              '要求：',
              '- 严格输出JSON：{"scripts":[...]}',
              '- 每条脚本 6-10 句，节奏快，适合10-15秒竖屏短视频。',
              '- 包含：开场钩子（1句）/ 关键卖点（3-5句）/ 场景与细节（2-3句）/ 结尾行动号召（1句）。',
              '- 避免夸大承诺与违规医疗/功效暗示，表达要真实可用。',
              '- 三条脚本差异要明显：例如“开箱测评/痛点对比/真人口播”三种风格。',
              '- 不要输出除JSON以外任何内容。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `输出语言：${language || product.language || '简体中文'}` },
              { type: 'text', text: `商品信息：${JSON.stringify(product)}` },
              { type: 'text', text: '请结合商品图生成更贴近真实外观与使用场景的脚本。' },
              { type: 'image_url', image_url: { url: String(refImage) } },
            ],
          },
        ],
      },
    })

    const scripts = Array.isArray(data.scripts) ? data.scripts.filter(Boolean).slice(0, 3) : []
    if (scripts.length < 3) throw new Error('脚本生成结果不足3条')

    return res.status(200).json({ success: true, scripts })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

