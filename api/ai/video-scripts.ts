import { callOpenAICompatJSON } from '../_lib/openaiCompat'

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
            content:
              '你是短视频编导。基于商品信息生成3条不同风格的商品视频脚本。严格输出JSON：{"scripts":[...]}，每条脚本可直接粘贴到视频生成提示词里。',
          },
          {
            role: 'user',
            content: [
              `输出语言：${language || product.language || '简体中文'}`,
              `商品信息：${JSON.stringify(product)}`,
              '请生成3条不同风格脚本，突出卖点与节奏感。',
            ].join('\n'),
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

