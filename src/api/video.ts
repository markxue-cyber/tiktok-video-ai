export type VideoSubmitResult = { taskId: string; message: string }
export type VideoStatusResult = { status: string; videoUrl: string; progress: string; failReason?: string }

// 视频生成API调用
export const generateVideoAPI = async (
  prompt: string,
  model: string,
  opts?: { durationSec?: number; aspectRatio?: string; resolution?: string; refImage?: string },
): Promise<VideoSubmitResult> => {
  // 映射UI模型到API模型
  const modelMap: Record<string, string> = {
    'sora': 'sora-2',
    'kling': 'doubao-seedance-1-5-pro-251215', // kling不可用，用seedance
    'runway': 'veo3',
    'seedance': 'doubao-seedance-1-5-pro-251215'
  }

  // 如果传入的本身就是聚合API支持的模型字符串，则直接透传
  const apiModel = modelMap[model] || model || 'doubao-seedance-1-5-pro-251215'
  
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: apiModel,
      duration: opts?.durationSec,
      aspect_ratio: opts?.aspectRatio,
      resolution: opts?.resolution,
      refImage: opts?.refImage,
    }),
  })
  
  const data = await response.json()

  if (!response.ok || !data?.success) {
    const raw = data?.raw ? `\nraw: ${JSON.stringify(data.raw).slice(0, 1200)}` : ''
    throw new Error((data?.error || `提交失败(${response.status})`) + raw)
  }

  if (!data.taskId) {
    throw new Error('提交成功但未返回taskId')
  }

  return { taskId: data.taskId, message: data.message || '视频生成中，预计需要3-5分钟' }
}

// 查询视频状态
export const checkVideoStatus = async (taskId: string): Promise<VideoStatusResult> => {
  const response = await fetch(`/api/generate?taskId=${taskId}`)
  const data = await response.json()
  return {
    status: data.status || 'unknown',
    videoUrl: data.videoUrl || '',
    progress: data.progress || '0%',
    failReason: data.failReason || data.fail_reason
  }
}
