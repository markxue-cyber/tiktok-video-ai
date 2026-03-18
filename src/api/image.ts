export async function generateImageAPI(params: {
  prompt: string
  negativePrompt?: string
  model: string
  aspectRatio: string
  resolution: string
  refImage?: string
}): Promise<{ imageUrl: string; size?: string }> {
  const resp = await fetch('/api/image-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Confirm-Billable': 'true' },
    body: JSON.stringify({
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      negative_prompt: params.negativePrompt,
      model: params.model,
      aspect_ratio: params.aspectRatio,
      resolution: params.resolution,
      refImage: params.refImage,
    }),
  })

  const data = await resp.json()
  if (!resp.ok || !data?.success) {
    const raw = data?.raw ? `\nraw: ${JSON.stringify(data.raw).slice(0, 1200)}` : ''
    throw new Error((data?.error || `生成失败(${resp.status})`) + raw)
  }
  if (!data?.imageUrl) throw new Error('生成成功但未返回图片地址')
  return { imageUrl: data.imageUrl, size: data.size }
}

