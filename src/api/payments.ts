export async function createOrder(params: { planId: string; payType?: string }, accessToken: string) {
  const resp = await fetch('/api/payments/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(params),
  })
  const text = await resp.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { success: false, error: text }
  }
  if (!resp.ok || !data?.success) throw new Error(data?.error || '下单失败')
  return data as { orderId: string; payUrl?: string; qrcode?: string; raw?: any }
}

