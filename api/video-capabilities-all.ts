// Vercel Serverless Function - 批量探测视频模型可用参数（严格白名单）
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    // IMPORTANT: 该批量探测会调用计费的 videos/generations。默认关闭，避免页面加载就扣费。
    if (process.env.ALLOW_BILLABLE_CAPS_PROBE !== 'true') {
      return res.status(403).json({ success: false, error: '能力批量探测已禁用（可能产生计费）。如需开启请设置 ALLOW_BILLABLE_CAPS_PROBE=true' })
    }
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    if (!apiKey) return res.status(500).json({ success: false, error: 'API Key未配置' })

    const { models } = req.body || {}
    const modelList: string[] = Array.isArray(models) ? models.map(String).map((s) => s.trim()).filter(Boolean) : []
    if (modelList.length === 0) return res.status(400).json({ success: false, error: '缺少models' })

    const basePayload = (model: string) => ({
      prompt: 'test',
      model,
      duration: 10,
      aspect_ratio: '9:16',
      resolution: '720p',
    })

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
      const m = String(errMsg || '').match(/not in\s*\[([^\]]+)\]/i)
      if (!m?.[1]) return []
      return m[1]
        .split(',')
        .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    }
    const getErrMsg = (d: any) => d?.error?.message || d?.message || d?.error || JSON.stringify(d)

    const probeOne = async (model: string) => {
      const probeField = async (field: 'duration' | 'aspect_ratio' | 'resolution', invalidValue: any) => {
        const payload = { ...basePayload(model), [field]: invalidValue }
        const resp = await call(payload)
        if (resp.ok && !resp.data?.error) return []
        return parseNotInList(getErrMsg(resp.data))
      }

      const aspectRatios = await probeField('aspect_ratio', '0:0')
      const resolutions = await probeField('resolution', '0p')
      const durationsRaw = await probeField('duration', 999)
      const durations = durationsRaw
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, 50)

      return {
        model,
        caps: {
          aspectRatios: aspectRatios.filter(Boolean),
          resolutions: resolutions.filter(Boolean),
          durations,
        },
      }
    }

    // 简单并发控制，避免打爆上游
    const concurrency = 3
    const results: any[] = []
    let idx = 0
    const workers = Array.from({ length: Math.min(concurrency, modelList.length) }).map(async () => {
      while (idx < modelList.length) {
        const cur = modelList[idx++]
        try {
          results.push(await probeOne(cur))
        } catch (e: any) {
          results.push({ model: cur, caps: { aspectRatios: [], resolutions: [], durations: [] }, error: e?.message || 'probe failed' })
        }
      }
    })
    await Promise.all(workers)

    const map: Record<string, any> = {}
    for (const r of results) map[r.model] = r

    return res.status(200).json({ success: true, data: map })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

