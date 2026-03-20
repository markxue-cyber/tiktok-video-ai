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

export type AdminUserItem = {
  id: string
  email: string
  display_name?: string
  is_frozen?: boolean
  freeze_reason?: string
  created_at?: string
  subscription?: { plan_id?: string; status?: string; current_period_end?: string } | null
}

export async function adminListUsers(params?: { q?: string; plan?: string; frozen?: 'true' | 'false'; limit?: number; offset?: number }) {
  const sp = new URLSearchParams()
  if (params?.q) sp.set('q', params.q)
  if (params?.plan) sp.set('plan', params.plan)
  if (params?.frozen) sp.set('frozen', params.frozen)
  if (params?.limit) sp.set('limit', String(params.limit))
  if (params?.offset != null) sp.set('offset', String(params.offset))
  const resp = await fetch(`/api/admin/users/list${sp.toString() ? `?${sp.toString()}` : ''}`, { headers: { ...authHeader() } })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取用户失败(${resp.status})`)
  return data as { success: true; users: AdminUserItem[]; nextOffset?: number; hasMore?: boolean }
}

export async function adminUpdateUser(params: any) {
  const resp = await fetch('/api/admin/users/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `更新用户失败(${resp.status})`)
  return data
}

export async function adminListModelControls(type?: 'video' | 'image' | 'llm') {
  const qs = type ? `?type=${encodeURIComponent(type)}` : ''
  const resp = await fetch(`/api/admin/model-controls/list${qs}`, { headers: { ...authHeader() } })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取模型开关失败(${resp.status})`)
  return data as { success: true; controls: Array<any> }
}

export async function adminUpdateModelControl(params: any) {
  const resp = await fetch('/api/admin/model-controls/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `更新模型开关失败(${resp.status})`)
  return data
}

export async function adminListPackageConfigs() {
  const resp = await fetch('/api/admin/package-configs/list', { headers: { ...authHeader() } })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取套餐配置失败(${resp.status})`)
  return data as { success: true; configs: Array<any> }
}

export async function adminUpsertPackageConfig(params: any) {
  const resp = await fetch('/api/admin/package-configs/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `保存套餐失败(${resp.status})`)
  return data
}

export async function adminDeletePackageConfig(planId: string) {
  const resp = await fetch('/api/admin/package-configs/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ planId }),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `删除套餐失败(${resp.status})`)
  return data
}

export async function adminListAnnouncements() {
  const resp = await fetch('/api/admin/announcements/list', { headers: { ...authHeader() } })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取公告失败(${resp.status})`)
  return data as { success: true; announcements: Array<any> }
}

export async function adminUpsertAnnouncement(params: any) {
  const resp = await fetch('/api/admin/announcements/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `保存公告失败(${resp.status})`)
  return data
}

export type AdminSupportTicketItem = {
  id: string
  ticket_no: string
  user_id: string
  email?: string
  kind: 'bug' | 'suggestion' | 'other'
  subject: string
  content: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  admin_note?: string
  created_at: string
  updated_at?: string
  closed_at?: string | null
}

export async function adminListSupportTickets(params?: { q?: string; status?: 'all' | 'open' | 'in_progress' | 'resolved' | 'closed'; limit?: number; offset?: number }) {
  const sp = new URLSearchParams()
  if (params?.q) sp.set('q', params.q)
  if (params?.status) sp.set('status', params.status)
  if (params?.limit) sp.set('limit', String(params.limit))
  if (params?.offset != null) sp.set('offset', String(params.offset))
  const resp = await fetch(`/api/admin/support-tickets/list${sp.toString() ? `?${sp.toString()}` : ''}`, { headers: { ...authHeader() } })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取工单失败(${resp.status})`)
  return data as { success: true; tickets: AdminSupportTicketItem[]; nextOffset?: number; hasMore?: boolean }
}

export async function adminUpdateSupportTicket(params: {
  ticketId: string
  status?: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  adminNote?: string
}) {
  const resp = await fetch('/api/admin/support-tickets/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `更新工单失败(${resp.status})`)
  return data as { success: true; ticket: AdminSupportTicketItem }
}
