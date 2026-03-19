async function readJsonOrText(resp: Response): Promise<any> {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, error: text }
  }
}

export type PackageConfigItem = {
  plan_id: string
  name: string
  price_cents: number
  currency: string
  daily_quota: number
  features: string[]
  model_whitelist?: string[]
  enabled: boolean
  display_order?: number
  apply_mode?: 'new_only' | 'all_users'
  grace_days?: number
  effective_from?: string | null
}

export async function listPackageConfigsPublic() {
  const resp = await fetch('/api/package-configs')
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取套餐配置失败(${resp.status})`)
  return data as { success: true; configs: PackageConfigItem[] }
}
