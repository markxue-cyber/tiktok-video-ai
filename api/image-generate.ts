// Vercel Serverless Function - 图片生成API（聚合API / OpenAI兼容）
export default async function handler(req, res) {
  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    if (!apiKey) return res.status(500).json({ success: false, error: 'API Key未配置' })

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

    // 保险栓：防止非用户确认的请求触发计费
    const billableConfirmed = String(req.headers?.['x-confirm-billable'] || '').toLowerCase() === 'true'
    if (!billableConfirmed) {
      return res.status(403).json({ success: false, error: '已拦截：缺少 X-Confirm-Billable: true（防止误触发计费）' })
    }

    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const { prompt, model, size, resolution, aspect_ratio, refImage, negativePrompt, negative_prompt } = req.body || {}
    const neg = String(negativePrompt || negative_prompt || '').trim()

    const aspect = String(aspect_ratio || '1:1')
    const resStr = String(resolution || '1024')
    const base = Number.parseInt(resStr, 10)
    const safeBase = Number.isFinite(base) && base > 0 ? base : 1024

    const roundTo = (n, m) => {
      const v = Math.round(n / m) * m
      return Math.max(m, v)
    }

    const computeSize = () => {
      // If frontend already passed an explicit size like "1024x1024", trust it.
      const s = String(size || '')
      if (/^\d{2,5}x\d{2,5}$/.test(s)) return s

      const [wRatio, hRatio] = aspect.split(':').map((x) => Number.parseFloat(x))
      if (!Number.isFinite(wRatio) || !Number.isFinite(hRatio) || wRatio <= 0 || hRatio <= 0) return `${safeBase}x${safeBase}`

      // Keep the larger side == safeBase
      const isLandscape = wRatio >= hRatio
      const longSide = safeBase
      const shortSide = (safeBase * Math.min(wRatio, hRatio)) / Math.max(wRatio, hRatio)
      const w = isLandscape ? longSide : shortSide
      const h = isLandscape ? shortSide : longSide

      // Many image models prefer multiples of 64.
      const ww = roundTo(w, 64)
      const hh = roundTo(h, 64)
      return `${ww}x${hh}`
    }

    const reqSize = computeSize()

    const upstreamResp = await fetch(`${baseUrl.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt || '生成一张商品展示图',
        // 各家聚合/适配字段命名可能不同，尽量多字段透传
        negative_prompt: neg || undefined,
        negativePrompt: neg || undefined,
        negative: neg || undefined,
        model: model || undefined,
        size: reqSize,
        // 尝试以常见字段名透传参考图（不同聚合/模型可能字段不同）
        image: refImage,
        input_image: refImage,
        reference_image: refImage,
      }),
    })

    const rawText = await upstreamResp.text()
    const data = (() => {
      try {
        return JSON.parse(rawText)
      } catch {
        return null
      }
    })()

    if (!upstreamResp.ok) {
      const msg =
        data?.error?.message ||
        data?.message ||
        (typeof rawText === 'string' && rawText.slice(0, 1000)) ||
        `上游错误(${upstreamResp.status})`
      return res.status(200).json({ success: false, error: msg, raw: data || rawText })
    }

    // OpenAI images API shape: { data: [{ url }] } or { data: [{ b64_json }] }
    const pick = (v) => (typeof v === 'string' ? v : '')
    const first = Array.isArray(data?.data) ? data.data[0] : null
    const url = pick(first?.url) || pick(data?.output) || pick(data?.result?.url)
    const b64 = pick(first?.b64_json) || pick(data?.b64_json) || pick(data?.image_base64)

    if (b64) {
      return res.status(200).json({ success: true, imageUrl: `data:image/png;base64,${b64}`, size: reqSize })
    }
    if (url) {
      return res.status(200).json({ success: true, imageUrl: url, size: reqSize })
    }

    return res.status(200).json({
      success: false,
      error: '上游未返回可识别的图片地址（url/b64_json）',
      raw: data || rawText,
    })
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || 'Unknown error' })
  }
}

