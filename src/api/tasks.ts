export type GenerationTaskItem = {
  id: string
  user_id: string
  type: 'video' | 'image'
  model?: string | null
  status: string
  provider_task_id?: string | null
  output_url?: string | null
  created_at: string
  updated_at?: string
  raw?: any
}

async function readJsonOrText(resp: Response): Promise<any> {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, error: text }
  }
}

function authHeader() {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录')
  return { Authorization: `Bearer ${token}` }
}

export async function listTasksAPI(params?: { type?: 'video' | 'image'; status?: string; limit?: number; offset?: number }) {
  const search = new URLSearchParams()
  if (params?.type) search.set('type', params.type)
  if (params?.status) search.set('status', params.status)
  if (params?.limit) search.set('limit', String(params.limit))
  if (params?.offset != null) search.set('offset', String(params.offset))
  const resp = await fetch(`/api/tasks/list${search.toString() ? `?${search.toString()}` : ''}`, {
    headers: { ...authHeader() },
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取任务失败(${resp.status})`)
  return data as { success: true; tasks: GenerationTaskItem[]; nextOffset?: number; hasMore?: boolean }
}

