// Vercel Serverless Function - 视频生成API
export default async function handler(req, res) {
  res.setTimeout(60 * 1000) // 60秒超时

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' })
    }

    const { prompt, model } = req.body || {}
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'API Key未配置' })
    }

    // 1. 提交视频生成任务
    const submitResponse = await fetch('https://api.linkapi.org/v2/videos/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt || '生成一个视频',
        model: model || 'kling', // 默认用kling
        duration: 5,
        aspect_ratio: '9:16'
      })
    })

    const submitData = await submitResponse.json()
    console.log('Submit Response:', JSON.stringify(submitData))

    if (submitData.error) {
      return res.status(400).json({ success: false, error: submitData.error.message || '提交任务失败' })
    }

    const taskId = submitData.task_id
    if (!taskId) {
      return res.status(400).json({ success: false, error: '无法获取任务ID' })
    }

    // 2. 轮询查询任务状态
    const maxAttempts = 30 // 最多等待30次
    let attempts = 0

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)) // 等待2秒

      const statusResponse = await fetch(`https://api.linkapi.org/v2/videos/generations/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      })

      const statusData = await statusResponse.json()
      console.log('Status:', statusData.status, 'Progress:', statusData.progress)

      if (statusData.status === 'SUCCESS') {
        const videoUrl = statusData.data?.output || statusData.data?.outputs?.[0]
        if (videoUrl) {
          return res.status(200).json({ success: true, videoUrl })
        }
      } else if (statusData.status === 'FAILURE') {
        return res.status(400).json({ success: false, error: statusData.fail_reason || '生成失败' })
      }

      attempts++
    }

    // 超时，返回进行中
    return res.status(200).json({ 
      success: true, 
      taskId,
      status: 'processing',
      message: '视频生成中，请稍后查询'
    })

  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({ success: false, error: error.message || '服务器错误' })
  }
}
