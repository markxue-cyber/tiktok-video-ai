// Vercel Serverless Function - 视频生成API
import {
  CREDITS_PER_VIDEO,
  chargeVideoOnSuccess,
  checkAndConsume,
  finalizeVideoSubmitHold,
  refundPrepaidCredits,
  refundVideoCreditsOnFailure,
  requireUser,
} from './_billing.js'

function mustEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name}`)
  return v
}

function supabaseBaseUrl() {
  return String(mustEnv('SUPABASE_URL')).replace(/\/$/, '')
}

async function writeTaskRow(payload: any) {
  try {
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    await fetch(`${supabaseBaseUrl()}/rest/v1/generation_tasks`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([payload]),
    })
  } catch {
    // never block generation if task logging fails
  }
}

async function updateTaskByProviderId(providerTaskId: string, patch: any) {
  if (!providerTaskId) return
  try {
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    await fetch(`${supabaseBaseUrl()}/rest/v1/generation_tasks?provider_task_id=eq.${encodeURIComponent(providerTaskId)}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    })
  } catch {
    // never block generation if task logging fails
  }
}

async function ensureModelEnabled(modelId: string, type: 'video' | 'image' | 'llm') {
  try {
    const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
    const resp = await fetch(
      `${supabaseBaseUrl()}/rest/v1/model_controls?model_id=eq.${encodeURIComponent(modelId)}&type=eq.${encodeURIComponent(type)}&select=enabled`,
      {
        method: 'GET',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    )
    const text = await resp.text()
    const data = (() => {
      try {
        return text ? JSON.parse(text) : []
      } catch {
        return []
      }
    })()
    const row = Array.isArray(data) ? data[0] : null
    if (row && row.enabled === false) return false
    return true
  } catch {
    return true
  }
}
export default async function handler(req, res) {
  // 打印请求信息
  console.log('Request method:', req.method)
  console.log('Request body:', JSON.stringify(req.body))
  
  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'API Key未配置' })
    }

    const inferCode = (message: string): string => {
      const t = String(message || '').toLowerCase()
      if (t.includes('未登录') || (t.includes('authorization') && t.includes('bearer'))) return 'AUTH_REQUIRED'
      if (t.includes('请先完成本产品内') || t.includes('付费订单')) return 'PAYMENT_REQUIRED'
      if (t.includes('积分不足')) return 'INSUFFICIENT_CREDITS'
      if (t.includes('今日额度已用尽') || t.includes('upgrade') || t.includes('quota')) return 'QUOTA_EXHAUSTED'
      if (t.includes('timeout') || t.includes('超时')) return 'UPSTREAM_TIMEOUT'
      if (t.includes('model') && (t.includes('does not exist') || t.includes('invalid field') || t.includes('not in') || t.includes('不存在'))) {
        return 'MODEL_UNAVAILABLE'
      }
      if (t.includes('missingparameter') || (t.includes('missing') && t.includes('content'))) return 'UPSTREAM_BAD_REQUEST'
      return 'UPSTREAM_ERROR'
    }

    /** 聚合层常返回 code=upstream_error，message 为嵌套 JSON 字符串；勿误判为 NO_TASKID */
    const parseVideoSubmitFailure = (d: any): { msg: string; code: string } | null => {
      if (!d || typeof d !== 'object') return null
      if (d.error) {
        const msg =
          typeof d.error === 'string'
            ? d.error
            : String(d.error?.message || JSON.stringify(d.error))
        if (msg && msg !== '{}') return { msg: msg.slice(0, 2500), code: inferCode(msg) }
      }
      const codeStr = String(d.code || '').toLowerCase()
      if (codeStr === 'upstream_error' || codeStr === 'error') {
        const tryParse = (s: string): string => {
          const t = String(s || '').trim()
          if (!t) return ''
          try {
            const j = JSON.parse(t)
            const inner =
              (j?.error && typeof j.error === 'object' && (j.error.message || j.error.code)) ||
              j?.message ||
              (typeof j.error === 'string' ? j.error : '')
            if (typeof inner === 'string' && inner.startsWith('{')) return tryParse(inner)
            if (typeof inner === 'string') return inner
            if (j?.error?.message) return String(j.error.message)
          } catch {
            return t.slice(0, 2500)
          }
          return t.slice(0, 2500)
        }
        const fromMsg = tryParse(d.message)
        const fromUp = tryParse(d.upstream_message)
        const msg = (fromMsg || fromUp || String(d.message || d.upstream_message || '上游错误')).slice(0, 2500)
        if (msg) return { msg, code: inferCode(msg) }
      }
      return null
    }

    // 提交视频生成任务
    if (req.method === 'POST') {
      // 保险栓：防止非用户确认的请求触发计费
      const billableConfirmed = String(req.headers?.['x-confirm-billable'] || '').toLowerCase() === 'true'
      if (!billableConfirmed) {
        return res.status(403).json({ success: false, error: '已拦截：缺少 X-Confirm-Billable: true（防止误触发计费）' })
      }
      let consumed: any
      try {
        consumed = await checkAndConsume(req, { type: 'video', creditsCost: CREDITS_PER_VIDEO })
      } catch (e: any) {
        const msg = String(e?.message || '额度校验失败')
        return res.status(200).json({ success: false, error: msg, code: inferCode(msg) })
      }
      if (consumed.already) return res.status(200).json({ success: true, ...(consumed.result || {}) })

      let needBillingRelease = true
      const failAndRelease = async (payload: { success: false; error: string; code: string; raw?: any }) => {
        if (needBillingRelease) {
          try {
            await refundPrepaidCredits(req)
          } catch {
            /* ignore */
          }
          needBillingRelease = false
        }
        return res.status(200).json(payload)
      }
      const {
        prompt,
        model,
        duration,
        aspect_ratio,
        resolution,
        refImage,
        videoEnhance,
        inputVideoUrl,
        targetResolution,
        targetFps,
        videoDurationSec,
      } = req.body || {}

      const pickFirstString = (v: any): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
      const findTaskIdDeep = (obj: any): string => {
        if (!obj || typeof obj !== 'object') return ''
        // 常见字段
        const direct =
          pickFirstString((obj as any).task_id) ||
          pickFirstString((obj as any).taskId) ||
          pickFirstString((obj as any).taskID) ||
          pickFirstString((obj as any).id) ||
          pickFirstString((obj as any).job_id) ||
          pickFirstString((obj as any).jobId)
        if (direct) return direct
        // 常见嵌套层级
        const candidates = [(obj as any).data, (obj as any).result, (obj as any).output, (obj as any).response, (obj as any).payload]
        for (const c of candidates) {
          const found = findTaskIdDeep(c)
          if (found) return found
        }
        // 兜底遍历（限制深度与键数）
        const entries = Object.entries(obj).slice(0, 50)
        for (const [, val] of entries) {
          if (val && typeof val === 'object') {
            const found = findTaskIdDeep(val)
            if (found) return found
          }
        }
        return ''
      }

      // 映射前端模型名称到API模型名称
      const modelMap: Record<string, string> = {
        'sora': 'sora-2',
        'kling': 'doubao-seedance-1-5-pro-251215',
        'runway': 'veo3',
        'seedance': 'doubao-seedance-1-5-pro-251215',
      }

      const inputUrl = String(inputVideoUrl || '').trim()
      const isVideoEnhance = Boolean(videoEnhance) && inputUrl.length > 0

      let apiModel: string
      let finalPrompt: string
      let finalDuration: number
      let finalAspect: string
      let finalResolution: string
      let upstreamExtra: Record<string, unknown>

      if (isVideoEnhance) {
        apiModel = 'sora-2'
        const tr = String(targetResolution || '1080p').toLowerCase()
        const resMap: Record<string, string> = {
          '1080p': '1080p',
          '1080': '1080p',
          '2k': '1440p',
          '1440p': '1440p',
          '4k': '2160p',
          '2160p': '2160p',
        }
        finalResolution = resMap[tr] || '1080p'
        const fpsN = Number(targetFps) === 60 ? 60 : 30
        const dur = Number(videoDurationSec)
        finalDuration = Math.max(1, Math.min(60, Number.isFinite(dur) ? Math.ceil(dur) : 10))
        finalAspect = String(aspect_ratio || '9:16')
        finalPrompt = [
          '[Video quality enhancement]',
          `Upscale and enhance the provided source video toward ${finalResolution} quality and ${fpsN} FPS where supported.`,
          'Preserve original content, motion, composition, and subject identity. No new objects or watermarks.',
          'Reduce compression artifacts and noise while keeping temporal consistency.',
          '（画质提升：在保持原视频内容与运动一致的前提下提升清晰度与观感，按目标参数输出。）',
        ].join('\n')
        upstreamExtra = {
          input_video: inputUrl,
          video: inputUrl,
          source_video: inputUrl,
          reference_video: inputUrl,
          video_url: inputUrl,
          fps: fpsN,
          frame_rate: fpsN,
          target_fps: fpsN,
          target_resolution: finalResolution,
        }
      } else {
        apiModel = model ? (modelMap[model] || model) : 'doubao-seedance-1-5-pro-251215'
        const promptRaw = typeof prompt === 'string' ? prompt : prompt != null ? String(prompt) : ''
        finalPrompt = promptRaw.trim() || '生成一个视频'
        finalDuration = Number(duration) || 10
        finalAspect = aspect_ratio || '9:16'
        finalResolution = resolution || '720p'
        upstreamExtra = {
          image: refImage,
          input_image: refImage,
          reference_image: refImage,
        }
      }

      const textPayload = String(finalPrompt || '').trim() || (isVideoEnhance ? 'Video quality enhancement' : '生成一个视频')

      const enabled = await ensureModelEnabled(String(apiModel), 'video')
      if (!enabled) {
        return await failAndRelease({ success: false, error: `模型 ${apiModel} 已被后台禁用`, code: 'MODEL_UNAVAILABLE' })
      }

      console.log('Submitting with model:', apiModel, isVideoEnhance ? '(video enhance)' : '')

      try {
      const submitPayload = {
        model: apiModel,
        duration: finalDuration,
        aspect_ratio: finalAspect,
        resolution: finalResolution,
        ...upstreamExtra,
        // 方舟/豆包等上游认 `content`；放末尾避免被 upstreamExtra 覆盖为空
        content: textPayload,
        prompt: textPayload,
        text: textPayload,
      }

      const submitResponse = await fetch('https://api.linkapi.org/v2/videos/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitPayload),
      })

      const submitData = await submitResponse.json()
      console.log('Submit Response:', JSON.stringify(submitData))

      const structuredFail = parseVideoSubmitFailure(submitData)
      if (structuredFail) {
        return await failAndRelease({
          success: false,
          error: structuredFail.msg,
          code: structuredFail.code,
          raw: submitData,
        })
      }

      if (!submitResponse.ok) {
        const msg = `聚合API HTTP ${submitResponse.status}`
        return await failAndRelease({
          success: false,
          error: msg,
          code: inferCode(msg),
          raw: submitData,
        })
      }

      // 检查是否有错误
      if (submitData.error) {
        const msg = submitData.error.message || JSON.stringify(submitData.error)
        return await failAndRelease({
          success: false,
          error: msg,
          code: inferCode(msg),
        })
      }

      // 尝试多种可能的字段名/嵌套结构
      const taskId = findTaskIdDeep(submitData)
      
      if (!taskId) {
        return await failAndRelease({
          success: false,
          error: '无法获取任务ID（聚合API未返回可识别的task_id/id）',
          code: 'UPSTREAM_NO_TASKID',
          raw: submitData
        })
      }

      // 任务提交成功
      const result = { 
        success: true, 
        taskId: taskId,
        message: '视频生成中，预计需要3-5分钟'
      }
      await writeTaskRow({
        user_id: consumed?.user?.id || null,
        type: 'video',
        model: apiModel,
        status: 'submitted',
        provider_task_id: taskId,
        output_url: null,
        raw: { submit: submitData, feature: isVideoEnhance ? 'video_enhance' : 'video_generate' },
      })
      await finalizeVideoSubmitHold(req, taskId, result.message)
      needBillingRelease = false
      return res.status(200).json(result)
      } finally {
        if (needBillingRelease) await refundPrepaidCredits(req).catch(() => {})
      }
    }

    // 查询任务状态 (GET) — 需登录；成片仅标记计费，失败回补积分
    if (req.method === 'GET') {
      const taskId = req.query.taskId as string

      if (!taskId) {
        return res.status(400).json({ success: false, error: '缺少taskId' })
      }

      let authUserId: string | null = null
      try {
        const u = await requireUser(req)
        authUserId = String(u.user?.id || u.user?.sub || '').trim() || null
      } catch (e: any) {
        return res.status(401).json({ success: false, error: e?.message || '未登录（查询进度需携带 Authorization）' })
      }

      const statusResponse = await fetch(`https://api.linkapi.org/v2/videos/generations/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      })

      const statusData = await statusResponse.json()
      console.log('Status Response:', JSON.stringify(statusData))

      const status = String(statusData.status || '').toLowerCase()
      const outputUrl = statusData.data?.output || statusData.data?.outputs?.[0] || null
      if (status === 'succeeded' || status === 'success' || status === 'completed') {
        await updateTaskByProviderId(taskId, { status: 'succeeded', output_url: outputUrl, raw: statusData })
        if (outputUrl) {
          try {
            await chargeVideoOnSuccess(req, taskId, outputUrl)
          } catch (e) {
            console.error('chargeVideoOnSuccess failed', e)
          }
        }
      } else if (status === 'failed' || status === 'error') {
        await updateTaskByProviderId(taskId, { status: 'failed', raw: statusData })
        if (authUserId) {
          try {
            await refundVideoCreditsOnFailure(authUserId, taskId)
          } catch (e) {
            console.error('refundVideoCreditsOnFailure failed', e)
          }
        }
      } else {
        await updateTaskByProviderId(taskId, { status: 'processing' })
      }

      const failReason = statusData.fail_reason
      const failCode = inferCode(failReason || statusData?.error?.message || '')

      return res.status(200).json({
        success: true,
        status: statusData.status,
        progress: statusData.progress,
        videoUrl: statusData.data?.output || statusData.data?.outputs?.[0],
        failReason,
        failCode,
      })
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' })

  } catch (error) {
    console.error('Error:', error)
    const msg = String((error as any)?.message || 'Unknown error')
    return res.status(200).json({ success: false, error: msg, code: inferCode(msg) })
  }
}
