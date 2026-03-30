/** 与后端 `api/_billing.js` 保持一致 */
export const CREDITS_PER_IMAGE = 4
export const CREDITS_PER_VIDEO = 8

/** 加油包：每 1 元兑换积分（与 `TOPUP_CREDITS_PER_YUAN` 环境变量 / 服务端 `getTopupCreditsPerYuan` 默认一致） */
export const TOPUP_CREDITS_PER_YUAN = 10

/** 与下单接口 `planId: credit_topup` 一致 */
export const TOPUP_PLAN_ID = 'credit_topup'

export function creditsForTopupYuan(yuan: number): number {
  const y = Math.floor(Number(yuan))
  if (!Number.isFinite(y) || y <= 0) return 0
  return y * TOPUP_CREDITS_PER_YUAN
}

export function estimateImagesFromCredits(credits: number): number {
  const c = Math.max(0, Math.floor(Number(credits) || 0))
  return Math.floor(c / CREDITS_PER_IMAGE)
}

export function estimateVideosFromCredits(credits: number): number {
  const c = Math.max(0, Math.floor(Number(credits) || 0))
  return Math.floor(c / CREDITS_PER_VIDEO)
}

export function creditsForImageCount(count: number): number {
  const n = Math.max(1, Math.min(6, Math.floor(Number(count) || 1)))
  return CREDITS_PER_IMAGE * n
}

/** 首页对话出图：与 `api/home-chat-turn` 中 `runNanoBananaGeneration` 张数上限一致 */
export function creditsForHomeChatImageCount(count: number): number {
  const n = Math.max(1, Math.min(4, Math.floor(Number(count) || 1)))
  return CREDITS_PER_IMAGE * n
}

/**
 * 首页对话「正式出图」阶段：与 `api/home-chat-turn.ts` 中 nano 循环一致（每场最多 4 次、每次 1 张）。
 * 用于提交瞬间的乐观扣显示；结束后仍以 `/api/me` 为准。
 */
export function optimisticCreditsForHomeChatFinalGen(params: {
  multiRatio: boolean
  abVariant: boolean
  imageCount: number
}): number {
  const ratioN = params.multiRatio ? 2 : 1
  const variantN = params.abVariant ? 2 : 1
  const countN = Math.max(1, Math.min(2, Math.floor(Number(params.imageCount) || 1)))
  const jobs = Math.min(4, ratioN * variantN * countN)
  return jobs * CREDITS_PER_IMAGE
}

export function creditsForVideo(): number {
  return CREDITS_PER_VIDEO
}
