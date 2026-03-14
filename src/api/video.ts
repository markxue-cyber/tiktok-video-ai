// 视频生成API调用
const generateVideoAPI = async (prompt: string, model: string): Promise<string> => {
  try {
    // 调用Vercel Serverless Function
    const response = await fetch('/api/generate-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        prompt, 
        model 
      })
    })
    
    const data = await response.json()
    
    if (data.success && data.videoUrl) {
      return data.videoUrl
    } else if (data.taskId) {
      // 异步任务，轮询获取结果
      return await pollVideoResult(data.taskId)
    } else if (data.error) {
      throw new Error(data.error)
    } else {
      throw new Error('生成失败')
    }
  } catch (error) {
    console.error('API调用失败:', error)
    throw error
  }
}

// 轮询视频生成结果
const pollVideoResult = async (taskId: string): Promise<string> => {
  const maxAttempts = 30 // 最多等待30次
  const interval = 5000 // 每次等待5秒
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, interval))
    
    try {
      const response = await fetch(`/api/get-video?taskId=${taskId}`)
      const data = await response.json()
      
      if (data.success && data.videoUrl) {
        return data.videoUrl
      }
      if (data.status === 'failed') {
        throw new Error('视频生成失败')
      }
    } catch (e) {
      console.log('轮询中...')
    }
  }
  
  throw new Error('等待超时')
}

export { generateVideoAPI }
