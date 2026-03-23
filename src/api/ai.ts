/** 商品结构化信息 + 投放定向（电商套图 / 场景规划 / 爆款风格） */
export type ProductInfo = {
  name: string
  category: string
  sellingPoints: string
  targetAudience: string
  /** 文案 / 提示词输出语言 */
  language: string
  /** 目标电商平台 value，见 ECOMMERCE_TARGET_PLATFORMS */
  targetPlatform: string
  /** 目标市场 value，见 ECOMMERCE_TARGET_MARKETS */
  targetMarket: string
}

export const DEFAULT_PRODUCT_INFO: ProductInfo = {
  name: '',
  category: '',
  sellingPoints: '',
  targetAudience: '',
  language: '简体中文',
  targetPlatform: 'unspecified',
  targetMarket: 'china',
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
  const d = data.data as Partial<ProductInfo> | undefined
  return {
    ...DEFAULT_PRODUCT_INFO,
    name: String(d?.name ?? ''),
    category: String(d?.category ?? ''),
    sellingPoints: String(d?.sellingPoints ?? ''),
    targetAudience: String(d?.targetAudience ?? ''),
    language: String(d?.language ?? DEFAULT_PRODUCT_INFO.language),
    targetPlatform: String(d?.targetPlatform ?? DEFAULT_PRODUCT_INFO.targetPlatform),
    targetMarket: String(d?.targetMarket ?? DEFAULT_PRODUCT_INFO.targetMarket),
    _mock: data._mock,
  }
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

export type HotSellingStylePayload = { title: string; description: string; imagePrompt?: string }

/** 图片工作台：商品分析 + 爆款风格（视觉，主参考图） */
export async function imageWorkbenchAnalysis(params: {
  refImage: string
  language: string
  mode: 'full' | 'product' | 'styles'
  /** 与 ProductInfo 一致，供爆款/分析贴合平台与市场 */
  targetPlatform?: string
  targetMarket?: string
}): Promise<{
  productAnalysisText?: string
  product?: ProductInfo
  styles?: HotSellingStylePayload[]
  _mock?: boolean
}> {
  const resp = await fetch('/api/ai/image-workbench', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refImage: params.refImage,
      language: params.language,
      mode: params.mode,
      targetPlatform: params.targetPlatform,
      targetMarket: params.targetMarket,
    }),
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

/** 图片生成（简版）· 使用 GPT-4o 润色提示词（计费 LLM 额度） */
export async function polishImageGenPrompt(params: {
  prompt: string
  language?: string
}): Promise<{ polished: string; _mock?: boolean }> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录再优化提示词')
  const idem = (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`) as string
  const resp = await fetch('/api/ai/prompt-polish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idem,
      'X-Confirm-Billable': 'true',
    },
    body: JSON.stringify({ prompt: params.prompt, language: params.language || '简体中文' }),
  })
  const text = await resp.text()
  const data = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return { success: false, error: text }
    }
  })()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `提示词优化失败(${resp.status})`)
  return { polished: String(data.polished || '').trim(), _mock: data._mock }
}

