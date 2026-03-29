/**
 * 硅基流动 /v1/images/generations 与 LinkAPI/豆包 OpenAI 形态差异的适配。
 * @see https://docs.siliconflow.com/en/api-reference/images/images-generations
 */

/** 按比例选硅基文档允许的 image_size（优先覆盖常见 FLUX.1-schnell 枚举） */
export function mapSiliconFlowImageSize(aspectRatio: string, modelId: string): string {
  const a = String(aspectRatio || '1:1').trim()
  const m = String(modelId || '').toLowerCase()

  if (m.includes('qwen/qwen-image') && !m.includes('edit')) {
    if (a === '9:16') return '928x1664'
    if (a === '16:9') return '1664x928'
    if (a === '3:4' || a === '4:3') return '1140x1472'
    return '1328x1328'
  }

  if (m.includes('z-image')) {
    if (a === '9:16') return '576x1024'
    if (a === '16:9') return '1024x576'
    if (a === '3:4') return '768x1024'
    return '512x512'
  }

  // FLUX.1-schnell 等常见枚举
  if (a === '9:16') return '576x1024'
  if (a === '16:9') return '1024x576'
  if (a === '3:4') return '768x1024'
  if (a === '4:3') return '1024x768'
  return '1024x1024'
}

export async function fetchUrlAsDataUrlForSiliconflow(
  imageUrl: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const u = String(imageUrl || '').trim()
  if (!u || (!u.startsWith('http://') && !u.startsWith('https://'))) return null
  try {
    const resp = await fetch(u, {
      signal,
      headers: { Accept: 'image/*,*/*' },
    })
    if (!resp.ok) return null
    const len = Number(resp.headers.get('content-length') || 0)
    if (len > maxBytes) return null
    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.length > maxBytes) return null
    const ct = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim() || 'image/jpeg'
    const b64 = buf.toString('base64')
    return `data:${ct};base64,${b64}`
  } catch {
    return null
  }
}

export async function buildSiliconFlowImagesGenerationsBody(input: {
  model: string
  prompt: string
  negative: string
  aspectRatio: string
  refImage?: string
  imageCount: number
  signal?: AbortSignal
}): Promise<Record<string, unknown>> {
  const usedModel = String(input.model || '').trim()
  const mid = usedModel.toLowerCase()
  const image_size = mapSiliconFlowImageSize(input.aspectRatio, usedModel)
  const neg = String(input.negative || '').trim()
  const n = Math.max(1, Math.min(4, Math.floor(input.imageCount || 1)))

  const body: Record<string, unknown> = {
    model: usedModel,
    prompt: input.prompt,
    image_size,
  }

  if (neg && (mid.includes('z-image') || mid.includes('qwen-image') || mid.includes('flux.2') || mid.includes('flux-1.1'))) {
    body.negative_prompt = neg
  }

  if (mid.includes('qwen/qwen-image') && !mid.includes('edit')) {
    body.batch_size = n
  }

  const ref = String(input.refImage || '').trim()
  if (ref) {
    let dataUrl: string | null = null
    if (ref.startsWith('data:')) {
      dataUrl = ref
    } else if (ref.startsWith('http://') || ref.startsWith('https://')) {
      dataUrl = await fetchUrlAsDataUrlForSiliconflow(ref, 6 * 1024 * 1024, input.signal)
    }
    if (dataUrl) {
      if (mid.includes('kontext')) {
        body.input_image = dataUrl
      } else if (mid.includes('qwen-image')) {
        body.image = dataUrl
      }
    }
  }

  if (mid.includes('flux.1-dev')) {
    body.num_inference_steps = 28
  }

  return body
}

/** 解析硅基（及兼容 OpenAI data 数组）响应中的首张图 URL 或 base64 */
export function pickImageUrlFromGenerationsJson(data: any): { url: string; b64?: string } | null {
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')

  if (data && Array.isArray(data.images) && data.images.length) {
    const row = data.images[0]
    const u = pick(row?.url)
    if (u) return { url: u }
  }

  if (data && Array.isArray(data.data) && data.data.length) {
    const row = data.data[0]
    const u = pick(row?.url) || pick(row?.image_url)
    const b64 = pick(row?.b64_json)
    if (u) return { url: u }
    if (b64) return { url: `data:image/png;base64,${b64}`, b64 }
  }

  const top = pick(data?.url) || pick(data?.output) || pick(data?.result?.url) || pick(data?.image_url)
  if (top) return { url: top }
  const b64top = pick(data?.b64_json) || pick(data?.image_base64)
  if (b64top) return { url: `data:image/png;base64,${b64top}`, b64: b64top }

  return null
}
