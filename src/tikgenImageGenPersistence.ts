/**
 * 电商套图页持久化：localStorage 容量小（~5MB），data URL 参考图 + 看板 JSON 易触发 QuotaExceeded 且被静默忽略。
 * 完整数据写入 IndexedDB；localStorage 仅存去掉巨型 data: 的精简副本作兜底。
 */

export const TIKGEN_IG_LS_HISTORY = 'tikgen.imageGenHistory.v1'
/** 图片生成（简版）独立 localStorage，避免与电商套图双实例互相覆盖 */
export const TIKGEN_IG_LS_HISTORY_SIMPLE = 'tikgen.imageGenHistory.simple.v1'
export const TIKGEN_IG_LS_BOARD = 'tikgen.sceneRunBoard.v1'
export const TIKGEN_IG_LS_BOARD_SIMPLE = 'tikgen.sceneRunBoard.simple.v1'

const IDB_NAME = 'tikgen_image_gen'
const IDB_STORE = 'kv'
const IDB_VER = 1

export const TIKGEN_IG_IDB = {
  history: 'imageGenHistory.v1',
  historySimple: 'imageGenHistory.simple.v1',
  board: 'sceneRunBoard.v1',
  /** 图片生成（简版）：与电商套图分开展示看板，避免互相覆盖 */
  boardSimple: 'sceneRunBoard.simple.v1',
  refs: 'refImages.v1',
  workspace: 'workspace.v1',
  workspaceSimple: 'workspace.simple.v1',
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

/** 判断是否像可持久化的图片地址（用于合并时择优） */
export function isLikelyPersistedImageUrl(u: unknown): boolean {
  if (typeof u !== 'string') return false
  const s = u.trim()
  if (!s || s === 'undefined' || s === 'null') return false
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('data:') ||
    s.startsWith('blob:')
  )
}

function pickRicherImageUrl(a: string, b: string): string {
  const score = (u: string) => {
    if (!isLikelyPersistedImageUrl(u)) return 0
    if (u.trim().startsWith('data:')) return 3
    if (u.trim().startsWith('http://') || u.trim().startsWith('https://')) return 2
    if (u.trim().startsWith('blob:')) return 1
    return 0
  }
  const sa = score(a)
  const sb = score(b)
  if (sa > sb) return a.trim()
  if (sb > sa) return b.trim()
  return (a.trim() || b.trim())
}

function mergeTwoImageGenHistoryRecords(p: Record<string, unknown>, q: Record<string, unknown>): Record<string, unknown> {
  const [newer, older] = Number(p.ts) >= Number(q.ts) ? [p, q] : [q, p]
  const o1 = Array.isArray(newer.outputUrls) ? (newer.outputUrls as unknown[]) : []
  const o2 = Array.isArray(older.outputUrls) ? (older.outputUrls as unknown[]) : []
  const len = Math.max(o1.length, o2.length)
  const outputUrls: string[] = []
  for (let i = 0; i < len; i++) {
    const u1 = typeof o1[i] === 'string' ? String(o1[i]).trim() : ''
    const u2 = typeof o2[i] === 'string' ? String(o2[i]).trim() : ''
    outputUrls.push(pickRicherImageUrl(u1, u2))
  }
  const r1 = typeof newer.refThumb === 'string' ? newer.refThumb.trim() : ''
  const r2 = typeof older.refThumb === 'string' ? older.refThumb.trim() : ''
  const refThumb = pickRicherImageUrl(r1, r2) || r1 || r2
  const slNewer = newer.sceneLabels
  const slOlder = older.sceneLabels
  const stNewer = newer.sceneTeasers
  const stOlder = older.sceneTeasers
  const sdNewer = newer.sceneDescriptions
  const sdOlder = older.sceneDescriptions
  return {
    ...newer,
    outputUrls,
    refThumb,
    sceneLabels: Array.isArray(slNewer) && slNewer.length ? slNewer : slOlder,
    sceneTeasers: Array.isArray(stNewer) && stNewer.length ? stNewer : stOlder,
    sceneDescriptions: Array.isArray(sdNewer) && sdNewer.length ? sdNewer : sdOlder,
  }
}

/**
 * 合并 IndexedDB 与 localStorage 两套生成历史：同一 task id 下对 outputUrls/refThumb 逐槽择优，
 * 避免「一端因配额精简丢链、另一端仍有完整地址」时整批缩略图失效。
 */
export function mergeImageGenHistorySnapshots(
  idbTasks: unknown[] | null | undefined,
  lsTasks: unknown[] | null | undefined,
): unknown[] {
  const a = Array.isArray(idbTasks) ? idbTasks : []
  const b = Array.isArray(lsTasks) ? lsTasks : []
  if (!a.length) return b.slice()
  if (!b.length) return a.slice()

  const byId = new Map<string, Record<string, unknown>>()
  const ingest = (t: unknown) => {
    if (!t || typeof t !== 'object' || typeof (t as { id?: unknown }).id !== 'string') return
    const rec = t as Record<string, unknown>
    const id = String(rec.id)
    const prev = byId.get(id)
    if (!prev) {
      byId.set(id, { ...rec })
      return
    }
    byId.set(id, mergeTwoImageGenHistoryRecords(prev, rec))
  }
  for (const t of a) ingest(t)
  for (const t of b) ingest(t)
  return Array.from(byId.values()).sort((x, y) => Number(y.ts) - Number(x.ts))
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

export function loadSceneRunBoardFromLocalStorage(
  key: string = TIKGEN_IG_LS_BOARD,
): Record<string, unknown> | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && typeof p.id === 'string' && typeof p.ts === 'number' && Array.isArray(p.slots)) return p
  } catch {
    // ignore
  }
  return null
}
