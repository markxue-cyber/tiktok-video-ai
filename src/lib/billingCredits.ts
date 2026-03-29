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

export function creditsForVideo(): number {
  return CREDITS_PER_VIDEO
}
