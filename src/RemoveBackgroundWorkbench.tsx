/**
 * 去除背景工作台（与通用 ImageToolWorkbench 共用实现）
 */
import { ImageToolWorkbench, type ImageToolHistoryTask } from './ImageToolWorkbench'

export function RemoveBackgroundWorkbench() {
  return <ImageToolWorkbench tool="removeBg" />
}

export type RemoveBgHistoryTask = ImageToolHistoryTask
