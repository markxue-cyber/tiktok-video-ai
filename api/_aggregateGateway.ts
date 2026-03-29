/**
 * 首页对话等：多聚合 API 服务商（OpenAI 兼容）密钥与 baseUrl 解析
 *
 * 方舟出图：OpenAI 兼容 POST …/images/generations 的 model 须为「推理接入点」ID（以 ep- 开头，如 ep-m-xxxx），
 * 勿填控制台里的模型版本名（如 doubao-seedream-5-0-260128），否则会报「does not support this api」。
 * 在控制台为图片模型创建推理接入点后，将接入点 ID 写入 BYTEDANCE_ARK_IMAGE_MODEL。
 */

export type AggregateGatewayId = 'xiaodoubao' | 'siliconflow' | 'bytedance'

/** 去掉首尾空白、UTF-8 BOM、误粘贴的引号（避免 Vercel 里 Key 带 "" 导致 401） */
export function normalizeApiKeySecret(raw: string | undefined | null): string {
  let s = String(raw ?? '').trim().replace(/^\uFEFF/, '')
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length > 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length > 2)
  ) {
    s = s.slice(1, -1).trim()
  }
  return s
}

export function normalizeGatewayId(raw: unknown): AggregateGatewayId {
  const s = String(raw || '')
    .toLowerCase()
    .trim()
  if (s === 'siliconflow' || s === 'guiji') return 'siliconflow'
  if (
    s === 'bytedance' ||
    s === 'byte' ||
    s === 'volcengine' ||
    s === 'volces' ||
    s === 'ark' ||
    s === 'doubao-ark' ||
    s === '火山方舟' ||
    s === '字节跳动'
  ) {
    return 'bytedance'
  }
  return 'xiaodoubao'
}

export type ResolvedAggregateGateway = {
  id: AggregateGatewayId
  /** 展示名 */
  label: string
  apiKey: string
  baseUrl: string
  /** Chat Completions 用模型 id（各平台在环境变量中配置） */
  chatModel: string
  /** 方舟：须为推理接入点 id（ep-…），非 doubao-seedream-* 模型名（BYTEDANCE_ARK_IMAGE_MODEL） */
  defaultImageModel?: string
}

/**
 * 从环境变量解析指定服务商；未配置 key 时 apiKey 为空字符串
 */
export function resolveAggregateGateway(raw: unknown): ResolvedAggregateGateway {
  const id = normalizeGatewayId(raw)
  if (id === 'siliconflow') {
    const apiKey = normalizeApiKeySecret(process.env.SILICONFLOW_API_KEY)
    /** 与 cloud.siliconflow.cn 控制台密钥一致；官方 Quickstart 为 https://api.siliconflow.cn/v1（误用 .com 易 401） */
    const baseUrl = String(process.env.SILICONFLOW_AI_BASE_URL || 'https://api.siliconflow.cn/v1').replace(
      /\/+$/,
      '',
    )
    /** 首页含看图/视频，须 VLM；纯 7B Instruct 会报「not a VLM」 */
    const chatModel = String(
      process.env.SILICONFLOW_CHAT_MODEL || 'Qwen/Qwen3-VL-8B-Instruct',
    ).trim()
    return { id, label: '硅基流动', apiKey, baseUrl, chatModel }
  }
  if (id === 'bytedance') {
    /** 火山方舟 OpenAI 兼容：控制台 API Key；地域见文档可改 BASE_URL */
    const apiKey = normalizeApiKeySecret(process.env.BYTEDANCE_ARK_API_KEY)
    const baseUrl = String(
      process.env.BYTEDANCE_ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    ).replace(/\/+$/, '')
    /** 多为推理接入点 ID（ep-）或模型名，请与控制台一致 */
    const chatModel = String(process.env.BYTEDANCE_ARK_CHAT_MODEL || 'doubao-1-5-vision-pro-32k').trim()
    const defaultImageModel = String(process.env.BYTEDANCE_ARK_IMAGE_MODEL || '').trim()
    return {
      id,
      label: '字节跳动(方舟)',
      apiKey,
      baseUrl,
      chatModel,
      ...(defaultImageModel ? { defaultImageModel } : {}),
    }
  }
  const apiKey = normalizeApiKeySecret(process.env.XIAO_DOU_BAO_API_KEY)
  const baseUrl = String(process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1').replace(/\/+$/, '')
  const chatModel = String(process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o').trim()
  return { id, label: '小豆包', apiKey, baseUrl, chatModel }
}
