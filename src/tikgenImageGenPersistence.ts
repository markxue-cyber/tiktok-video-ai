/**
 * 电商套图页持久化：localStorage 容量小（~5MB），data URL 参考图 + 看板 JSON 易触发 QuotaExceeded 且被静默忽略。
 * 完整数据写入 IndexedDB；localStorage 仅存去掉巨型 data: 的精简副本作兜底。
 */

export const TIKGEN_IG_LS_HISTORY = 'tikgen.imageGenHistory.v1'
export const TIKGEN_IG_LS_BOARD = 'tikgen.sceneRunBoard.v1'

const IDB_NAME = 'tikgen_image_gen'
const IDB_STORE = 'kv'
const IDB_VER = 1

export const TIKGEN_IG_IDB = {
  history: 'imageGenHistory.v1',
  board: 'sceneRunBoard.v1',
  refs: 'refImages.v1',
  workspace: 'workspace.v1',
  /** 去除背景：待上传图 + 分辨率/格式（data URL 较大，放 IDB） */
  removeBgWorkspace: 'removeBg.workspace.v1',
  /** 去除背景：进行中的批量任务，用于刷新后续传 */
  removeBgJob: 'removeBg.job.v1',
  /** 高清放大 */
  imageUpscaleWorkspace: 'imageUpscale.workspace.v1',
  imageUpscaleJob: 'imageUpscale.job.v1',
  /** 图片压缩 */
  imageCompressWorkspace: 'imageCompress.workspace.v1',
  imageCompressJob: 'imageCompress.job.v1',
  /** 图片翻译 */
  imageTranslateWorkspace: 'imageTranslate.workspace.v1',
  imageTranslateJob: 'imageTranslate.job.v1',
  /** 各工具「生成历史」完整数据（含 data URL），避免仅写 localStorage 触发配额后刷新全丢 */
  removeBgHistoryFull: 'removeBg.historyFull.v1',
  imageUpscaleHistoryFull: 'imageUpscale.historyFull.v1',
  imageCompressHistoryFull: 'imageCompress.historyFull.v1',
  imageTranslateHistoryFull: 'imageTranslate.historyFull.v1',
  /** 视频工具 · 画质提升历史（含输入/输出 URL） */
  videoUpscaleHistoryFull: 'videoUpscale.historyFull.v1',
  /** 视频工具 · 视频增强：左侧表单（输入 URL、参数） */
  videoUpscaleWorkspace: 'videoUpscale.workspace.v1',
  /** 视频工具 · 视频生成：表单 + 进行中任务（刷新后续传） */
  videoGeneratorWorkspace: 'videoGenerator.workspace.v1',
  /** 视频分析 · 会话历史（含多模态 data URL，体积可能较大） */
  videoAnalyzeSessions: 'videoAnalyze.sessions.v1',
} as const

/** 视频分析对话消息（持久化） */
export type VideoAnalyzeChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** 大视频：直传后的公网 URL（小图/小视频仍可用 data URL） */
  videoRemoteUrl?: string
  videoDataUrl?: string
  imageDataUrls?: string[]
}

/** 视频分析会话存档 */
export type VideoAnalyzeSessionStored = {
  id: string
  title: string
  updatedAt: number
  messages: VideoAnalyzeChatMessage[]
}

/** 视频生成页持久化快照 */
export type VideoGeneratorWorkspaceV1 = {
  v: 1
  prompt: string
  model: string
  size: string
  resolution: string
  durationSec: number
  refImagePreviewUrl: string
  refImageDataUrl: string
  productInfo: Record<string, unknown>
  scripts: string[]
  scriptBatches: string[][]
  scriptBatchIdx: number
  scriptRefreshCount: number
  selectedScript: string
  optimizedPrompt: string
  tags: string[]
  generatedVideo: string
  taskId: string
  progress: string
  statusText: string
  errorText: string
  errorCode: string
  isGenerating: boolean
}

/** 视频增强（画质提升）左侧工作区 */
export type VideoUpscaleWorkspaceV1 = {
  v: 1
  publicVideoUrl: string
  durationSec: number
  videoW: number
  videoH: number
  targetRes: '1080p' | '2k' | '4k'
  targetFps: 30 | 60
  inputName?: string
}

export type TikgenWorkspaceSnapshotV1 = {
  v: 1
  prompt: string
  optimizedPrompt: string
  optimizedNegativePrompt: string
  productAnalysisText: string
  productInfo: Record<string, unknown>
  hotStyles: unknown[]
  selectedHotStyleIndex: number
  productStylePanelOpen: boolean
  model: string
  size: string
  resolution: string
  sceneMode: string
  promptGenOutputSettings: { aspect: string; resolution: string } | null
  imageScenes: unknown[]
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VER)
      req.onerror = () => reject(req.error)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => resolve(req.result)
    })
  }
  return dbPromise
}

export async function tikgenIgIdbSet(key: string, value: unknown): Promise<void> {
  try {
    const p = openDb()
    if (!p) return
    const db = await p
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(IDB_STORE).put(value, key)
    })
  } catch (e) {
    console.warn('[tikgen] IndexedDB put failed:', key, e)
  }
}

export async function tikgenIgIdbGet<T>(key: string): Promise<T | null> {
  try {
    const p = openDb()
    if (!p) return null
    const db = await p
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const r = tx.objectStore(IDB_STORE).get(key)
      r.onsuccess = () => resolve((r.result ?? null) as T | null)
      r.onerror = () => reject(r.error)
    })
  } catch {
    return null
  }
}

export async function tikgenIgIdbDelete(key: string): Promise<void> {
  try {
    const p = openDb()
    if (!p) return
    const db = await p
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(IDB_STORE).delete(key)
    })
  } catch (e) {
    console.warn('[tikgen] IndexedDB delete failed:', key, e)
  }
}

function stripDataUrl(s: unknown): string {
  if (typeof s !== 'string') return ''
  if (s.startsWith('data:')) return ''
  return s
}

/** localStorage 用：去掉巨型 data URL，避免整段 JSON 写入失败 */
export function stripBoardForLocalStorage(board: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!board || typeof board !== 'object') return board
  const slots = Array.isArray(board.slots)
    ? (board.slots as Record<string, unknown>[]).map((s) => ({
        ...s,
        imageUrl:
          typeof s.imageUrl === 'string' && s.imageUrl.startsWith('data:') ? undefined : s.imageUrl,
      }))
    : board.slots
  return {
    ...board,
    refThumb: stripDataUrl(board.refThumb),
    slots,
  }
}

export function stripHistoryForLocalStorage(tasks: unknown[]): unknown[] {
  if (!Array.isArray(tasks)) return []
  return tasks.map((t) => {
    if (!t || typeof t !== 'object') return t
    const x = t as Record<string, unknown>
    return {
      ...x,
      refThumb: stripDataUrl(x.refThumb),
    }
  })
}

/** 图片工具历史：localStorage 用，去掉 refThumb 与 outputUrls 中的 data URL，防止整段 JSON 写入失败 */
export function stripImageToolHistoryForLocalStorage(tasks: unknown[]): unknown[] {
  if (!Array.isArray(tasks)) return []
  return tasks.map((t) => {
    if (!t || typeof t !== 'object') return t
    const x = t as Record<string, unknown>
    const outs = Array.isArray(x.outputUrls)
      ? (x.outputUrls as unknown[]).map((u) => (typeof u === 'string' && u.startsWith('data:') ? '' : u))
      : []
    return {
      ...x,
      refThumb: stripDataUrl(x.refThumb),
      outputUrls: outs,
    }
  })
}

export function tryLocalStorageSetJson(key: string, value: unknown): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    console.warn('[tikgen] localStorage.setItem failed (often quota):', key, e)
    return false
  }
}

export function loadSceneRunBoardFromLocalStorage(): Record<string, unknown> | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(TIKGEN_IG_LS_BOARD)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && typeof p.id === 'string' && typeof p.ts === 'number' && Array.isArray(p.slots)) return p
  } catch {
    // ignore
  }
  return null
}
