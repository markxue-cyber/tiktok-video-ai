import { callOpenAICompatJSON } from '../_lib/openaiCompat'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { refImage, language, kind } = req.body || {}

    if (!refImage) return res.status(400).json({ success: false, error: '缺少refImage' })
    if (!apiKey) {
      // 允许前端联调 UI：未配置 key 时返回 mock
      return res.status(200).json({
        success: true,
        data: {
          name: '示例产品',
          category: '电子产品',
          sellingPoints: '高性能 / 高颜值 / 易上手',
          targetAudience: '年轻用户',
          language: language || '简体中文',
          kind: kind || 'video',
          _mock: true,
        },
      })
    }

    const data = await callOpenAICompatJSON<{
      name: string
      category: string
      sellingPoints: string
      targetAudience: string
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
            content:
              '你是资深电商短视频文案策划。你会从参考图与用户要求中提取商品信息，并严格用JSON输出，不要输出任何多余文本。',
          },
          {
            role: 'user',
            content: [
              `请解析这张商品参考图，输出4个字段：name, category, sellingPoints, targetAudience。`,
              `输出语言：${language || '简体中文'}`,
              `场景：${kind || 'video'}（video=商品视频脚本/提示词；image=商品图片提示词）`,
              `参考图(可能是dataURL)：${String(refImage).slice(0, 2000)}`,
            ].join('\n'),
          },
        ],
      },
    })

    return res.status(200).json({
      success: true,
      data: {
        ...data,
        language: language || '简体中文',
        kind: kind || 'video',
      },
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

