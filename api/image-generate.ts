// Vercel Serverless Function - 图片生成API（聚合API / OpenAI兼容）
import { CREDITS_PER_IMAGE, checkAndConsume, finalizeCreditsBilling, refundPrepaidCredits } from './_billing.js'

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
    // never block generation if task logging fails
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/** OpenAI 兼容：是否已拿到可落盘的图片输出 */
function hasImageOutput(data: any): boolean {
  if (!data || typeof data !== 'object') return false
  const pick = (v: any) => (typeof v === 'string' ? v : '')
  const first = Array.isArray(data.data) ? data.data[0] : null
  const url = pick(first?.url) || pick(data.output) || pick(data?.result?.url)
  const b64 = pick(first?.b64_json) || pick(data?.b64_json) || pick(data?.image_base64)
  return !!(url || b64)
}

/** 上游 JSON 里显式报错（含 HTTP 200 但 body 为 new_api_error 等情况） */
function hasExplicitUpstreamErrorBody(data: any): boolean {
  if (!data || typeof data !== 'object') return false
  if (data.error != null) return true
  const c = String((data as any).code || '').toLowerCase()
  return c === 'bad_response_body'
}

function extractUpstreamMsg(data: any, rawText: string, status: number): string {
  const errObj = data?.error
  const fromObj =
    (errObj && typeof errObj === 'object' && (errObj as any).message) ||
    (typeof errObj === 'string' ? errObj : '') ||
    (typeof data?.message === 'string' ? data.message : '') ||
    ''
  if (fromObj) return String(fromObj)
  if (typeof rawText === 'string' && rawText) {
    try {
      const p = JSON.parse(rawText)
      return String(p?.error?.message || p?.message || rawText.slice(0, 1000))
    } catch {
      return rawText.slice(0, 1000)
    }
  }
  return `上游错误(${status})`
}

/** 聚合网关瞬时异常：空/截断 body、解析失败等，可重试 */
function isTransientUpstreamImageError(msg: string, data: any): boolean {
  const m = String(msg || '').toLowerCase()
  const c = String((data?.error && typeof data.error === 'object' && (data.error as any).code) || data?.code || '').toLowerCase()
  return (
    c === 'bad_response_body' ||
    m.includes('unexpected end of json') ||
    m.includes('bad_response_body') ||
    (m.includes('负载') && m.includes('饱和')) ||
    m.includes('socket hang up') ||
    m.includes('econnreset') ||
    m.includes('bad gateway') ||
    m.includes('service unavailable')
  )
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

    const { prompt, model, size, resolution, aspect_ratio, refImage, negativePrompt, negative_prompt, n, count, num_images } = req.body || {}
    const nRaw = Number(n ?? count ?? num_images ?? 1)
    const imageCount = Number.isFinite(nRaw) ? Math.max(1, Math.min(4, Math.floor(nRaw))) : 1
    const creditsCost = CREDITS_PER_IMAGE * imageCount

    let consumed: any
    try {
      consumed = await checkAndConsume(req, { type: 'image', creditsCost })
    } catch (e: any) {
      const msg = String(e?.message || '额度校验失败')
      const t = msg.toLowerCase()
      const code =
        t.includes('积分不足') ? 'INSUFFICIENT_CREDITS' : t.includes('今日额度已用尽') ? 'QUOTA_EXHAUSTED' : 'UNKNOWN'
      return res.status(200).json({ success: false, error: msg, code })
    }
    if (consumed.already) return res.status(200).json({ success: true, ...(consumed.result || {}) })

    let needBillingRelease = true
    try {
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
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

    let reqSize = computeSize()
    // DALL·E 3 only accepts fixed sizes: 1024x1024 / 1024x1792 / 1792x1024
    if (modelId.includes('dall-e-3') || modelId.includes('dalle-3')) {
      if (aspect === '9:16' || aspect === '3:4' || aspect === '2:3') reqSize = '1024x1792'
      else if (aspect === '16:9' || aspect === '4:3' || aspect === '3:2' || aspect === '21:9') reqSize = '1792x1024'
      else reqSize = '1024x1024'
    }
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

    const callUpstream = async (modelToUse?: string) => {
      const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt || '生成一张商品展示图',
          ...negativeFields,
          model: modelToUse || undefined,
          n: imageCount,
          count: imageCount,
          num_images: imageCount,
          ...sizeFields,
          // 尝试以常见字段名透传参考图（不同聚合/模型可能字段不同）
          ...refFields,
        }),
      })
      const raw = await resp.text()
      const parsed = (() => {
        try {
          return raw ? JSON.parse(raw) : null
        } catch {
          return null
        }
      })()
      return { resp, raw, parsed }
    }

    let usedModel = String(model || '').trim()
    if (usedModel) {
      const enabled = await ensureModelEnabled(usedModel, 'image')
      if (!enabled) {
        await writeTaskRow({
          user_id: consumed?.user?.id || null,
          type: 'image',
          model: usedModel,
          status: 'failed',
          provider_task_id: null,
          output_url: null,
          raw: { reason: 'model disabled by admin' },
        })
        return res.status(200).json({ success: false, error: `模型 ${usedModel} 已被后台禁用`, code: 'MODEL_UNAVAILABLE' })
      }
    }
    let { resp: upstreamResp, raw: rawText, parsed: data } = await callUpstream(usedModel || undefined)

    // 同一模型下对瞬时上游错误做有限重试（截断 JSON、bad_response_body、负载饱和等）
    for (let attempt = 0; attempt < 2; attempt++) {
      const msgProbe = extractUpstreamMsg(data, rawText, upstreamResp.status)
      const failed =
        !upstreamResp.ok ||
        (upstreamResp.ok && hasExplicitUpstreamErrorBody(data) && !hasImageOutput(data))
      if (!failed) break
      if (!isTransientUpstreamImageError(msgProbe, data)) break
      await sleep(700 + attempt * 500)
      const r = await callUpstream(usedModel || undefined)
      upstreamResp = r.resp
      rawText = r.raw
      data = r.parsed
    }

    let errorCode = 'UPSTREAM_ERROR'
    if (!upstreamResp.ok) {
      let msg =
        data?.error?.message ||
        data?.message ||
        (typeof rawText === 'string' && rawText.slice(0, 1000)) ||
        `上游错误(${upstreamResp.status})`

      const text = String(msg || '').toLowerCase()
      const modelInvalid =
        text.includes('model') &&
        (text.includes('does not exist') || text.includes('invalid field') || text.includes('not in') || text.includes('不存在'))

      // 自动兜底：当用户选择了当前通道不支持的模型（如 midjourney）时，回退到稳定可用模型再试一次。
      if (modelInvalid) {
        const fallbackModel = String(process.env.IMAGE_FALLBACK_MODEL || 'seedream').trim()
        if (fallbackModel && fallbackModel !== usedModel) {
          const retried = await callUpstream(fallbackModel)
          if (retried.resp.ok) {
            upstreamResp = retried.resp
            rawText = retried.raw
            data = retried.parsed
            usedModel = fallbackModel
          } else {
            msg =
              retried.parsed?.error?.message ||
              retried.parsed?.message ||
              (typeof retried.raw === 'string' && retried.raw.slice(0, 1000)) ||
              msg
          }
        }
      }
      if (modelInvalid) {
        // 当选择模型导致“模型不存在/不支持”且最终仍失败，归因为模型不可用。
        errorCode = 'MODEL_UNAVAILABLE'
      }
    }

    if (!upstreamResp.ok) {
      const msgFinal =
        data?.error?.message ||
        data?.message ||
        (typeof rawText === 'string' && rawText.slice(0, 1000)) ||
        `上游错误(${upstreamResp.status})`
      const text = String(msgFinal || '').toLowerCase()
      const authInvalid =
        upstreamResp.status === 401 ||
        upstreamResp.status === 403 ||
        (text.includes('api key') && (text.includes('invalid') || text.includes('not valid'))) ||
        text.includes('invalid_api_key') ||
        text.includes('incorrect api key') ||
        text.includes('authentication')
      if (authInvalid) errorCode = 'AGGREGATE_API_KEY_INVALID'
      else if (text.includes('今日额度已用尽') || text.includes('upgrade') || text.includes('quota')) errorCode = 'QUOTA_EXHAUSTED'
      else if (text.includes('timeout') || text.includes('超时')) errorCode = 'UPSTREAM_TIMEOUT'
      else if (isTransientUpstreamImageError(msgFinal, data) || text.includes('bad_response_body')) errorCode = 'UPSTREAM_BAD_RESPONSE'
      else if (!errorCode || errorCode === 'UPSTREAM_ERROR') errorCode = 'UPSTREAM_ERROR'
      const userFacingError =
        errorCode === 'AGGREGATE_API_KEY_INVALID'
          ? '图片服务上游密钥无效或已过期（需在服务器/Vercel 环境变量中配置有效的 XIAO_DOU_BAO_API_KEY，非用户操作问题）。'
          : errorCode === 'UPSTREAM_BAD_RESPONSE'
            ? '上游返回数据异常，请稍后重试。若多次失败可联系客服。'
            : msgFinal
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: usedModel || model || null,
        status: 'failed',
        provider_task_id: null,
        output_url: null,
        raw: { upstream_status: upstreamResp.status, upstream: data || rawText },
      })
      return res.status(200).json({ success: false, error: userFacingError, code: errorCode, raw: data || rawText })
    }

    // HTTP 200 但 body 为错误（部分聚合网关用 JSON 错误对象而非 4xx）
    if (upstreamResp.ok && !hasImageOutput(data) && hasExplicitUpstreamErrorBody(data)) {
      const msgFinal = extractUpstreamMsg(data, rawText, upstreamResp.status)
      const text = String(msgFinal || '').toLowerCase()
      let errCode = 'UPSTREAM_ERROR'
      const authInvalid =
        (text.includes('api key') && (text.includes('invalid') || text.includes('not valid'))) ||
        text.includes('invalid_api_key') ||
        text.includes('incorrect api key') ||
        text.includes('authentication')
      if (authInvalid) errCode = 'AGGREGATE_API_KEY_INVALID'
      else if (text.includes('今日额度已用尽') || text.includes('upgrade') || text.includes('quota')) errCode = 'QUOTA_EXHAUSTED'
      else if (text.includes('timeout') || text.includes('超时')) errCode = 'UPSTREAM_TIMEOUT'
      else if (isTransientUpstreamImageError(msgFinal, data) || text.includes('bad_response_body')) errCode = 'UPSTREAM_BAD_RESPONSE'
      const userFacingError =
        errCode === 'AGGREGATE_API_KEY_INVALID'
          ? '图片服务上游密钥无效或已过期（需在服务器/Vercel 环境变量中配置有效的 XIAO_DOU_BAO_API_KEY，非用户操作问题）。'
          : errCode === 'UPSTREAM_BAD_RESPONSE'
            ? '上游返回数据异常，请稍后重试。若多次失败可联系客服。'
            : msgFinal
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: usedModel || model || null,
        status: 'failed',
        provider_task_id: null,
        output_url: null,
        raw: { upstream_status: upstreamResp.status, upstream: data || rawText },
      })
      return res.status(200).json({ success: false, error: userFacingError, code: errCode, raw: data || rawText })
    }

    // OpenAI images API shape: { data: [{ url }] } or { data: [{ b64_json }] }
    const pick = (v) => (typeof v === 'string' ? v : '')
    const first = Array.isArray(data?.data) ? data.data[0] : null
    const url = pick(first?.url) || pick(data?.output) || pick(data?.result?.url)
    const b64 = pick(first?.b64_json) || pick(data?.b64_json) || pick(data?.image_base64)

    if (b64) {
      const result = { imageUrl: `data:image/png;base64,${b64}`, size: reqSize }
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: usedModel || model || null,
        status: 'succeeded',
        provider_task_id: null,
        output_url: result.imageUrl,
        raw: data,
      })
      await finalizeCreditsBilling(req, result)
      needBillingRelease = false
      return res.status(200).json({ success: true, ...result })
    }
    if (url) {
      const result = { imageUrl: url, size: reqSize }
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'image',
        model: usedModel || model || null,
        status: 'succeeded',
        provider_task_id: null,
        output_url: result.imageUrl,
        raw: data,
      })
      await finalizeCreditsBilling(req, result)
      needBillingRelease = false
      return res.status(200).json({ success: true, ...result })
    }

    await writeTaskRow({
      user_id: consumed?.user?.id || null,
      type: 'image',
      model: model || null,
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
    } finally {
      if (needBillingRelease) await refundPrepaidCredits(req).catch(() => {})
    }
  } catch (e) {
    const msg = String(e?.message || 'Unknown error')
    let code = 'UNKNOWN'
    const t = msg.toLowerCase()
    if (t.includes('请先完成本产品内') || t.includes('付费订单')) code = 'PAYMENT_REQUIRED'
    else if (t.includes('积分不足')) code = 'INSUFFICIENT_CREDITS'
    else if (t.includes('今日额度已用尽') || t.includes('upgrade') || t.includes('quota')) code = 'QUOTA_EXHAUSTED'
    else if (t.includes('timeout') || t.includes('超时')) code = 'UPSTREAM_TIMEOUT'
    else if (t.includes('model') && (t.includes('does not exist') || t.includes('invalid') || t.includes('not in'))) code = 'MODEL_UNAVAILABLE'
    return res.status(200).json({ success: false, error: msg, code })
  }
}

