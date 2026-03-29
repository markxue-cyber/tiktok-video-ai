import { normalizeGatewayId, resolveAggregateGateway } from './_aggregateGateway.js'

// Vercel Serverless Function - Proxy: list available models (OpenAI-compatible)
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const q = (req.query?.gateway || req.query?.provider || '') as string
    const gw = resolveAggregateGateway(normalizeGatewayId(q || 'xiaodoubao'))
    const apiKey = gw.apiKey
    const baseUrl = gw.baseUrl
    if (!apiKey) {
      return res.status(200).json({
        success: false,
        error:
          gw.id === 'siliconflow'
            ? '硅基流动未配置：请设置环境变量 SILICONFLOW_API_KEY'
            : gw.id === 'bytedance'
              ? '字节跳动(方舟)未配置：请设置环境变量 BYTEDANCE_ARK_API_KEY'
              : '小豆包未配置：请设置环境变量 XIAO_DOU_BAO_API_KEY',
        code: 'API_KEY_MISSING',
        gateway: gw.id,
      })
    }

    const url = baseUrl.replace(/\/$/, '') + '/models'
    const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    const text = await r.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      data = { _raw: text }
    }
    if (!r.ok) {
      return res.status(200).json({ success: false, error: data?.error?.message || data?.message || `请求失败(${r.status})`, raw: data })
    }
    /** 方舟 OpenAI /images/generations 需 ep-m- 接入点；勿下发裸模型名或非 ep-m- 的 ep- */
    const arkImg =
      gw.id === 'bytedance' && gw.defaultImageModel && /^ep-m-/i.test(String(gw.defaultImageModel).trim())
        ? String(gw.defaultImageModel).trim()
        : undefined
    return res.status(200).json({
      success: true,
      data,
      gatewayDefaults: {
        chatModel: gw.chatModel,
        ...(arkImg ? { imageModel: arkImg } : {}),
      },
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

