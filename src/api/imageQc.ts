export async function qcEcommerceImage(params: {
  imageUrl: string
  refImage?: string
  product?: any
  aspectRatio?: string
  resolution?: string
  language?: string
}): Promise<{ qc: any }> {
  const token = localStorage.getItem('tikgen.accessToken') || ''
  if (!token) throw new Error('请先登录再进行质检')
  const idem = (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`) as string

  const resp = await fetch('/api/ai/image-qc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idem,
      'X-Confirm-Billable': 'true',
    },
    body: JSON.stringify(params),
  })
  const text = await resp.text()
  const data = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return { success: false, error: text }
    }
  })()
  if (!resp.ok || !data?.success) throw new Error(data?.error || `质检失败(${resp.status})`)
  return { qc: data.qc }
}

