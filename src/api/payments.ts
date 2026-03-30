function parseApiJson(text: string, fallbackMsg: string) {
  if (!text?.trim()) return { success: false, error: fallbackMsg }
  try {
    return JSON.parse(text)
  } catch {
    if (/FUNCTION_INVOCATION_FAILED|500/i.test(text)) {
      return { success: false, error: '支付服务暂时不可用，请稍后重试或联系管理员查看 Vercel 函数日志。' }
    }
    return { success: false, error: text.slice(0, 200) || fallbackMsg }
  }
}

export async function createOrder(
  params: { planId: string; payType?: string; /** 加油包：整数元，与 `TOPUP_PLAN_ID` 联用 */ amountYuan?: number },
  accessToken: string,
) {
  const resp = await fetch('/api/payments/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(params),
  })
  const text = await resp.text()
  const data = parseApiJson(text, '下单失败')
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

