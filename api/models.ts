// Vercel Serverless Function - Proxy: list available models (OpenAI-compatible)
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    if (!apiKey) return res.status(500).json({ success: false, error: 'API Key未配置' })

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
    return res.status(200).json({ success: true, data })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

