// 小豆包API视频生成后端服务
// 部署说明：将此文件部署到 Vercel Serverless Functions 或其他 Node.js 环境

const API_BASE_URL = 'https://api.linkapi.org'
const API_KEY = 'sk-Yn9a05NYrok5Ivr8MdQE6KJbTY8VoAgkFPeObHnPYJqqzaEp'

export default async function handler(req, res) {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const { prompt, model, duration, aspect_ratio } = req.body

    // 验证参数
    if (!prompt) {
      return res.status(400).json({ success: false, error: '缺少 prompt 参数' })
    }

    // 调用小豆包API的视频生成接口
    // 注意：这里需要根据小豆包API的实际接口格式进行调整
    const response = await fetch(`${API_BASE_URL}/v1/video/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'sora',
        prompt: prompt,
        duration: duration || 5,
        aspect_ratio: aspect_ratio || '9:16'
      })
    })

    const data = await response.json()

    if (data.error) {
      return res.status(400).json({ success: false, error: data.error.message || 'API调用失败' })
    }

    // 根据实际返回格式处理
    // 小豆包API可能返回的是异步任务，需要轮询
    const videoUrl = data.video_url || data.url || data.output?.[0]
    
    if (!videoUrl) {
      // 如果是异步任务，返回任务ID
      if (data.id) {
        return res.status(200).json({ 
          success: true, 
          taskId: data.id,
          message: '视频生成中，请轮询获取结果'
        })
      }
      return res.status(500).json({ success: false, error: '未获取到视频URL' })
    }

    return res.status(200).json({ 
      success: true, 
      videoUrl: videoUrl 
    })

  } catch (error) {
    console.error('视频生成错误:', error)
    return res.status(500).json({ 
      success: false, 
      error: error.message || '服务器错误' 
    })
  }
}
