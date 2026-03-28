/**
 * 首页对话异步出图：写入 / 更新 generation_tasks（service role）
 */
function mustEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function supabaseBaseUrl() {
  return String(mustEnv('SUPABASE_URL')).replace(/\/$/, '')
}

function serviceHeaders(extra: Record<string, string> = {}) {
  const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra,
  }
}

export async function insertQueuedHomeChatImageJob(
  userId: string,
  jobId: string,
  modelId?: string,
): Promise<void> {
  const model = String(modelId || 'nano-banana-2').trim() || 'nano-banana-2'
  const resp = await fetch(`${supabaseBaseUrl()}/rest/v1/generation_tasks`, {
    method: 'POST',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify([
      {
        id: jobId,
        user_id: userId,
        type: 'image',
        model,
        status: 'queued',
        raw: { source: 'home_chat_async', createdAt: Date.now() },
      },
    ]),
  })
  const inserted = await resp.json().catch(() => null)
  if (!resp.ok) {
    const t = typeof inserted === 'string' ? inserted : JSON.stringify(inserted)
    throw new Error(`创建出图任务失败: ${String(t || '').slice(0, 200)}`)
  }
  if (!Array.isArray(inserted) || inserted.length < 1) {
    throw new Error('创建出图任务失败: 未返回插入行（请检查 generation_tasks 与 user_id 外键）')
  }
}

export async function patchHomeChatImageJob(
  jobId: string,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const body = { ...patch, updated_at: new Date().toISOString() }
  const resp = await fetch(
    `${supabaseBaseUrl()}/rest/v1/generation_tasks?id=eq.${encodeURIComponent(jobId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders({
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }),
      body: JSON.stringify(body),
    },
  )
  const updated = await resp.json().catch(() => null)
  if (!resp.ok) {
    const t = typeof updated === 'string' ? updated : JSON.stringify(updated)
    throw new Error(`更新出图任务失败: ${String(t || '').slice(0, 200)}`)
  }
  if (!Array.isArray(updated) || updated.length < 1) {
    throw new Error(
      '更新出图任务未影响任何行：请核对 job id 与用户 id 是否与插入时一致（常见于 JWT user 与 public.users 不一致）',
    )
  }
}

export async function fetchHomeChatImageJobForUser(
  jobId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams()
  params.set('id', `eq.${jobId}`)
  params.set('user_id', `eq.${userId}`)
  params.set('select', '*')
  const resp = await fetch(`${supabaseBaseUrl()}/rest/v1/generation_tasks?${params}`, {
    method: 'GET',
    headers: serviceHeaders(),
  })
  const data = await resp.json().catch(() => null)
  if (!resp.ok || !Array.isArray(data) || !data[0]) return null
  return data[0] as Record<string, unknown>
}
