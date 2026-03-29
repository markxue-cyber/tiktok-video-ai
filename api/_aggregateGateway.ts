/**
 * 首页对话等：多聚合 API 服务商（OpenAI 兼容）密钥与 baseUrl 解析
 */

export type AggregateGatewayId = 'xiaodoubao' | 'siliconflow'

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
}

/**
 * 从环境变量解析指定服务商；未配置 key 时 apiKey 为空字符串
 */
export function resolveAggregateGateway(raw: unknown): ResolvedAggregateGateway {
  const id = normalizeGatewayId(raw)
  if (id === 'siliconflow') {
    const apiKey = normalizeApiKeySecret(process.env.SILICONFLOW_API_KEY)
    const baseUrl = String(process.env.SILICONFLOW_AI_BASE_URL || 'https://api.siliconflow.com/v1').replace(
      /\/+$/,
      '',
    )
    const chatModel = String(
      process.env.SILICONFLOW_CHAT_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
    ).trim()
    return { id, label: '硅基流动', apiKey, baseUrl, chatModel }
  }
  const apiKey = normalizeApiKeySecret(process.env.XIAO_DOU_BAO_API_KEY)
  const baseUrl = String(process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1').replace(/\/+$/, '')
  const chatModel = String(process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o').trim()
  return { id, label: '小豆包', apiKey, baseUrl, chatModel }
}
