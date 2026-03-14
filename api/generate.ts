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
      const { prompt, model } = req.body || {}

      console.log('Submitting with model:', model)

      const submitResponse = await fetch('https://api.linkapi.org/v2/videos/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt || '生成一个视频',
          model: model || 'doubao-seedance-1-5-pro-251215',
          duration: 5,
          aspect_ratio: '9:16'
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

      // 尝试多种可能的字段名
      const taskId = submitData.task_id || submitData.taskId || submitData.id || submitData.taskID
      
      if (!taskId) {
        return res.status(200).json({ 
          success: false, 
          error: '无法获取任务ID',
          raw: JSON.stringify(submitData)
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
