export async function applyImageStyleTags(params: {
  tags: string[]
  language: string
  parts: any
  prompt?: string
  negativePrompt?: string
  aspectRatio?: string
  resolution?: string
  product?: any
  categoryHint?: string
  sceneMode?: string
  learnedTweaks?: any
}): Promise<{ prompt: string; negativePrompt: string; parts: any }> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录再进行AI精修')
  const idem = (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`) as string

  const resp = await fetch('/api/ai/image-style', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idem,
      'X-Confirm-Billable': 'true',
    },
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
  if (!resp.ok || !data?.success) throw new Error(data?.error || `风格优化失败(${resp.status})`)
  return { prompt: data.prompt || '', negativePrompt: data.negativePrompt || '', parts: data.parts || params.parts }
}

