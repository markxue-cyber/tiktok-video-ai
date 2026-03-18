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
  const text = await resp.text()
  const data = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return { success: false, error: text }
    }
  })()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `解析失败(${resp.status})`)
  return data.data
}

export async function generateVideoScripts(params: {
  product: ProductInfo
  language: string
  refImage: string
  durationSec?: number
  aspectRatio?: string
  resolution?: string
}): Promise<{ scripts: string[]; _mock?: boolean }> {
  const resp = await fetch('/api/ai/video-scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const text = await resp.text()
  const data = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return { success: false, error: text }
    }
  })()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `脚本生成失败(${resp.status})`)
  const scriptsRaw = data.scripts || data.data?.scripts || []
  const scripts = Array.isArray(scriptsRaw)
    ? scriptsRaw.map((x: any) => (typeof x === 'string' ? x : x?.script || x?.text || x?.content || JSON.stringify(x)))
    : []
  return { scripts, _mock: data._mock }
}

export async function beautifyScript(params: { script: string; tags: string[]; language: string }): Promise<{ optimized: string; _mock?: boolean }> {
  const resp = await fetch('/api/ai/beautify-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const text = await resp.text()
  const data = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return { success: false, error: text }
    }
  })()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `优化失败(${resp.status})`)
  return { optimized: data.optimized, _mock: data._mock }
}

export async function generateImagePrompt(params: {
  product: ProductInfo
  language: string
  aspectRatio?: string
  resolution?: string
  sceneMode?: 'clean' | 'lite'
}): Promise<{ prompt: string; negativePrompt?: string; parts?: any; _mock?: boolean }> {
  const resp = await fetch('/api/ai/image-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const text = await resp.text()
  const data = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return { success: false, error: text }
    }
  })()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `提示词生成失败(${resp.status})`)
  return { prompt: data.prompt, negativePrompt: data.negativePrompt, parts: data.parts, _mock: data._mock }
}

