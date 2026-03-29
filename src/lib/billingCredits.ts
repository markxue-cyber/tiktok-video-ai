/** 与后端 `api/_billing.js` 保持一致 */
export const CREDITS_PER_IMAGE = 4
export const CREDITS_PER_VIDEO = 8

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
