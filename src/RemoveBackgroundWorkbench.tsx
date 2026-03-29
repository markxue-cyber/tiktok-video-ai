/**
 * 去除背景工作台（与通用 ImageToolWorkbench 共用实现）
 */
import { ImageToolWorkbench, type ImageToolHistoryTask } from './ImageToolWorkbench'

export function RemoveBackgroundWorkbench({
  canGenerate,
  onRefreshUser,
}: {
  canGenerate: boolean
  onRefreshUser?: () => void | Promise<void>
}) {
  return <ImageToolWorkbench tool="removeBg" canGenerate={canGenerate} onRefreshUser={onRefreshUser} />
}

export type RemoveBgHistoryTask = ImageToolHistoryTask
