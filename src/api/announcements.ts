async function readJsonOrText(resp: Response): Promise<any> {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, error: text }
  }
}

export async function listAnnouncementsPublic(planId?: string) {
  const sp = new URLSearchParams()
  if (planId) sp.set('plan', planId)
  const resp = await fetch(`/api/announcements${sp.toString() ? `?${sp.toString()}` : ''}`)
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取公告失败(${resp.status})`)
  return data as { success: true; announcements: Array<any> }
}
