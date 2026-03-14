// Vercel Serverless Function - 视频生成API
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' })
    }

    const { prompt, model } = req.body || {}
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'API Key未配置' })
    }

    // 提交视频生成任务
    const submitResponse = await fetch('https://api.linkapi.org/v2/videos/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt || '生成一个视频',
        model: model || 'kling',
        duration: 5,
        aspect_ratio: '9:16'
      })
    })

    const submitData = await submitResponse.json()
    console.log('Submit Response:', JSON.stringify(submitData))

    if (submitData.error) {
      return res.status(200).json({ 
        success: false, 
        error: submitData.error.message || '提交失败',
        note: submitData
      })
    }

    const taskId = submitData.task_id
    if (!taskId) {
      return res.status(200).json({ 
        success: false, 
        error: '无法获取任务ID',
        raw: submitData 
      })
    }

    // 任务提交成功，立即返回
    return res.status(200).json({ 
      success: true, 
      taskId: taskId,
      message: '任务已提交'
    })

  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({ success: false, error: error.message })
  }
}
