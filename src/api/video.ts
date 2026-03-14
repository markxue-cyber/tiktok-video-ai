// 视频生成API调用
const generateVideoAPI = async (prompt: string, model: string): Promise<{videoUrl: string, taskId: string, message: string}> => {
  // 映射UI模型到API模型
  const modelMap: Record<string, string> = {
    'sora': 'sora_video2',
    'kling': 'doubao-seedance-1-5-pro-251215', // kling不可用，用seedance
    'runway': 'veo3',
    'seedance': 'doubao-seedance-1-5-pro-251215'
  }
  
  const apiModel = modelMap[model] || 'doubao-seedance-1-5-pro-251215'
  
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model: apiModel })
  })
  
  const data = await response.json()
  console.log('Submit Response:', data)
  
  if (!data.success) {
    throw new Error(data.error || '提交失败')
  }
  
  return {
    videoUrl: '',
    taskId: data.taskId,
    message: data.message || '视频生成中，预计需要3-5分钟'
  }
}

// 查询视频状态
const checkVideoStatus = async (taskId: string): Promise<{status: string, videoUrl: string, progress: string}> => {
  const response = await fetch(`/api/generate?taskId=${taskId}`)
  const data = await response.json()
  return {
    status: data.status,
    videoUrl: data.videoUrl || '',
    progress: data.progress || '0%'
  }
}
