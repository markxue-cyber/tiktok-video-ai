export type ProductInfo = {
  name: string
  category: string
  sellingPoints: string
  targetAudience: string
  language: string
}

export async function parseProductInfo(params: { refImage: string; language: string; kind: 'video' | 'image' }): Promise<ProductInfo & { _mock?: boolean }> {
  const resp = await fetch('/api/ai/parse-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await resp.json()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `解析失败(${resp.status})`)
  return data.data
}

export async function generateVideoScripts(params: { product: ProductInfo; language: string; refImage: string }): Promise<{ scripts: string[]; _mock?: boolean }> {
  const resp = await fetch('/api/ai/video-scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await resp.json()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `脚本生成失败(${resp.status})`)
  return { scripts: data.scripts || data.data?.scripts || [], _mock: data._mock }
}

export async function beautifyScript(params: { script: string; tags: string[]; language: string }): Promise<{ optimized: string; _mock?: boolean }> {
  const resp = await fetch('/api/ai/beautify-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await resp.json()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `优化失败(${resp.status})`)
  return { optimized: data.optimized, _mock: data._mock }
}

export async function generateImagePrompt(params: { product: ProductInfo; language: string }): Promise<{ prompt: string; _mock?: boolean }> {
  const resp = await fetch('/api/ai/image-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await resp.json()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `提示词生成失败(${resp.status})`)
  return { prompt: data.prompt, _mock: data._mock }
}

