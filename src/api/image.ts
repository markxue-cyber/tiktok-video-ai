export async function generateImageAPI(params: {
  prompt: string
  negativePrompt?: string
  model: string
  aspectRatio: string
  resolution: string
  refImage?: string
  imageCount?: number
}): Promise<{ imageUrl: string; size?: string }> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录再生成图片')
  const idem = (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`) as string

  const resp = await fetch('/api/image-generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idem,
      'X-Confirm-Billable': 'true',
    },
    body: JSON.stringify({
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      negative_prompt: params.negativePrompt,
      model: params.model,
      aspect_ratio: params.aspectRatio,
      resolution: params.resolution,
      refImage: params.refImage,
      n: params.imageCount || 1,
      count: params.imageCount || 1,
      num_images: params.imageCount || 1,
    }),
  })

  const text = await resp.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { success: false, error: text }
  }

  if (!resp.ok || !data?.success) {
    const raw = data?.raw ? `\nraw: ${JSON.stringify(data.raw).slice(0, 1200)}` : ''
    const message = (data?.error || `生成失败(${resp.status})`) + raw
    const err: any = new Error(message)
    err.code = data?.code || 'UNKNOWN'
    throw err
  }
  if (!data?.imageUrl) throw new Error('生成成功但未返回图片地址')
  return { imageUrl: data.imageUrl, size: data.size }
}

