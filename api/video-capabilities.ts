// Vercel Serverless Function - 探测视频模型可用参数（严格适配）
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    // IMPORTANT: 该探测会调用计费的 videos/generations。默认关闭，避免误触发扣费。
    if (process.env.ALLOW_BILLABLE_CAPS_PROBE !== 'true') {
      return res.status(403).json({ success: false, error: '能力探测已禁用（可能产生计费）。如需开启请设置 ALLOW_BILLABLE_CAPS_PROBE=true' })
    }
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    if (!apiKey) return res.status(500).json({ success: false, error: 'API Key未配置' })

    const model = String((req.query?.model as string) || '').trim()
    if (!model) return res.status(400).json({ success: false, error: '缺少model' })

    const basePayload = {
      prompt: 'test',
      model,
      // 下面 3 个值会被分别替换为“故意非法”的值以触发白名单报错
      duration: 10,
      aspect_ratio: '9:16',
      resolution: '720p',
    }

    const call = async (payload: any) => {
      const r = await fetch('https://api.linkapi.org/v2/videos/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const text = await r.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        data = { _raw: text }
      }
      return { ok: r.ok, status: r.status, data }
    }

    const parseNotInList = (errMsg: string) => {
      // 兼容：(x) not in [a,b] / not in ["a","b"]
      const m = String(errMsg || '').match(/not in\s*\[([^\]]+)\]/i)
      if (!m?.[1]) return []
      return m[1]
        .split(',')
        .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    }

    const getErrMsg = (d: any) => d?.error?.message || d?.message || d?.error || JSON.stringify(d)

    const probeField = async (field: 'duration' | 'aspect_ratio' | 'resolution', invalidValue: any) => {
      const payload = { ...basePayload, [field]: invalidValue }
      const resp = await call(payload)
      // 如果直接返回成功，说明该 invalidValue 反而被接受了；返回空列表交给前端兜底
      if (resp.ok && !resp.data?.error) return []
      const list = parseNotInList(getErrMsg(resp.data))
      return list
    }

    const aspectRatios = await probeField('aspect_ratio', '0:0')
    const resolutions = await probeField('resolution', '0p')
    const durationsRaw = await probeField('duration', 999)

    const durations = durationsRaw
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 50)

    const out = {
      aspectRatios: aspectRatios.filter(Boolean),
      resolutions: resolutions.filter(Boolean),
      durations,
    }

    return res.status(200).json({ success: true, model, caps: out })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

