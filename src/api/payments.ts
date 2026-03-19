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

export async function getOrderStatus(orderId: string, accessToken: string) {
  const resp = await fetch(`/api/payments/order-status?orderId=${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const text = await resp.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { success: false, error: text }
  }
  if (!resp.ok || !data?.success) throw new Error(data?.error || '查询订单状态失败')
  return data as { success: true; order: { orderId: string; planId: string; status: string; createdAt: string; paidAt?: string } }
}

