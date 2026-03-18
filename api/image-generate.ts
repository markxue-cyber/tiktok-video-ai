// Vercel Serverless Function - 图片生成API（聚合API / OpenAI兼容）
import { checkAndConsume, finalizeConsumption } from './_billing'
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

    // Auth + subscription + idempotency + daily quota
    const consumed = await checkAndConsume(req, { type: 'image' })
    if (consumed.already) return res.status(200).json({ success: true, ...(consumed.result || {}) })

    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const { prompt, model, size, resolution, aspect_ratio, refImage, negativePrompt, negative_prompt } = req.body || {}
    const neg = String(negativePrompt || negative_prompt || '').trim()

    const modelId = String(model || '').toLowerCase()
    const modelFamily = (() => {
      if (!modelId) return 'unknown'
      if (modelId.includes('seedream')) return 'seedream'
      if (modelId.includes('flux')) return 'flux'
      if (modelId.includes('nano-banana')) return 'nano-banana'
      if (modelId.includes('gpt-image') || modelId.includes('dall-e')) return 'openai-images'
      if (modelId.includes('ideogram')) return 'ideogram'
      if (modelId.includes('recraft')) return 'recraft'
      if (modelId.includes('midjourney') || modelId.includes('mj_')) return 'midjourney'
      if (modelId.includes('qwen-image')) return 'qwen-image'
      if (modelId.includes('kolors')) return 'kolors'
      if (modelId.includes('stable-diffusion') || modelId.includes('sd')) return 'stable-diffusion'
      return 'other'
    })()

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
    const [reqW, reqH] = reqSize.split('x').map((x) => Number.parseInt(x, 10))

    // 参考图字段：尽量覆盖常见聚合适配；按家族做一丢丢偏好，提升命中率
    const refFields = (() => {
      if (!refImage) return {}
      // 注意：部分上游实现对数组类型字段处理不严谨，可能触发类型断言 panic。
      // 这里优先只透传“字符串字段”，避免 images/input_images 这类数组字段导致上游崩溃。
      const base = {
        image: refImage,
        input_image: refImage,
        reference_image: refImage,
        image_url: refImage,
        input_image_url: refImage,
        reference_image_url: refImage,
      }
      if (modelFamily === 'flux') {
        return { ...base, image: refImage, input_image: refImage }
      }
      if (modelFamily === 'seedream') {
        return { ...base, reference_image: refImage }
      }
      return base
    })()

    const negativeFields = {
      // 各家聚合/适配字段命名可能不同，尽量多字段透传
      negative_prompt: neg || undefined,
      negativePrompt: neg || undefined,
      negative: neg || undefined,
    }

    const sizeFields = {
      size: reqSize,
      width: Number.isFinite(reqW) ? reqW : undefined,
      height: Number.isFinite(reqH) ? reqH : undefined,
    }

    const upstreamResp = await fetch(`${baseUrl.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt || '生成一张商品展示图',
        ...negativeFields,
        model: model || undefined,
        ...sizeFields,
        // 尝试以常见字段名透传参考图（不同聚合/模型可能字段不同）
        ...refFields,
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
      const result = { imageUrl: `data:image/png;base64,${b64}`, size: reqSize }
      await finalizeConsumption(req, result)
      return res.status(200).json({ success: true, ...result })
    }
    if (url) {
      const result = { imageUrl: url, size: reqSize }
      await finalizeConsumption(req, result)
      return res.status(200).json({ success: true, ...result })
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

