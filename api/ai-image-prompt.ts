import { callOpenAICompatJSON } from './lib/openaiCompat'

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
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是商品图片提示词专家。基于商品信息生成高质量图片生成提示词（包含主体、材质/光影、背景、构图、风格、细节、镜头语言）。严格输出JSON：{"prompt":"..."}。',
          },
          {
            role: 'user',
            content: [
              `输出语言：${language || product.language || '简体中文'}`,
              `商品信息：${JSON.stringify(product)}`,
              '请生成一段可直接用于图片生成模型的优化提示词，用户可编辑。',
            ].join('\n'),
          },
        ],
      },
    })

    if (!data.prompt) throw new Error('图片提示词为空')
    return res.status(200).json({ success: true, prompt: data.prompt })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

