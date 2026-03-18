export async function createOrder(params: { planId: string; payType?: string }, accessToken: string) {
  const resp = await fetch('/api/payments/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(params),
  })
  const data = await resp.json()
  if (!resp.ok || !data?.success) throw new Error(data?.error || '下单失败')
  return data as { orderId: string; payUrl?: string; qrcode?: string; raw?: any }
}

