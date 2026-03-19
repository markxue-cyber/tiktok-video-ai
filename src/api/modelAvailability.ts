export type UnavailableModelItem = { id: string; count: number; reason: string }

async function readJsonOrText(resp: Response): Promise<any> {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, error: text }
  }
}

export async function getModelAvailabilityAPI(accessToken: string) {
  const resp = await fetch('/api/model-availability', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await readJsonOrText(resp)
  if (!resp.ok || !data?.success) throw new Error(data?.error || `获取模型可用性失败(${resp.status})`)
  return data as { success: true; image: UnavailableModelItem[]; video: UnavailableModelItem[]; updatedAt: string }
}

