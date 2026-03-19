export type TemplateScene = 'video' | 'image'

export type VideoTemplatePreset = {
  model?: string
  aspectRatio?: string
  resolution?: string
  durationSec?: number
  prompt: string
}

export type ImageTemplatePreset = {
  model?: string
  aspectRatio?: string
  resolution?: string
  prompt: string
}

export type VideoTemplateItem = {
  id: string
  scene: 'video'
  title: string
  subtitle: string
  tags: string[]
  cover?: string
  preset: VideoTemplatePreset
}

export type ImageTemplateItem = {
  id: string
  scene: 'image'
  title: string
  subtitle: string
  tags: string[]
  cover?: string
  preset: ImageTemplatePreset
}

export const VIDEO_TEMPLATES: VideoTemplateItem[] = [
  {
    id: 'video-hot-sale-unbox',
    scene: 'video',
    title: '电商爆品开箱',
    subtitle: '适合 3C / 家电 / 小家居，强调第一眼钩子',
    tags: ['爆品', '开箱', '转化导向'],
    preset: {
      model: 'sora-2',
      aspectRatio: '9:16',
      resolution: '1080p',
      durationSec: 10,
      prompt:
        '开场1秒给出强钩子镜头，快速展示产品外观与核心细节；中段用2-3个分镜展示真实使用场景与关键卖点；结尾给出清晰行动引导，节奏紧凑，画面高级且真实。',
    },
  },
  {
    id: 'video-pain-solution',
    scene: 'video',
    title: '痛点对比转化',
    subtitle: '先痛点后解决方案，适合日用品和功能型商品',
    tags: ['痛点', '对比', '种草'],
    preset: {
      model: 'sora-2',
      aspectRatio: '9:16',
      resolution: '720p',
      durationSec: 12,
      prompt:
        '先展示用户常见痛点场景，再切换到产品解决方案；通过前后对比突出效果差异；镜头语言简洁明确，字幕保留关键短句，避免堆砌文案。',
    },
  },
  {
    id: 'video-brand-premium',
    scene: 'video',
    title: '品牌质感短片',
    subtitle: '强调高端质感与品牌调性，适合新品发布',
    tags: ['高端', '品牌', '质感'],
    preset: {
      model: 'veo3',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSec: 10,
      prompt:
        '通过电影化光影与干净构图突出产品材质和细节，镜头运动克制，整体节奏高级；中后段加入使用动作与场景氛围，结尾强化品牌识别与记忆点。',
    },
  },
]

export const IMAGE_TEMPLATES: ImageTemplateItem[] = [
  {
    id: 'image-clean-main',
    scene: 'image',
    title: '电商主图（干净白底）',
    subtitle: '适合平台主图，信息清晰、主体突出',
    tags: ['主图', '白底', '清晰'],
    preset: {
      model: 'seedream',
      aspectRatio: '1:1',
      resolution: '2048',
      prompt:
        '产品主体居中，背景干净简洁，商业棚拍质感，高光控制自然，边缘清晰锐利，保留适度留白便于后续贴卖点标签。',
    },
  },
  {
    id: 'image-lifestyle',
    scene: 'image',
    title: '生活场景海报',
    subtitle: '适合社媒投放，突出真实使用情境',
    tags: ['场景', '种草', '社媒'],
    preset: {
      model: 'seedream',
      aspectRatio: '4:3',
      resolution: '2048',
      prompt:
        '在真实生活场景中展示产品使用状态，主体占比高，背景元素弱化不抢镜，光线自然柔和，整体干净高级，强调“可代入感”。',
    },
  },
  {
    id: 'image-feature-poster',
    scene: 'image',
    title: '卖点功能海报',
    subtitle: '适合详情页，突出功能结构与细节',
    tags: ['卖点', '功能', '详情页'],
    preset: {
      model: 'flux-pro',
      aspectRatio: '9:16',
      resolution: '1536',
      prompt:
        '突出产品关键结构与功能细节，构图规整、信息层级清晰；画面保持商业广告质感，色彩克制，主体细节锐利，避免复杂背景干扰。',
    },
  },
]

