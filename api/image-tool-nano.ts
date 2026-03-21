// Vercel Serverless — 高清放大 / 图片压缩 / 图片翻译（Nano Banana 2 + 参考图），计费同图片生成
import { checkAndConsume, finalizeConsumption } from './_billing.js'

function mustEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function supabaseBaseUrl() {
  return String(mustEnv('SUPABASE_URL')).replace(/\/$/, '')
}

async function writeTaskRow(payload: any) {
  try {
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    await fetch(`${supabaseBaseUrl()}/rest/v1/generation_tasks`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([payload]),
    })
  } catch {
    // ignore
  }
}

async function ensureModelEnabled(modelId: string, type: 'video' | 'image' | 'llm') {
  try {
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    const resp = await fetch(
      `${supabaseBaseUrl()}/rest/v1/model_controls?model_id=eq.${encodeURIComponent(modelId)}&type=eq.${encodeURIComponent(type)}&select=enabled`,
      {
        method: 'GET',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    )
    const text = await resp.text()
    const data = (() => {
      try {
        return text ? JSON.parse(text) : []
      } catch {
        return []
      }
    })()
    const row = Array.isArray(data) ? data[0] : null
    if (row && row.enabled === false) return false
    return true
  } catch {
    return true
  }
}

const MODEL = 'nano-banana-2'

const TRANSLATE_LANG: Record<string, string> = {
  zh: 'Simplified Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  id: 'Indonesian',
  ms: 'Malay',
  th: 'Thai',
  vi: 'Vietnamese',
  fil: 'Filipino',
  'pt-BR': 'Brazilian Portuguese',
}

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

function upscalePrompt(scale: string, fmt: string) {
  const mult = scale === '4' ? '4' : '2'
  const out = fmt === 'jpeg' ? 'JPEG' : 'PNG'
  return [
    `Task: High-quality image upscaling. Upscale the reference image by exactly ${mult}x in each dimension.`,
    'Preserve subject identity, textures, edges, and fine details. Reduce blur and compression artifacts where possible.',
    'Do not crop, do not change aspect ratio, do not add new objects or text.',
    `Output a single raster image as ${out}.`,
  ].join(' ')
}

function compressPrompt(percent: number, fmt: string) {
  const out = fmt === 'jpeg' ? 'JPEG' : 'PNG'
  return [
    `Task: Resize/compress the reference image so its longer side is approximately ${percent}% of the original longer side (scale proportionally).`,
    'Keep the same scene, composition, and subject; do not crop to a different framing unless needed to match aspect.',
    `Output a single raster image as ${out}.`,
  ].join(' ')
}

function translatePrompt(langEn: string, fmt: string) {
  const out = fmt === 'jpeg' ? 'JPEG' : 'PNG'
  return [
    `Task: Translate all visible text in the reference image into ${langEn}.`,
    'Replace text in-place while preserving layout, typography style, background, and all non-text pixels.',
    'Do not add watermarks or unrelated text.',
    `Output a single raster image as ${out}.`,
  ].join(' ')
}

export default async function handler(req: any, res: any) {
  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    if (!apiKey) return res.status(500).json({ success: false, error: 'API Key未配置' })

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

    const billableConfirmed = String(req.headers?.['x-confirm-billable'] || '').toLowerCase() === 'true'
    if (!billableConfirmed) {
      return res.status(403).json({ success: false, error: '已拦截：缺少 X-Confirm-Billable: true（防止误触发计费）' })
    }

    const consumed = await checkAndConsume(req, { type: 'image' })
    if (consumed.already) return res.status(200).json({ success: true, ...(consumed.result || {}) })

    const body = req.body || {}
    const mode = String(body.mode || '').trim()
    const ref = String(body.refImage || '').trim()
    if (!ref) {
      return res.status(200).json({ success: false, error: '缺少参考图 refImage', code: 'BAD_REQUEST' })
    }

    let prompt = ''
    let feature = 'image_tool_nano'
    let safeBase = 1536

    const fmtRaw = String(body.outputFormat || 'png').toLowerCase()
    const fmt = fmtRaw === 'jpeg' || fmtRaw === 'jpg' ? 'jpeg' : 'png'

    if (mode === 'upscale') {
      feature = 'image_upscale'
      const scale = String(body.scale || '2') === '4' ? '4' : '2'
      safeBase = scale === '4' ? 2048 : 1536
      prompt = upscalePrompt(scale, fmt)
    } else if (mode === 'compress') {
      feature = 'image_compress'
      const p = clampInt(Number(body.compressPercent), 1, 100)
      safeBase = Math.max(256, Math.min(2048, Math.round(2048 * (p / 100))))
      prompt = compressPrompt(p, fmt)
    } else if (mode === 'translate') {
      feature = 'image_translate'
      const code = String(body.targetLang || '').trim()
      const langEn = TRANSLATE_LANG[code]
      if (!langEn) {
        return res.status(200).json({ success: false, error: '不支持的目标语言', code: 'BAD_REQUEST' })
      }
      safeBase = 2048
      prompt = translatePrompt(langEn, fmt)
    } else {
      return res.status(200).json({ success: false, error: '无效的 mode', code: 'BAD_REQUEST' })
    }

    const reqSize = `${safeBase}x${safeBase}`

    const refFields = {
      image: ref,
      input_image: ref,
      reference_image: ref,
      image_url: ref,
      input_image_url: ref,
      reference_image_url: ref,
    }

    const enabled = await ensureModelEnabled(MODEL, 'image')
    if (!enabled) {
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: MODEL,
        status: 'failed',
        provider_task_id: null,
        output_url: null,
        raw: { reason: 'model disabled by admin', feature },
      })
      return res.status(200).json({ success: false, error: `模型 ${MODEL} 已被后台禁用`, code: 'MODEL_UNAVAILABLE' })
    }

    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const upstreamResp = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        model: MODEL,
        n: 1,
        count: 1,
        num_images: 1,
        size: reqSize,
        width: safeBase,
        height: safeBase,
        ...refFields,
      }),
    })
    const rawText = await upstreamResp.text()
    const data = (() => {
      try {
        return rawText ? JSON.parse(rawText) : null
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
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: MODEL,
        status: 'failed',
        provider_task_id: null,
        output_url: null,
        raw: { upstream_status: upstreamResp.status, upstream: data || rawText, feature },
      })
      return res.status(200).json({ success: false, error: msg, code: 'UPSTREAM_ERROR', raw: data || rawText })
    }

    const pick = (v: any) => (typeof v === 'string' ? v : '')
    const first = Array.isArray(data?.data) ? data.data[0] : null
    const url = pick(first?.url) || pick(data?.output) || pick(data?.result?.url)
    const b64 = pick(first?.b64_json) || pick(data?.b64_json) || pick(data?.image_base64)

    const mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png'
    const outFmt = fmt === 'jpeg' ? 'jpeg' : 'png'

    if (b64) {
      const result = { imageUrl: `data:${mime};base64,${b64}`, size: reqSize, outputFormat: outFmt }
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: MODEL,
        status: 'succeeded',
        provider_task_id: null,
        output_url: result.imageUrl,
        raw: { ...data, feature },
      })
      await finalizeConsumption(req, result)
      return res.status(200).json({ success: true, ...result })
    }
    if (url) {
      const result = { imageUrl: url, size: reqSize, outputFormat: outFmt }
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: MODEL,
        status: 'succeeded',
        provider_task_id: null,
        output_url: url,
        raw: { ...data, feature },
      })
      await finalizeConsumption(req, result)
      return res.status(200).json({ success: true, ...result })
    }

    await writeTaskRow({
      user_id: consumed?.user?.id || null,
      type: 'image',
      model: MODEL,
      status: 'failed',
      provider_task_id: null,
      output_url: null,
      raw: data || rawText,
    })
    return res.status(200).json({
      success: false,
      error: '上游未返回可识别的图片地址（url/b64_json）',
      code: 'NO_OUTPUT',
      raw: data || rawText,
    })
  } catch (e: any) {
    const msg = String(e?.message || 'Unknown error')
    let code = 'UNKNOWN'
    const t = msg.toLowerCase()
    if (t.includes('今日额度已用尽') || t.includes('upgrade') || t.includes('quota')) code = 'QUOTA_EXHAUSTED'
    else if (t.includes('timeout') || t.includes('超时')) code = 'UPSTREAM_TIMEOUT'
    return res.status(200).json({ success: false, error: msg, code })
  }
}
