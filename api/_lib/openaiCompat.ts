type OpenAICompatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type OpenAICompatChatRequest = {
  model: string
  messages: OpenAICompatMessage[]
  temperature?: number
  response_format?: { type: 'json_object' } | { type: 'text' }
}

export async function callOpenAICompatJSON<T>({
  apiKey,
  baseUrl,
  request,
}: {
  apiKey: string
  baseUrl: string
  request: OpenAICompatChatRequest
}): Promise<T> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const data = await resp.json().catch(() => ({}))

  if (!resp.ok) {
    const msg = data?.error?.message || data?.message || `LLM请求失败(${resp.status})`
    throw new Error(msg)
  }

  const content = data?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') throw new Error('LLM响应为空')

  try {
    return JSON.parse(content) as T
  } catch {
    throw new Error('LLM未返回JSON，请检查prompt或response_format支持情况')
  }
}

