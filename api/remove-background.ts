// Vercel Serverless — 去除背景（Nano Banana 2 + 参考图），计费同图片生成
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

const REMOVE_BG_MODEL = 'nano-banana-2'

const REMOVE_BG_PROMPT = (outputFormat: string) =>
  [
    'Task: Remove the background from the main subject in the reference image.',
    'Keep only the foreground subject with clean edges. Use a fully transparent background (alpha channel).',
    'Do not add a new background, floor, shadow fill, or gradient behind the subject.',
    'Preserve colors, texture, and fine details of the subject.',
    outputFormat === 'webp'
      ? 'Preferred output: WEBP with transparency if supported.'
      : 'Preferred output: PNG with transparency.',
  ].join(' ')

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

    const { refImage, resolution, outputFormat } = req.body || {}
    const ref = String(refImage || '').trim()
    if (!ref) {
      return res.status(200).json({ success: false, error: '缺少参考图 refImage', code: 'BAD_REQUEST' })
    }

    const resStr = String(resolution || '1024')
    const safeBase = resStr === '2048' ? 2048 : 1024
    const reqSize = `${safeBase}x${safeBase}`

    const fmt = String(outputFormat || 'png').toLowerCase() === 'webp' ? 'webp' : 'png'
    const prompt = REMOVE_BG_PROMPT(fmt)

    const refFields = {
      image: ref,
      input_image: ref,
      reference_image: ref,
      image_url: ref,
      input_image_url: ref,
      reference_image_url: ref,
    }

    const usedModel = REMOVE_BG_MODEL
    const enabled = await ensureModelEnabled(usedModel, 'image')
    if (!enabled) {
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: usedModel,
        status: 'failed',
        provider_task_id: null,
        output_url: null,
        raw: { reason: 'model disabled by admin', feature: 'remove_background' },
      })
      return res.status(200).json({ success: false, error: `模型 ${usedModel} 已被后台禁用`, code: 'MODEL_UNAVAILABLE' })
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
        model: usedModel,
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
        model: usedModel,
        status: 'failed',
        provider_task_id: null,
        output_url: null,
        raw: { upstream_status: upstreamResp.status, upstream: data || rawText, feature: 'remove_background' },
      })
      return res.status(200).json({ success: false, error: msg, code: 'UPSTREAM_ERROR', raw: data || rawText })
    }

    const pick = (v: any) => (typeof v === 'string' ? v : '')
    const first = Array.isArray(data?.data) ? data.data[0] : null
    const url = pick(first?.url) || pick(data?.output) || pick(data?.result?.url)
    const b64 = pick(first?.b64_json) || pick(data?.b64_json) || pick(data?.image_base64)

    if (b64) {
      const result = { imageUrl: `data:image/png;base64,${b64}`, size: reqSize, outputFormat: fmt }
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: usedModel,
        status: 'succeeded',
        provider_task_id: null,
        output_url: result.imageUrl,
        raw: { ...data, feature: 'remove_background' },
      })
      await finalizeConsumption(req, result)
      return res.status(200).json({ success: true, ...result })
    }
    if (url) {
      const result = { imageUrl: url, size: reqSize, outputFormat: fmt }
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: usedModel,
        status: 'succeeded',
        provider_task_id: null,
        output_url: url,
        raw: { ...data, feature: 'remove_background' },
      })
      await finalizeConsumption(req, result)
      return res.status(200).json({ success: true, ...result })
    }

    await writeTaskRow({
      user_id: consumed?.user?.id || null,
      type: 'image',
      model: usedModel,
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
