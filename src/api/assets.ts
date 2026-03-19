export type AssetItem = {
  id: string
  user_id: string
  source: 'user_upload' | 'ai_generated'
  type: 'image' | 'video'
  url: string
  name?: string | null
  metadata?: any
  created_at: string
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

export async function createAssetAPI(params: {
  source: 'user_upload' | 'ai_generated'
  type: 'image' | 'video'
  url: string
  name?: string
  metadata?: any
}) {
  const resp = await fetch('/api/assets/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `资产入库失败(${resp.status})`)
  return data as { success: true; asset: AssetItem }
}

export async function listAssetsAPI(params?: {
  source?: 'user_upload' | 'ai_generated'
  type?: 'image' | 'video'
  limit?: number
  offset?: number
}) {
  const search = new URLSearchParams()
  if (params?.source) search.set('source', params.source)
  if (params?.type) search.set('type', params.type)
  if (params?.limit) search.set('limit', String(params.limit))
  const offset = params?.offset
  if (offset != null) search.set('offset', String(offset))
  const qs = search.toString()
  const resp = await fetch(`/api/assets/list${qs ? `?${qs}` : ''}`, {
    headers: { ...authHeader() },
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取资产失败(${resp.status})`)
  return data as { success: true; assets: AssetItem[]; nextOffset?: number; hasMore?: boolean }
}

export async function updateAssetAPI(params: { id: string; name?: string; metadata?: any }) {
  const resp = await fetch('/api/assets/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `更新资产失败(${resp.status})`)
  return data as { success: true; asset: AssetItem | null }
}

export async function deleteAssetAPI(id: string) {
  const resp = await fetch('/api/assets/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ id }),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `删除资产失败(${resp.status})`)
  return data as { success: true }
}

