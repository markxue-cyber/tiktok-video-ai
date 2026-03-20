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

export type SupportTicketItem = {
  id: string
  ticket_no: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  kind: 'bug' | 'suggestion' | 'other'
  subject: string
  content: string
  email?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  created_at: string
  updated_at?: string
  closed_at?: string | null
}

export async function createSupportTicket(params: {
  kind: 'bug' | 'suggestion' | 'other'
  content: string
  subject?: string
  email?: string
  page?: string
}) {
  const resp = await fetch('/api/support/tickets/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(params),
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `提交工单失败(${resp.status})`)
  return data as { success: true; ticket: SupportTicketItem }
}

export async function listMySupportTickets(limit = 20) {
  const resp = await fetch(`/api/support/tickets/list?limit=${encodeURIComponent(String(limit))}`, {
    headers: { ...authHeader() },
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取工单失败(${resp.status})`)
  return data as { success: true; tickets: SupportTicketItem[] }
}
