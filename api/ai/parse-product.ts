import { callOpenAICompatJSON } from '../lib/openaiCompat'

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
            content: [
              '你是资深电商短视频策划与商品理解助手。',
              '任务：根据商品图识别并总结商品信息。',
              '要求：',
              '- 必须严格输出JSON对象：{"name":"...","category":"...","sellingPoints":"...","targetAudience":"..."}',
              '- sellingPoints 用一句话概括核心卖点（可用顿号/斜杠分隔短语），避免空泛词。',
              '- category 用电商类目短语（如“护肤品-精华”“3C-耳机”“家居-收纳”）。',
              '- targetAudience 用人群画像短语（如“通勤白领”“学生党”“宝妈”“健身人群”）。',
              '- 不要输出除JSON以外任何内容。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `输出语言：${language || '简体中文'}` },
              { type: 'text', text: `场景：${kind || 'video'}（video=视频脚本/提示词；image=图片提示词）` },
              { type: 'text', text: '请基于下方商品图识别信息并输出JSON。' },
              { type: 'image_url', image_url: { url: String(refImage) } },
            ],
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

