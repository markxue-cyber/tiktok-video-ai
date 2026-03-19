export type MonitoringStats = {
  scope: 'system' | 'self'
  window: string
  total: number
  byType: { image: number; video: number }
  byStatus: { submitted: number; processing: number; succeeded: number; failed: number; other: number }
  failedRate: number
  errorTop: Array<{ message: string; count: number }>
  hourlyFailed: Array<{ hour: string; count: number }>
  orders24h: {
    total: number
    byStatus: { created: number; paid: number; failed: number; refunded: number; other: number }
  }
}

async function readJsonOrText(resp: Response): Promise<any> {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, error: text }
  }
}

export async function getMonitoringStatsAPI(accessToken: string, scope: 'system' | 'self' = 'system'): Promise<MonitoringStats> {
  const resp = await fetch(`/api/monitoring/stats?scope=${scope}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取监控统计失败(${resp.status})`)
  return data as MonitoringStats
}

