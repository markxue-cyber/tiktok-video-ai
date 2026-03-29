import { normalizeGatewayId, resolveAggregateGateway } from './_aggregateGateway.js'

function modelsListRows(parsed: any): any[] {
  const inner = parsed?.data
  if (Array.isArray(inner?.data)) return inner.data
  if (Array.isArray(inner)) return inner
  if (Array.isArray(parsed?.data)) return parsed.data
  return []
}

/** 方舟 /models 单条：尽量取出控制台可见的模型名（非裸 id） */
function arkModelRowDisplayName(m: any): string {
  if (!m || typeof m !== 'object') return ''
  const id = String(m.id || '').trim()
  const meta = m.metadata && typeof m.metadata === 'object' ? (m.metadata as { name?: string }).name : ''
  const candidates = [m.name, m.model_name, m.display_name, m.title, meta]
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (s && s !== id && s.length <= 120) return s
  }
  const ob = String(m.owned_by || '').trim()
  if (ob && ob !== id && ob.length < 80 && !/^organization/i.test(ob)) return ob
  return ''
}

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
    /** 下发默认出图 id 供下拉里展示；须为 ep- 接入点（可为 ep-m- 或 ep-日期…），勿下发裸模型名 */
    const arkImg =
      gw.id === 'bytedance' && gw.defaultImageModel && /^ep-/i.test(String(gw.defaultImageModel).trim())
        ? String(gw.defaultImageModel).trim()
        : undefined

    /** 出图下拉里展示名：优先 BYTEDANCE_ARK_IMAGE_MODEL_LABEL；否则在 /models 里按接入点 id 反查名称（如 Doubao-Seedream-4.0） */
    let arkImageLabel: string | undefined
    if (gw.id === 'bytedance' && arkImg) {
      const envLabel = String(gw.defaultImageModelLabel || '').trim()
      if (envLabel) {
        arkImageLabel = envLabel
      } else {
        const hit = modelsListRows(data).find((x: any) => String(x?.id || '').trim() === arkImg)
        const fromList = hit ? arkModelRowDisplayName(hit) : ''
        arkImageLabel = fromList || undefined
      }
    }

    return res.status(200).json({
      success: true,
      data,
      gatewayDefaults: {
        chatModel: gw.chatModel,
        ...(arkImg ? { imageModel: arkImg } : {}),
        ...(arkImageLabel ? { imageModelLabel: arkImageLabel } : {}),
      },
    })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

