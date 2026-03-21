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

export type HotSellingStylePayload = { title: string; description: string }

/** 图片工作台：商品分析 + 爆款风格（视觉，主参考图） */
export async function imageWorkbenchAnalysis(params: {
  refImage: string
  language: string
  mode: 'full' | 'product' | 'styles'
}): Promise<{
  productAnalysisText?: string
  product?: ProductInfo
  styles?: HotSellingStylePayload[]
  _mock?: boolean
}> {
  const resp = await fetch('/api/ai/image-workbench', {
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
  if (!resp.ok || !data?.success) throw new Error(data?.error || `分析失败(${resp.status})`)
  return {
    productAnalysisText: data.productAnalysisText,
    product: data.product,
    styles: data.styles,
    _mock: data._mock,
  }
}

export async function imageScenePlan(params: {
  basePrompt: string
  negativePrompt?: string
  product: ProductInfo
  productAnalysisNotes?: string
  hotSellingStyle?: HotSellingStylePayload
  language: string
}): Promise<{
  scenes: { key: string; title: string; description: string; imagePrompt: string }[]
  _mock?: boolean
}> {
  const resp = await fetch('/api/ai/image-scenes', {
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
  if (!resp.ok || !data?.success) throw new Error(data?.error || `场景规划失败(${resp.status})`)
  return { scenes: data.scenes || [], _mock: data._mock }
}

export async function generateImagePrompt(params: {
  product: ProductInfo
  language: string
  aspectRatio?: string
  resolution?: string
  sceneMode?: 'clean' | 'lite'
  hotSellingStyle?: HotSellingStylePayload
  productAnalysisNotes?: string
}): Promise<{ categoryHint?: string; prompt: string; negativePrompt?: string; parts?: any; _mock?: boolean }> {
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
  return { categoryHint: data.categoryHint, prompt: data.prompt, negativePrompt: data.negativePrompt, parts: data.parts, _mock: data._mock }
}

