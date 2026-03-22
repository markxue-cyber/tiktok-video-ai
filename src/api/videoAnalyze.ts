export type VideoAnalyzeTurn = {
  role: 'user' | 'assistant'
  text: string
  videoDataUrl?: string | null
  imageDataUrls?: string[] | null
}

export async function videoAnalyzeChat(params: {
  turns: VideoAnalyzeTurn[]
  language?: string
}): Promise<{ reply: string; _mock?: boolean }> {
  const resp = await fetch('/api/ai/video-analyze-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      turns: params.turns,
      language: params.language || '简体中文',
    }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || `请求失败(${resp.status})`)
  }
  return { reply: String(data.reply || ''), _mock: data._mock }
}
