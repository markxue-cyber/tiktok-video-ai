function sendJson(res: any, status: number, payload: any) {
  try {
    if (typeof res?.status === 'function' && typeof res?.json === 'function') return res.status(status).json(payload)
    if (typeof res?.send === 'function') return res.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
  } catch {
    // ignore
  }
}

async function readJsonOrText(resp: Response): Promise<any> {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { success: false, error: text }
  }
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' })
    const { accessToken, password } = req.body || {}
    const at = String(accessToken || '').trim()
    const pw = String(password || '').trim()
    if (!at || !pw) return sendJson(res, 400, { success: false, error: '缺少 accessToken/password' })

    const supabaseUrl = process.env.SUPABASE_URL
    const anonKey = process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_ANON_KEY）')

    const base = String(supabaseUrl).replace(/\/$/, '')

    // Recovery reset link may provide a temporary session (type=recovery).
    // We use the access token to update the password via GoTrue.
    const updateResp = await fetch(`${base}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${at}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: pw }),
    })

    const data = await readJsonOrText(updateResp)
    if (!updateResp.ok) {
      const msg = data?.error_description || data?.msg || data?.message || data?.error || (typeof data === 'string' ? data : '更新失败')
      return sendJson(res, 200, { success: false, error: String(msg || '更新失败') })
    }

    return sendJson(res, 200, { success: true })
  } catch (e: any) {
    return sendJson(res, 500, { success: false, error: e?.message || '服务器错误' })
  }
}

