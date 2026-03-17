// Vercel Serverless Function - 视频生成API
export default async function handler(req, res) {
  // 打印请求信息
  console.log('Request method:', req.method)
  console.log('Request body:', JSON.stringify(req.body))
  
  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'API Key未配置' })
    }

    // 提交视频生成任务
    if (req.method === 'POST') {
      const { prompt, model, duration, aspect_ratio, resolution, refImage } = req.body || {}

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
        'seedance': 'doubao-seedance-1-5-pro-251215'
      }
      
      const apiModel = model ? (modelMap[model] || model) : 'doubao-seedance-1-5-pro-251215'
      
      console.log('Submitting with model:', apiModel)

      const submitResponse = await fetch('https://api.linkapi.org/v2/videos/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt || '生成一个视频',
          model: apiModel,
          duration: Number(duration) || 10,
          aspect_ratio: aspect_ratio || '9:16',
          resolution: resolution || '720p',
          // 尝试以常见字段名透传参考图（不同聚合/模型可能字段不同）
          image: refImage,
          input_image: refImage,
          reference_image: refImage,
        })
      })

      const submitData = await submitResponse.json()
      console.log('Submit Response:', JSON.stringify(submitData))

      // 检查是否有错误
      if (submitData.error) {
        return res.status(200).json({ 
          success: false, 
          error: submitData.error.message || JSON.stringify(submitData.error)
        })
      }

      // 尝试多种可能的字段名/嵌套结构
      const taskId = findTaskIdDeep(submitData)
      
      if (!taskId) {
        return res.status(200).json({ 
          success: false, 
          error: '无法获取任务ID（聚合API未返回可识别的task_id/id）',
          raw: submitData
        })
      }

      // 任务提交成功
      return res.status(200).json({ 
        success: true, 
        taskId: taskId,
        message: '视频生成中，预计需要3-5分钟'
      })
    }

    // 查询任务状态 (GET)
    if (req.method === 'GET') {
      const taskId = req.query.taskId as string

      if (!taskId) {
        return res.status(400).json({ success: false, error: '缺少taskId' })
      }

      const statusResponse = await fetch(`https://api.linkapi.org/v2/videos/generations/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      })

      const statusData = await statusResponse.json()
      console.log('Status Response:', JSON.stringify(statusData))

      return res.status(200).json({
        success: true,
        status: statusData.status,
        progress: statusData.progress,
        videoUrl: statusData.data?.output || statusData.data?.outputs?.[0],
        failReason: statusData.fail_reason
      })
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' })

  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({ success: false, error: error.message })
  }
}
