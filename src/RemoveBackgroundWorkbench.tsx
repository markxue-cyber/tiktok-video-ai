/**
 * 去除背景工作台（与通用 ImageToolWorkbench 共用实现）
 */
import { ImageToolWorkbench, type ImageToolHistoryTask } from './ImageToolWorkbench'

export function RemoveBackgroundWorkbench({ canGenerate }: { canGenerate: boolean }) {
  return <ImageToolWorkbench tool="removeBg" canGenerate={canGenerate} />
}

export type RemoveBgHistoryTask = ImageToolHistoryTask
