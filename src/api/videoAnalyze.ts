export type VideoAnalyzeTurn = {
  role: 'user' | 'assistant'
  text: string
  /** Supabase Storage 公网 URL（大视频直传后的地址） */
  videoUrl?: string | null
  videoDataUrl?: string | null
  imageDataUrls?: string[] | null
}

const PAYLOAD_TOO_LARGE_ZH =
  '视频或对话内容过大，超过平台单次请求上限（约 4MB）。请选用更短、更低清的视频（建议约 2MB 以内），或删除部分历史后再试；也可仅用「添加链接」文字描述。'

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

  if (resp.status === 413) {
    throw new Error(PAYLOAD_TOO_LARGE_ZH)
  }

  const rawText = await resp.text()
  let data: { success?: boolean; error?: string; reply?: string; _mock?: boolean } = {}
  try {
    data = rawText ? JSON.parse(rawText) : {}
  } catch {
    // 非 JSON（如网关 HTML）
  }

  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || (resp.status === 413 ? PAYLOAD_TOO_LARGE_ZH : `请求失败(${resp.status})`))
  }
  return { reply: String(data.reply || ''), _mock: data._mock }
}
