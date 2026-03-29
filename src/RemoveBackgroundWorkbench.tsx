/**
 * 去除背景工作台（与通用 ImageToolWorkbench 共用实现）
 */
import { ImageToolWorkbench, type ImageToolHistoryTask } from './ImageToolWorkbench'

export function RemoveBackgroundWorkbench({
  canGenerate,
  onRefreshUser,
  onOptimisticCreditsSpend,
}: {
  canGenerate: boolean
  onRefreshUser?: () => void | Promise<void>
  onOptimisticCreditsSpend?: (amount: number) => void
}) {
  return (
    <ImageToolWorkbench
      tool="removeBg"
      canGenerate={canGenerate}
      onRefreshUser={onRefreshUser}
      onOptimisticCreditsSpend={onOptimisticCreditsSpend}
    />
  )
}

export type RemoveBgHistoryTask = ImageToolHistoryTask
