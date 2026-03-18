export async function applyImageStyleTag(params: {
  tag: string
  language: string
  parts: any
  prompt?: string
  negativePrompt?: string
  aspectRatio?: string
  resolution?: string
}): Promise<{ prompt: string; negativePrompt: string; parts: any }> {
  const resp = await fetch('/api/ai/image-style', {
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
  if (!resp.ok || !data?.success) throw new Error(data?.error || `风格优化失败(${resp.status})`)
  return { prompt: data.prompt || '', negativePrompt: data.negativePrompt || '', parts: data.parts || params.parts }
}

