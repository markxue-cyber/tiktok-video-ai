import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Clock,
  Download,
  Eraser,
  Image as ImageIcon,
  Languages,
  Maximize2,
  Minimize2,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { createAssetAPI } from './api/assets'
import { archiveAiMediaOnce } from './utils/archiveAiMediaOnce'
import { imageToolNanoAPI } from './api/imageToolNano'
import { removeBackgroundAPI } from './api/removeBackground'
import { DEFAULT_TARGET_LANG, TARGET_LANGUAGES, type TargetLanguageCode, targetLangByCode } from './imageTool/targetLanguages'
import {
  stripImageToolHistoryForLocalStorage,
  tikgenIgIdbDelete,
  tikgenIgIdbGet,
  tikgenIgIdbSet,
  TIKGEN_IG_IDB,
  tryLocalStorageSetJson,
} from './tikgenImageGenPersistence'
import { buildDownloadProxyUrl, triggerProxyDownload } from './utils/downloadProxy'
import { CreditCostWithZap } from './components/CreditCostWithZap'
import { CREDITS_PER_IMAGE } from './lib/billingCredits'

const MAX_IMAGES = 5
const HISTORY_MAX = 80

export type ImageToolHistoryTask = {
  id: string
  ts: number
  refThumb: string
  prompt: string
  modelLabel: string
  resolutionLabel: string
  formatLabel: string
  requestedCount: number
  status: 'active' | 'completed' | 'failed'
  progress: number
  outputUrls: string[]
  errorMessage?: string
}

/** @deprecated 使用 ImageToolHistoryTask */
export type RemoveBgHistoryTask = ImageToolHistoryTask

export type ImageToolMode = 'removeBg' | 'upscale' | 'compress' | 'translate'

type ToolRuntime = {
  historyKey: string
  /** IndexedDB：完整历史（含成片 data URL） */
  historyIdbKey: string
  workspaceKey: string
  jobKey: string
  archiveInputFrom: string
  archiveOutputTool: string
  downloadBase: string
  taskPrefix: string
  emptySubtext: string
  submitLabel: string
  SubmitIcon: LucideIcon
}

const RUNTIME: Record<ImageToolMode, ToolRuntime> = {
  removeBg: {
    historyKey: 'tikgen.removeBg.history',
    historyIdbKey: TIKGEN_IG_IDB.removeBgHistoryFull,
    workspaceKey: TIKGEN_IG_IDB.removeBgWorkspace,
    jobKey: TIKGEN_IG_IDB.removeBgJob,
    archiveInputFrom: 'remove_background_input',
    archiveOutputTool: 'remove_background',
    downloadBase: 'remove-bg',
    taskPrefix: 'rb_task_',
    emptySubtext: '上传图片并点击「去除背景」后，进度与结果会出现在这里。',
    submitLabel: '去除背景',
    SubmitIcon: Eraser,
  },
  upscale: {
    historyKey: 'tikgen.imageUpscale.history',
    historyIdbKey: TIKGEN_IG_IDB.imageUpscaleHistoryFull,
    workspaceKey: TIKGEN_IG_IDB.imageUpscaleWorkspace,
    jobKey: TIKGEN_IG_IDB.imageUpscaleJob,
    archiveInputFrom: 'image_upscale_input',
    archiveOutputTool: 'image_upscale',
    downloadBase: 'image-upscale',
    taskPrefix: 'up_task_',
    emptySubtext: '上传图片并点击「高清放大」后，进度与结果会出现在这里。',
    submitLabel: '高清放大',
    SubmitIcon: Maximize2,
  },
  compress: {
    historyKey: 'tikgen.imageCompress.history',
    historyIdbKey: TIKGEN_IG_IDB.imageCompressHistoryFull,
    workspaceKey: TIKGEN_IG_IDB.imageCompressWorkspace,
    jobKey: TIKGEN_IG_IDB.imageCompressJob,
    archiveInputFrom: 'image_compress_input',
    archiveOutputTool: 'image_compress',
    downloadBase: 'image-compress',
    taskPrefix: 'cp_task_',
    emptySubtext: '上传图片并点击「图片压缩」后，进度与结果会出现在这里。',
    submitLabel: '图片压缩',
    SubmitIcon: Minimize2,
  },
  translate: {
    historyKey: 'tikgen.imageTranslate.history',
    historyIdbKey: TIKGEN_IG_IDB.imageTranslateHistoryFull,
    workspaceKey: TIKGEN_IG_IDB.imageTranslateWorkspace,
    jobKey: TIKGEN_IG_IDB.imageTranslateJob,
    archiveInputFrom: 'image_translate_input',
    archiveOutputTool: 'image_translate',
    downloadBase: 'image-translate',
    taskPrefix: 'tr_task_',
    emptySubtext: '上传图片并点击「图片翻译」后，进度与结果会出现在这里。',
    submitLabel: '图片翻译',
    SubmitIcon: Languages,
  },
}

type RemoveBgWorkspaceV1 = {
  v: 1
  images: Array<{ id: string; url: string; name?: string }>
  resolution: '1024' | '2048'
  outputFormat: 'png' | 'webp'
}

type UpscaleWorkspaceV1 = {
  v: 1
  images: Array<{ id: string; url: string; name?: string }>
  scale: '2' | '4'
  outputFormat: 'png' | 'jpeg'
}

type CompressWorkspaceV1 = {
  v: 1
  images: Array<{ id: string; url: string; name?: string }>
  compressPercent: number
  outputFormat: 'png' | 'jpeg'
}

type TranslateWorkspaceV1 = {
  v: 1
  images: Array<{ id: string; url: string; name?: string }>
  targetLang: TargetLanguageCode
  outputFormat: 'png' | 'jpeg'
}

type RemoveBgJobV1 = {
  v: 1
  taskId: string
  refUrls: string[]
  resolution: '1024' | '2048'
  outputFormat: 'png' | 'webp'
  outputs: string[]
  tool?: 'removeBg'
}

type UpscaleJobV1 = {
  v: 1
  tool: 'upscale'
  taskId: string
  refUrls: string[]
  scale: '2' | '4'
  outputFormat: 'png' | 'jpeg'
  outputs: string[]
}

type CompressJobV1 = {
  v: 1
  tool: 'compress'
  taskId: string
  refUrls: string[]
  compressPercent: number
  outputFormat: 'png' | 'jpeg'
  outputs: string[]
}

type TranslateJobV1 = {
  v: 1
  tool: 'translate'
  taskId: string
  refUrls: string[]
  targetLang: TargetLanguageCode
  outputFormat: 'png' | 'jpeg'
  outputs: string[]
}

type AnyJobV1 = RemoveBgJobV1 | UpscaleJobV1 | CompressJobV1 | TranslateJobV1
type JobQueueV1 = { v: 1; jobs: AnyJobV1[] }

/** 刷新后续跑时使用任务创建时的参数，避免与当前面板状态不一致 */
type LockedPipelineSettings =
  | { kind: 'removeBg'; resolution: '1024' | '2048'; outputFormat: 'png' | 'webp' }
  | { kind: 'upscale'; scale: '2' | '4'; outputFormat: 'png' | 'jpeg' }
  | { kind: 'compress'; compressPercent: number; outputFormat: 'png' | 'jpeg' }
  | { kind: 'translate'; targetLang: TargetLanguageCode; outputFormat: 'png' | 'jpeg' }

function lockedSettingsFromJob(job: AnyJobV1, t: ImageToolMode): LockedPipelineSettings | undefined {
  if (t === 'removeBg') {
    const j = job as RemoveBgJobV1
    return {
      kind: 'removeBg',
      resolution: j.resolution === '2048' ? '2048' : '1024',
      outputFormat: j.outputFormat === 'webp' ? 'webp' : 'png',
    }
  }
  if (t === 'upscale' && 'tool' in job && job.tool === 'upscale') {
    const j = job as UpscaleJobV1
    return {
      kind: 'upscale',
      scale: j.scale === '4' ? '4' : '2',
      outputFormat: j.outputFormat === 'jpeg' ? 'jpeg' : 'png',
    }
  }
  if (t === 'compress' && 'tool' in job && job.tool === 'compress') {
    const j = job as CompressJobV1
    return {
      kind: 'compress',
      compressPercent: Math.max(1, Math.min(100, Math.round(Number(j.compressPercent) || 80))),
      outputFormat: j.outputFormat === 'jpeg' ? 'jpeg' : 'png',
    }
  }
  if (t === 'translate' && 'tool' in job && job.tool === 'translate') {
    const j = job as TranslateJobV1
    const code = targetLangByCode(j.targetLang) ? j.targetLang : DEFAULT_TARGET_LANG
    return {
      kind: 'translate',
      targetLang: code,
      outputFormat: j.outputFormat === 'jpeg' ? 'jpeg' : 'png',
    }
  }
  return undefined
}

/** IndexedDB 已有进行中的 job，但 localStorage 历史尚未写入或不同步时，从 job 复原一条历史，避免误删 job 导致任务「消失」 */
function buildRecoveryTaskFromJob(job: AnyJobV1, tool: ImageToolMode): ImageToolHistoryTask | null {
  if (job.v !== 1 || !job.taskId || !Array.isArray(job.refUrls) || !job.refUrls.length) return null
  const refThumb = job.refUrls[0] || ''
  const n = job.refUrls.length
  const outs = Array.isArray(job.outputs) ? [...job.outputs] : []
  const done = outs.length >= n && n > 0
  const progress = done ? 100 : Math.max(1, Math.min(99, Math.round((outs.length / Math.max(n, 1)) * 100)))

  if (tool === 'removeBg') {
    const j = job as RemoveBgJobV1
    if ('tool' in j && j.tool != null && j.tool !== 'removeBg') return null
    const res = j.resolution === '2048' ? '2048' : '1024'
    const fmt = j.outputFormat === 'webp' ? 'webp' : 'png'
    return {
      id: j.taskId,
      ts: Date.now(),
      refThumb,
      prompt: `共 ${n} 张`,
      modelLabel: 'Nano Banana 2',
      resolutionLabel: `${res}px`,
      formatLabel: fmt.toUpperCase(),
      requestedCount: n,
      status: done ? 'completed' : 'active',
      progress,
      outputUrls: outs,
    }
  }
  if (tool === 'upscale' && 'tool' in job && job.tool === 'upscale') {
    const j = job as UpscaleJobV1
    const fmt = j.outputFormat === 'jpeg' ? 'JPEG' : 'PNG'
    return {
      id: j.taskId,
      ts: Date.now(),
      refThumb,
      prompt: `共 ${n} 张`,
      modelLabel: 'Nano Banana 2',
      resolutionLabel: `${j.scale === '4' ? '4' : '2'}x`,
      formatLabel: fmt,
      requestedCount: n,
      status: done ? 'completed' : 'active',
      progress,
      outputUrls: outs,
    }
  }
  if (tool === 'compress' && 'tool' in job && job.tool === 'compress') {
    const j = job as CompressJobV1
    const fmt = j.outputFormat === 'jpeg' ? 'JPEG' : 'PNG'
    const pct = Math.max(1, Math.min(100, Math.round(Number(j.compressPercent) || 80)))
    return {
      id: j.taskId,
      ts: Date.now(),
      refThumb,
      prompt: `共 ${n} 张`,
      modelLabel: 'Nano Banana 2',
      resolutionLabel: `${pct}%`,
      formatLabel: fmt,
      requestedCount: n,
      status: done ? 'completed' : 'active',
      progress,
      outputUrls: outs,
    }
  }
  if (tool === 'translate' && 'tool' in job && job.tool === 'translate') {
    const j = job as TranslateJobV1
    const fmt = j.outputFormat === 'jpeg' ? 'JPEG' : 'PNG'
    const code = targetLangByCode(j.targetLang) ? j.targetLang : DEFAULT_TARGET_LANG
    const label = targetLangByCode(code)?.labelZh || code
    return {
      id: j.taskId,
      ts: Date.now(),
      refThumb,
      prompt: `共 ${n} 张`,
      modelLabel: 'Nano Banana 2',
      resolutionLabel: label,
      formatLabel: fmt,
      requestedCount: n,
      status: done ? 'completed' : 'active',
      progress,
      outputUrls: outs,
    }
  }
  return null
}

function parseJobQueue(raw: unknown): AnyJobV1[] {
  if (!raw || typeof raw !== 'object') return []
  const v = raw as Partial<JobQueueV1 & AnyJobV1>
  if (v.v !== 1) return []
  if (Array.isArray((v as JobQueueV1).jobs)) {
    return ((v as JobQueueV1).jobs || []).filter(
      (j): j is AnyJobV1 => !!j && typeof j === 'object' && (j as AnyJobV1).v === 1 && typeof (j as AnyJobV1).taskId === 'string',
    )
  }
  if (typeof v.taskId === 'string' && Array.isArray((v as AnyJobV1).refUrls)) {
    return [v as AnyJobV1]
  }
  return []
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function normalizeHistoryTask(t: any): ImageToolHistoryTask | null {
  if (!t || typeof t.id !== 'string' || typeof t.ts !== 'number') return null
  return {
    ...t,
    progress: typeof t.progress === 'number' ? t.progress : t.status === 'completed' ? 100 : 0,
    outputUrls: Array.isArray(t.outputUrls) ? t.outputUrls : [],
    status: t.status === 'active' || t.status === 'failed' || t.status === 'completed' ? t.status : 'completed',
  } as ImageToolHistoryTask
}

/** 兜底：仅含精简字段时可能无缩略图/成片 data URL（旧版 localStorage 配额失败时） */
function loadHistoryFromLocalStorage(key: string): ImageToolHistoryTask[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((t: any) => normalizeHistoryTask(t))
      .filter((x): x is ImageToolHistoryTask => x != null)
      .slice(0, HISTORY_MAX)
  } catch {
    return []
  }
}

function saveHistory(lsKey: string, idbKey: string, tasks: ImageToolHistoryTask[]) {
  const slice = tasks.slice(0, HISTORY_MAX)
  void tikgenIgIdbSet(idbKey, slice)
  tryLocalStorageSetJson(lsKey, stripImageToolHistoryForLocalStorage(slice))
}

function dayKey(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function relativeZh(ts: number) {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 55) return '刚刚'
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))} 分钟前`
  if (sec < 86400) return `${Math.max(1, Math.floor(sec / 3600))} 小时前`
  if (sec < 86400 * 7) return `${Math.max(1, Math.floor(sec / 86400))} 天前`
  return dayKey(ts)
}

async function safeArchiveUpload(file: File, dataUrl: string, from: string) {
  try {
    await createAssetAPI({
      source: 'user_upload',
      type: 'image',
      url: dataUrl,
      name: file.name,
      metadata: { from, mime: file.type, size: file.size },
    })
  } catch {
    // optional
  }
}

async function safeArchiveOutput(params: {
  url: string
  taskId: string
  index: number
  tool: string
  nameSuffix: string
  meta: Record<string, unknown>
}) {
  try {
    if (!params.url) return
    await archiveAiMediaOnce({
      url: params.url,
      type: 'image',
      name: `${params.nameSuffix}-${params.index + 1}-${params.taskId.slice(-10)}.${params.meta.ext || 'png'}`,
      metadata: {
        from: `image_tool_${params.tool}`,
        tool: params.tool,
        task_id: params.taskId,
        index: params.index,
        ...params.meta,
      },
    })
  } catch (e) {
    console.error('[assets] image tool output archive failed:', e)
  }
}

async function maybeToWebp(imageUrl: string): Promise<string> {
  if (!imageUrl) return imageUrl
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth || 1
        c.height = img.naturalHeight || 1
        const ctx = c.getContext('2d')
        if (!ctx) {
          resolve(imageUrl)
          return
        }
        ctx.drawImage(img, 0, 0)
        const webp = c.toDataURL('image/webp', 0.92)
        if (webp.startsWith('data:image/webp')) resolve(webp)
        else resolve(imageUrl)
      } catch {
        resolve(imageUrl)
      }
    }
    img.onerror = () => resolve(imageUrl)
    img.src = imageUrl
  })
}

async function maybeToJpeg(imageUrl: string, quality = 0.88): Promise<string> {
  if (!imageUrl) return imageUrl
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth || 1
        c.height = img.naturalHeight || 1
        const ctx = c.getContext('2d')
        if (!ctx) {
          resolve(imageUrl)
          return
        }
        ctx.drawImage(img, 0, 0)
        const jpeg = c.toDataURL('image/jpeg', quality)
        if (jpeg.startsWith('data:image/jpeg')) resolve(jpeg)
        else resolve(imageUrl)
      } catch {
        resolve(imageUrl)
      }
    }
    img.onerror = () => resolve(imageUrl)
    img.src = imageUrl
  })
}

export function ImageToolWorkbench({
  tool,
  canGenerate,
  onRefreshUser,
}: {
  tool: ImageToolMode
  canGenerate: boolean
  onRefreshUser?: () => void | Promise<void>
}) {
  const rt = RUNTIME[tool]
  const [images, setImages] = useState<Array<{ id: string; url: string; name?: string }>>([])
  const [resolution, setResolution] = useState<'1024' | '2048'>('1024')
  const [scale, setScale] = useState<'2' | '4'>('2')
  const [compressPercent, setCompressPercent] = useState(80)
  const [targetLang, setTargetLang] = useState<TargetLanguageCode>(DEFAULT_TARGET_LANG)
  const [outputFormatRemoveBg, setOutputFormatRemoveBg] = useState<'png' | 'webp'>('png')
  const [outputFormatNano, setOutputFormatNano] = useState<'png' | 'jpeg'>('png')
  const [uploadNotice, setUploadNotice] = useState('')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [submittingCount, setSubmittingCount] = useState(0)
  const [history, setHistory] = useState<ImageToolHistoryTask[]>([])
  const [lightbox, setLightbox] = useState<{ url: string; downloadName?: string } | null>(null)
  const [persistenceReady, setPersistenceReady] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** 供 pagehide 再刷一次，避免刷新/关页时最后一次 IDB 异步写入未完成 */
  const workspaceSnapRef = useRef<unknown>(null)
  const progressTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const mountedRef = useRef(true)
  const runPipelineRef = useRef<(opts: PipelineOpts) => Promise<void>>(async () => {})

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    // 必须等 hydrate 完成后再写，否则首屏 [] 会覆盖 IDB/localStorage 里已有历史
    if (!persistenceReady) return
    saveHistory(rt.historyKey, rt.historyIdbKey, history)
  }, [history, rt.historyKey, rt.historyIdbKey, persistenceReady])

  const sortedHistory = useMemo(() => [...history].sort((a, b) => b.ts - a.ts), [history])
  const readJobQueue = useCallback(async (): Promise<AnyJobV1[]> => {
    const raw = await tikgenIgIdbGet<unknown>(rt.jobKey)
    return parseJobQueue(raw)
  }, [rt.jobKey])

  const upsertJobQueueItem = useCallback(
    async (job: AnyJobV1) => {
      const jobs = await readJobQueue()
      const next = [job, ...jobs.filter((j) => j.taskId !== job.taskId)]
      await tikgenIgIdbSet(rt.jobKey, { v: 1, jobs: next } satisfies JobQueueV1)
    },
    [readJobQueue, rt.jobKey],
  )

  const removeJobQueueItem = useCallback(
    async (taskId: string) => {
      const jobs = await readJobQueue()
      const next = jobs.filter((j) => j.taskId !== taskId)
      if (next.length) await tikgenIgIdbSet(rt.jobKey, { v: 1, jobs: next } satisfies JobQueueV1)
      else await tikgenIgIdbDelete(rt.jobKey)
    },
    [readJobQueue, rt.jobKey],
  )

  const stopProgressTicker = useCallback((taskId: string) => {
    const t = progressTimersRef.current[taskId]
    if (t) {
      clearInterval(t)
      delete progressTimersRef.current[taskId]
    }
  }, [])

  const removeHistoryTask = useCallback(
    (taskId: string) => {
      let didRemove = false
      setHistory((prev) => {
        const t = prev.find((x) => x.id === taskId)
        if (!t || t.status === 'active') return prev
        didRemove = true
        return prev.filter((x) => x.id !== taskId)
      })
      if (!didRemove) return
      stopProgressTicker(taskId)
      void (async () => {
        await removeJobQueueItem(taskId)
      })()
    },
    [stopProgressTicker, removeJobQueueItem],
  )

  const startProgressTicker = useCallback(
    (taskId: string, basePercent: number, span: number) => {
      stopProgressTicker(taskId)
      const start = Date.now()
      const duration = 12000
      progressTimersRef.current[taskId] = setInterval(() => {
        const elapsed = Date.now() - start
        const t = Math.min(1, elapsed / duration)
        const eased = 1 - Math.exp(-3 * t)
        const p = Math.min(94, Math.round(basePercent + span * eased))
        setHistory((prev) => prev.map((x) => (x.id === taskId ? { ...x, progress: Math.max(x.progress, p) } : x)))
      }, 180)
    },
    [stopProgressTicker],
  )

  type PipelineOpts = {
    taskId: string
    refUrls: string[]
    startIndex: number
    initialOutputs: string[]
    clearImagesOnComplete: boolean
    isCancelled: () => boolean
    /** 存在时整段 pipeline 使用锁定参数（用于 IndexedDB 任务恢复） */
    locked?: LockedPipelineSettings
  }

  const runPipeline = useCallback(
    async (opts: PipelineOpts) => {
      const { taskId, refUrls, startIndex, initialOutputs, clearImagesOnComplete, isCancelled, locked: L } = opts
      const outputs = [...initialOutputs]

      let effResolution = resolution
      let effOutputFormatRemoveBg = outputFormatRemoveBg
      let effScale = scale
      let effOutputFormatNano = outputFormatNano
      let effCompressPct = Math.max(1, Math.min(100, Math.round(compressPercent)))
      let effTargetLang = targetLang

      if (L) {
        if (L.kind === 'removeBg') {
          effResolution = L.resolution
          effOutputFormatRemoveBg = L.outputFormat
        } else if (L.kind === 'upscale') {
          effScale = L.scale
          effOutputFormatNano = L.outputFormat
        } else if (L.kind === 'compress') {
          effCompressPct = L.compressPercent
          effOutputFormatNano = L.outputFormat
        } else if (L.kind === 'translate') {
          effTargetLang = L.targetLang
          effOutputFormatNano = L.outputFormat
        }
      }

      const buildJobSnapshot = (out: string[]): AnyJobV1 => {
        if (tool === 'removeBg') {
          return {
            v: 1,
            taskId,
            refUrls,
            resolution: effResolution,
            outputFormat: effOutputFormatRemoveBg,
            outputs: out,
          }
        }
        if (tool === 'upscale') {
          return {
            v: 1,
            tool: 'upscale',
            taskId,
            refUrls,
            scale: effScale,
            outputFormat: effOutputFormatNano,
            outputs: out,
          }
        }
        if (tool === 'compress') {
          return {
            v: 1,
            tool: 'compress',
            taskId,
            refUrls,
            compressPercent: effCompressPct,
            outputFormat: effOutputFormatNano,
            outputs: out,
          }
        }
        return {
          v: 1,
          tool: 'translate',
          taskId,
          refUrls,
          targetLang: effTargetLang,
          outputFormat: effOutputFormatNano,
          outputs: out,
        }
      }

      setSubmittingCount((n) => n + 1)
      try {
        for (let i = startIndex; i < refUrls.length; i++) {
          if (isCancelled()) return
          const base = Math.round((i / refUrls.length) * 100)
          const span = Math.round(100 / refUrls.length)
          startProgressTicker(taskId, base, span - 1)
          try {
            let out = ''
            let formatLabelForTask = ''
            let resolutionChip = ''
            let archiveMeta: Record<string, unknown> = { ext: 'png' }

            if (tool === 'removeBg') {
              const res = effResolution
              const fmt = effOutputFormatRemoveBg
              const { imageUrl } = await removeBackgroundAPI({ refImage: refUrls[i], resolution: res, outputFormat: fmt })
              out = imageUrl
              if (fmt === 'webp') out = await maybeToWebp(imageUrl)
              formatLabelForTask = fmt.toUpperCase()
              resolutionChip = `${res}px`
              archiveMeta = { ext: fmt === 'webp' ? 'webp' : 'png', resolution: res, format: fmt }
              void safeArchiveOutput({
                url: out,
                taskId,
                index: i,
                tool: rt.archiveOutputTool,
                nameSuffix: rt.downloadBase,
                meta: archiveMeta,
              })
            } else if (tool === 'upscale') {
              const fmt = effOutputFormatNano
              const sc = effScale
              const { imageUrl } = await imageToolNanoAPI({
                mode: 'upscale',
                refImage: refUrls[i],
                scale: sc,
                outputFormat: fmt,
              })
              out = imageUrl
              if (fmt === 'jpeg') out = await maybeToJpeg(imageUrl)
              formatLabelForTask = fmt === 'jpeg' ? 'JPEG' : 'PNG'
              resolutionChip = `${sc}x`
              archiveMeta = { ext: fmt === 'jpeg' ? 'jpg' : 'png', scale: sc, format: fmt }
              void safeArchiveOutput({
                url: out,
                taskId,
                index: i,
                tool: rt.archiveOutputTool,
                nameSuffix: rt.downloadBase,
                meta: archiveMeta,
              })
            } else if (tool === 'compress') {
              const fmt = effOutputFormatNano
              const pct = effCompressPct
              const { imageUrl } = await imageToolNanoAPI({
                mode: 'compress',
                refImage: refUrls[i],
                compressPercent: pct,
                outputFormat: fmt,
              })
              out = imageUrl
              if (fmt === 'jpeg') out = await maybeToJpeg(imageUrl)
              formatLabelForTask = fmt === 'jpeg' ? 'JPEG' : 'PNG'
              resolutionChip = `${pct}%`
              archiveMeta = { ext: fmt === 'jpeg' ? 'jpg' : 'png', compress_percent: pct, format: fmt }
              void safeArchiveOutput({
                url: out,
                taskId,
                index: i,
                tool: rt.archiveOutputTool,
                nameSuffix: rt.downloadBase,
                meta: archiveMeta,
              })
            } else {
              const fmt = effOutputFormatNano
              const tl = effTargetLang
              const label = targetLangByCode(tl)?.labelZh || tl
              const { imageUrl } = await imageToolNanoAPI({
                mode: 'translate',
                refImage: refUrls[i],
                targetLang: tl,
                outputFormat: fmt,
              })
              out = imageUrl
              if (fmt === 'jpeg') out = await maybeToJpeg(imageUrl)
              formatLabelForTask = fmt === 'jpeg' ? 'JPEG' : 'PNG'
              resolutionChip = label
              archiveMeta = { ext: fmt === 'jpeg' ? 'jpg' : 'png', target_lang: tl, format: fmt }
              void safeArchiveOutput({
                url: out,
                taskId,
                index: i,
                tool: rt.archiveOutputTool,
                nameSuffix: rt.downloadBase,
                meta: archiveMeta,
              })
            }

            outputs.push(out)
            await upsertJobQueueItem(buildJobSnapshot(outputs))

            const doneChunk = Math.round(((i + 1) / refUrls.length) * 100)
            setHistory((prev) =>
              prev.map((x) =>
                x.id === taskId
                  ? {
                      ...x,
                      outputUrls: [...outputs],
                      progress: Math.max(x.progress, Math.min(99, doneChunk)),
                      resolutionLabel: resolutionChip,
                      formatLabel: formatLabelForTask,
                    }
                  : x,
              ),
            )
          } catch (e: any) {
            const failedMsg = String(e?.message || '处理失败')
            stopProgressTicker(taskId)
            await removeJobQueueItem(taskId)
            setHistory((prev) =>
              prev.map((x) =>
                x.id === taskId
                  ? {
                      ...x,
                      status: 'failed',
                      progress: 100,
                      outputUrls: outputs,
                      errorMessage: failedMsg,
                    }
                  : x,
              ),
            )
            return
          }
          stopProgressTicker(taskId)
        }

        if (isCancelled()) return

        await removeJobQueueItem(taskId)
        setHistory((prev) =>
          prev.map((x) =>
            x.id === taskId
              ? {
                  ...x,
                  status: 'completed',
                  progress: 100,
                  outputUrls: outputs,
                }
              : x,
          ),
        )
        if (clearImagesOnComplete) setImages([])
        void onRefreshUser?.()
      } finally {
        stopProgressTicker(taskId)
        setSubmittingCount((n) => Math.max(0, n - 1))
      }
    },
    [
      tool,
      upsertJobQueueItem,
      removeJobQueueItem,
      resolution,
      outputFormatRemoveBg,
      scale,
      outputFormatNano,
      compressPercent,
      targetLang,
      startProgressTicker,
      stopProgressTicker,
      onRefreshUser,
    ],
  )

  runPipelineRef.current = runPipeline

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const fromIdb = await tikgenIgIdbGet<ImageToolHistoryTask[]>(rt.historyIdbKey)
      let h0: ImageToolHistoryTask[]
      if (Array.isArray(fromIdb) && fromIdb.length > 0) {
        h0 = fromIdb
          .map((t: any) => normalizeHistoryTask(t))
          .filter((x): x is ImageToolHistoryTask => x != null)
          .slice(0, HISTORY_MAX)
      } else {
        h0 = loadHistoryFromLocalStorage(rt.historyKey)
      }
      const jobs = await readJobQueue()

      if (tool === 'removeBg') {
        const ws = await tikgenIgIdbGet<RemoveBgWorkspaceV1>(rt.workspaceKey)
        if (!cancelled && ws?.v === 1) {
          if (Array.isArray(ws.images)) setImages(ws.images)
          if (ws.resolution === '1024' || ws.resolution === '2048') setResolution(ws.resolution)
          if (ws.outputFormat === 'png' || ws.outputFormat === 'webp') setOutputFormatRemoveBg(ws.outputFormat)
        }
      } else if (tool === 'upscale') {
        const ws = await tikgenIgIdbGet<UpscaleWorkspaceV1>(rt.workspaceKey)
        if (!cancelled && ws?.v === 1) {
          if (Array.isArray(ws.images)) setImages(ws.images)
          if (ws.scale === '2' || ws.scale === '4') setScale(ws.scale)
          if (ws.outputFormat === 'png' || ws.outputFormat === 'jpeg') setOutputFormatNano(ws.outputFormat)
        }
      } else if (tool === 'compress') {
        const ws = await tikgenIgIdbGet<CompressWorkspaceV1>(rt.workspaceKey)
        if (!cancelled && ws?.v === 1) {
          if (Array.isArray(ws.images)) setImages(ws.images)
          if (typeof ws.compressPercent === 'number') setCompressPercent(Math.max(1, Math.min(100, ws.compressPercent)))
          if (ws.outputFormat === 'png' || ws.outputFormat === 'jpeg') setOutputFormatNano(ws.outputFormat)
        }
      } else {
        const ws = await tikgenIgIdbGet<TranslateWorkspaceV1>(rt.workspaceKey)
        if (!cancelled && ws?.v === 1) {
          if (Array.isArray(ws.images)) setImages(ws.images)
          const tl = ws.targetLang
          if (targetLangByCode(tl)) setTargetLang(tl as TargetLanguageCode)
          if (ws.outputFormat === 'png' || ws.outputFormat === 'jpeg') setOutputFormatNano(ws.outputFormat)
        }
      }

      if (cancelled) return

      let nextHistory = h0

      const resumable: Array<{
        taskId: string
        refUrls: string[]
        startIndex: number
        merged: string[]
        locked: LockedPipelineSettings
      }> = []

      for (const job of jobs) {
        if (!Array.isArray(job.refUrls) || !job.refUrls.length) continue
        const isOurJob =
          tool === 'removeBg'
            ? !('tool' in job && job.tool != null && job.tool !== 'removeBg')
            : 'tool' in job && job.tool === tool
        if (!isOurJob) continue

        const locked = lockedSettingsFromJob(job, tool)
        if (!locked) {
          await removeJobQueueItem(job.taskId)
          continue
        }

        let task = nextHistory.find((t) => t.id === job.taskId && t.status === 'active')
        if (!task) {
          const stub = buildRecoveryTaskFromJob(job, tool)
          if (stub) nextHistory = [stub, ...nextHistory.filter((t) => t.id !== job.taskId)]
          else {
            await removeJobQueueItem(job.taskId)
            continue
          }
        }

        const taskRow = nextHistory.find((t) => t.id === job.taskId && t.status === 'active')
        if (!taskRow) continue
        const jobOut = Array.isArray(job.outputs) ? job.outputs : []
        const taskOut = Array.isArray(taskRow.outputUrls) ? taskRow.outputUrls : []
        const merged = taskOut.length >= jobOut.length ? [...taskOut] : [...jobOut]
        const startIndex = merged.length
        if (startIndex >= job.refUrls.length) {
          await removeJobQueueItem(job.taskId)
          nextHistory = nextHistory.map((x) =>
            x.id === job.taskId ? { ...x, status: 'completed' as const, progress: 100, outputUrls: merged } : x,
          )
          continue
        }
        resumable.push({ taskId: job.taskId, refUrls: job.refUrls, startIndex, merged, locked })
      }

      if (cancelled) return
      setHistory(nextHistory)
      setPersistenceReady(true)
      for (const r of resumable) {
        void runPipelineRef.current({
          taskId: r.taskId,
          refUrls: r.refUrls,
          startIndex: r.startIndex,
          initialOutputs: r.merged.slice(),
          clearImagesOnComplete: false,
          isCancelled: () => cancelled || !mountedRef.current,
          locked: r.locked,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tool, rt.historyKey, rt.historyIdbKey, rt.workspaceKey, readJobQueue, removeJobQueueItem])

  useEffect(() => {
    if (!persistenceReady) return
    if (tool === 'removeBg') {
      const snap: RemoveBgWorkspaceV1 = { v: 1, images, resolution, outputFormat: outputFormatRemoveBg }
      workspaceSnapRef.current = snap
      void tikgenIgIdbSet(rt.workspaceKey, snap)
    } else if (tool === 'upscale') {
      const snap: UpscaleWorkspaceV1 = { v: 1, images, scale, outputFormat: outputFormatNano }
      workspaceSnapRef.current = snap
      void tikgenIgIdbSet(rt.workspaceKey, snap)
    } else if (tool === 'compress') {
      const snap: CompressWorkspaceV1 = {
        v: 1,
        images,
        compressPercent: Math.max(1, Math.min(100, Math.round(compressPercent))),
        outputFormat: outputFormatNano,
      }
      workspaceSnapRef.current = snap
      void tikgenIgIdbSet(rt.workspaceKey, snap)
    } else {
      const snap: TranslateWorkspaceV1 = { v: 1, images, targetLang, outputFormat: outputFormatNano }
      workspaceSnapRef.current = snap
      void tikgenIgIdbSet(rt.workspaceKey, snap)
    }
  }, [
    images,
    resolution,
    outputFormatRemoveBg,
    scale,
    outputFormatNano,
    compressPercent,
    targetLang,
    persistenceReady,
    rt.workspaceKey,
    tool,
  ])

  useEffect(() => {
    const wk = rt.workspaceKey
    const flush = () => {
      const snap = workspaceSnapRef.current
      if (snap) void tikgenIgIdbSet(wk, snap)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [rt.workspaceKey])

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const remain = Math.max(0, MAX_IMAGES - images.length)
    if (remain <= 0) {
      setUploadNotice('最多上传 5 张图片')
      return
    }
    if (files.length > remain) setUploadNotice('最多上传 5 张图片，已自动截取')
    else setUploadNotice('')
    const picked = Array.from(files).slice(0, remain)
    setUploadBusy(true)
    try {
      const next: Array<{ id: string; url: string; name?: string }> = []
      for (const f of picked) {
        if (!f.type.startsWith('image/')) continue
        if (f.size > 10 * 1024 * 1024) {
          setUploadNotice('单张图片需 ≤ 10MB')
          continue
        }
        const dataUrl = await fileToDataUrl(f)
        next.push({ id: `it_${Date.now()}_${Math.random().toString(16).slice(2)}`, url: dataUrl, name: f.name })
        void safeArchiveUpload(f, dataUrl, rt.archiveInputFrom)
      }
      setImages((prev) => [...prev, ...next])
    } finally {
      setUploadBusy(false)
    }
  }

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((x) => x.id !== id))
  }

  const chipLabelForSubmit = (): string => {
    if (tool === 'removeBg') return `${resolution}px`
    if (tool === 'upscale') return `${scale}x`
    if (tool === 'compress') return `${Math.max(1, Math.min(100, Math.round(compressPercent)))}%`
    return targetLangByCode(targetLang)?.labelZh || targetLang
  }

  const formatChipForSubmit = (): string => {
    if (tool === 'removeBg') return outputFormatRemoveBg.toUpperCase()
    return outputFormatNano === 'jpeg' ? 'JPEG' : 'PNG'
  }

  const handleSubmit = async () => {
    if (!canGenerate) {
      setUploadNotice('请先完成本产品内付费（购买套餐）后再使用图片工具')
      return
    }
    if (!images.length) return
    const list = [...images]
    const refUrls = list.map((x) => x.url)
    const taskId = `${rt.taskPrefix}${Date.now()}_${Math.random().toString(16).slice(2)}`
    const task: ImageToolHistoryTask = {
      id: taskId,
      ts: Date.now(),
      refThumb: list[0]?.url || '',
      prompt: `共 ${list.length} 张`,
      modelLabel: 'Nano Banana 2',
      resolutionLabel: chipLabelForSubmit(),
      formatLabel: formatChipForSubmit(),
      requestedCount: list.length,
      status: 'active',
      progress: 1,
      outputUrls: [],
    }

    const jobSnapshot: AnyJobV1 =
      tool === 'removeBg'
        ? {
            v: 1,
            taskId,
            refUrls,
            resolution,
            outputFormat: outputFormatRemoveBg,
            outputs: [],
          }
        : tool === 'upscale'
          ? {
              v: 1,
              tool: 'upscale',
              taskId,
              refUrls,
              scale,
              outputFormat: outputFormatNano,
              outputs: [],
            }
          : tool === 'compress'
            ? {
                v: 1,
                tool: 'compress',
                taskId,
                refUrls,
                compressPercent: Math.max(1, Math.min(100, Math.round(compressPercent))),
                outputFormat: outputFormatNano,
                outputs: [],
              }
            : {
                v: 1,
                tool: 'translate',
                taskId,
                refUrls,
                targetLang,
                outputFormat: outputFormatNano,
                outputs: [],
              }
    await upsertJobQueueItem(jobSnapshot)

    setHistory((prev) => [task, ...prev])

    await runPipeline({
      taskId,
      refUrls,
      startIndex: 0,
      initialOutputs: [],
      clearImagesOnComplete: true,
      isCancelled: () => !mountedRef.current,
    })
  }

  const extForTask = (task: ImageToolHistoryTask) => {
    const f = task.formatLabel.toLowerCase()
    if (f === 'jpeg' || f === 'jpg') return 'jpg'
    if (f === 'webp') return 'webp'
    return 'png'
  }

  const downloadAll = (task: ImageToolHistoryTask) => {
    const ext = extForTask(task)
    task.outputUrls.forEach((url, idx) => {
      triggerProxyDownload(url, `${rt.downloadBase}-${task.id}-${idx + 1}.${ext}`)
    })
  }

  /** 历史记录中的成片补同步到资产库（与生成时写入互补；指纹去重） */
  useEffect(() => {
    if (!persistenceReady) return
    for (const task of history) {
      if (task.status === 'failed') continue
      const urls = task.outputUrls || []
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]
        if (!url) continue
        const f = task.formatLabel.toLowerCase()
        const ext = f === 'jpeg' || f === 'jpg' ? 'jpg' : f === 'webp' ? 'webp' : 'png'
        void archiveAiMediaOnce({
          url,
          type: 'image',
          name: `${rt.downloadBase}-${task.id}-${i + 1}.${ext}`,
          metadata: {
            from: `image_tool_${rt.archiveOutputTool}`,
            tool: rt.archiveOutputTool,
            task_id: task.id,
            index: i,
            sync: 'history',
          },
        })
      }
    }
  }, [history, persistenceReady, rt.downloadBase, rt.archiveOutputTool])

  const SubmitIcon = rt.SubmitIcon

  const outputSpecSection = () => {
    if (tool === 'removeBg') {
      return (
        <>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/42">
              <Maximize2 className="h-3.5 w-3.5 shrink-0 text-emerald-400/85" strokeWidth={2} aria-hidden />
              <span>处理分辨率</span>
            </div>
            <div
              className="flex w-full gap-1 rounded-xl bg-black/30 p-1 ring-1 ring-inset ring-white/[0.09]"
              role="radiogroup"
              aria-label="处理分辨率"
            >
              {(
                [
                  { v: '1024' as const, hint: '推荐 · 更快' },
                  { v: '2048' as const, hint: '细节更清晰' },
                ] as const
              ).map(({ v, hint }) => {
                const on = resolution === v
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setResolution(v)}
                    className={`relative flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                      on
                        ? 'bg-gradient-to-r from-pink-500/95 to-violet-600/95 text-white shadow-[0_4px_20px_rgba(124,58,237,0.28)] ring-1 ring-inset ring-white/15'
                        : 'text-white/48 hover:bg-white/[0.06] hover:text-white/78'
                    }`}
                  >
                    <span className="text-sm font-semibold tabular-nums">{v}px</span>
                    <span className={`text-[10px] font-normal leading-tight ${on ? 'text-white/75' : 'text-white/32'}`}>
                      {hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/42">
              <Box className="h-3.5 w-3.5 shrink-0 text-violet-300/78" strokeWidth={1.75} aria-hidden />
              <span>输出格式</span>
            </div>
            <div
              className="flex w-full gap-1 rounded-xl bg-black/30 p-1 ring-1 ring-inset ring-white/[0.09]"
              role="radiogroup"
              aria-label="输出格式"
            >
              {(
                [
                  { id: 'png' as const, label: 'PNG', hint: '透明背景' },
                  { id: 'webp' as const, label: 'WEBP', hint: '体积更小' },
                ] as const
              ).map(({ id, label, hint }) => {
                const on = outputFormatRemoveBg === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setOutputFormatRemoveBg(id)}
                    className={`relative flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                      on
                        ? 'bg-gradient-to-r from-pink-500/95 to-violet-600/95 text-white shadow-[0_4px_20px_rgba(124,58,237,0.28)] ring-1 ring-inset ring-white/15'
                        : 'text-white/48 hover:bg-white/[0.06] hover:text-white/78'
                    }`}
                  >
                    <span className="text-sm font-semibold tracking-wide">{label}</span>
                    <span className={`text-[10px] font-normal leading-tight ${on ? 'text-white/75' : 'text-white/32'}`}>
                      {hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )
    }

    if (tool === 'upscale') {
      return (
        <>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/42">
              <Maximize2 className="h-3.5 w-3.5 shrink-0 text-emerald-400/85" strokeWidth={2} aria-hidden />
              <span>放大倍率</span>
            </div>
            <div
              className="flex w-full gap-1 rounded-xl bg-black/30 p-1 ring-1 ring-inset ring-white/[0.09]"
              role="radiogroup"
              aria-label="放大倍率"
            >
              {(['2', '4'] as const).map((v) => {
                const on = scale === v
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setScale(v)}
                    className={`relative flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                      on
                        ? 'bg-gradient-to-r from-pink-500/95 to-violet-600/95 text-white shadow-[0_4px_20px_rgba(124,58,237,0.28)] ring-1 ring-inset ring-white/15'
                        : 'text-white/48 hover:bg-white/[0.06] hover:text-white/78'
                    }`}
                  >
                    <span className="text-sm font-semibold tabular-nums">{v}x</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/42">
              <Box className="h-3.5 w-3.5 shrink-0 text-violet-300/78" strokeWidth={1.75} aria-hidden />
              <span>输出格式</span>
            </div>
            <div
              className="flex w-full gap-1 rounded-xl bg-black/30 p-1 ring-1 ring-inset ring-white/[0.09]"
              role="radiogroup"
              aria-label="输出格式"
            >
              {(
                [
                  { id: 'png' as const, label: 'PNG', hint: '无损' },
                  { id: 'jpeg' as const, label: 'JPEG', hint: '体积更小' },
                ] as const
              ).map(({ id, label, hint }) => {
                const on = outputFormatNano === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setOutputFormatNano(id)}
                    className={`relative flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                      on
                        ? 'bg-gradient-to-r from-pink-500/95 to-violet-600/95 text-white shadow-[0_4px_20px_rgba(124,58,237,0.28)] ring-1 ring-inset ring-white/15'
                        : 'text-white/48 hover:bg-white/[0.06] hover:text-white/78'
                    }`}
                  >
                    <span className="text-sm font-semibold tracking-wide">{label}</span>
                    <span className={`text-[10px] font-normal leading-tight ${on ? 'text-white/75' : 'text-white/32'}`}>
                      {hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )
    }

    if (tool === 'compress') {
      const pct = Math.max(1, Math.min(100, Math.round(compressPercent)))
      return (
        <>
          <div className="flex w-full min-w-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-white/42">
              <div className="flex items-center gap-2">
                <Minimize2 className="h-3.5 w-3.5 shrink-0 text-amber-300/85" strokeWidth={2} aria-hidden />
                <span>缩小倍率</span>
              </div>
              <span className="tabular-nums text-white/55">{pct}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={pct}
              onChange={(e) => setCompressPercent(Number(e.target.value))}
              className="w-full h-2 accent-violet-500 rounded-full bg-white/10 appearance-none cursor-pointer"
              aria-label="缩小倍率"
            />
            <p className="text-[10px] text-white/35">1%–100%，数值越小输出尺寸越小</p>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/42">
              <Box className="h-3.5 w-3.5 shrink-0 text-violet-300/78" strokeWidth={1.75} aria-hidden />
              <span>输出格式</span>
            </div>
            <div
              className="flex w-full gap-1 rounded-xl bg-black/30 p-1 ring-1 ring-inset ring-white/[0.09]"
              role="radiogroup"
              aria-label="输出格式"
            >
              {(
                [
                  { id: 'png' as const, label: 'PNG', hint: '无损' },
                  { id: 'jpeg' as const, label: 'JPEG', hint: '体积更小' },
                ] as const
              ).map(({ id, label, hint }) => {
                const on = outputFormatNano === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setOutputFormatNano(id)}
                    className={`relative flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                      on
                        ? 'bg-gradient-to-r from-pink-500/95 to-violet-600/95 text-white shadow-[0_4px_20px_rgba(124,58,237,0.28)] ring-1 ring-inset ring-white/15'
                        : 'text-white/48 hover:bg-white/[0.06] hover:text-white/78'
                    }`}
                  >
                    <span className="text-sm font-semibold tracking-wide">{label}</span>
                    <span className={`text-[10px] font-normal leading-tight ${on ? 'text-white/75' : 'text-white/32'}`}>
                      {hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <div className="tikgen-module-title text-xs font-semibold text-white/90 mb-1">目标语言</div>
          <div
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label="目标语言"
          >
            {TARGET_LANGUAGES.map((lang) => {
              const on = targetLang === lang.code
              return (
                <button
                  key={lang.code}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setTargetLang(lang.code)}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200 ring-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                    on
                      ? 'bg-white/[0.12] text-white ring-violet-400/45 shadow-[0_0_0_1px_rgba(167,139,250,0.35)]'
                      : 'bg-black/30 text-white/70 ring-white/[0.12] hover:bg-white/[0.07] hover:ring-white/20'
                  }`}
                >
                  <span
                    className={`shrink-0 h-3.5 w-3.5 rounded-full border-2 ${
                      on ? 'border-violet-400 bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.25)]' : 'border-white/35 bg-transparent'
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate">{lang.labelZh}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/42">
            <Box className="h-3.5 w-3.5 shrink-0 text-violet-300/78" strokeWidth={1.75} aria-hidden />
            <span>输出格式</span>
          </div>
          <div
            className="flex w-full gap-1 rounded-xl bg-black/30 p-1 ring-1 ring-inset ring-white/[0.09]"
            role="radiogroup"
            aria-label="输出格式"
          >
            {(
              [
                { id: 'png' as const, label: 'PNG', hint: '更清晰' },
                { id: 'jpeg' as const, label: 'JPEG', hint: '体积更小' },
              ] as const
            ).map(({ id, label, hint }) => {
              const on = outputFormatNano === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setOutputFormatNano(id)}
                  className={`relative flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                    on
                      ? 'bg-gradient-to-r from-pink-500/95 to-violet-600/95 text-white shadow-[0_4px_20px_rgba(124,58,237,0.28)] ring-1 ring-inset ring-white/15'
                      : 'text-white/48 hover:bg-white/[0.06] hover:text-white/78'
                  }`}
                >
                  <span className="text-sm font-semibold tracking-wide">{label}</span>
                  <span className={`text-[10px] font-normal leading-tight ${on ? 'text-white/75' : 'text-white/32'}`}>
                    {hint}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="tikgen-panel rounded-2xl p-4 sm:p-5 overflow-visible">
          <div className="flex flex-col gap-6">
            <section className="w-full min-w-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="tikgen-module-title text-xs font-semibold uppercase tracking-wide">上传图片</div>
                </div>
                <div className="text-xs text-white/50 shrink-0 tabular-nums">
                  {images.length}/{MAX_IMAGES}
                </div>
              </div>
              <div
                className={`tikgen-ref-dropzone rounded-xl p-2.5 relative ${uploadBusy ? 'cursor-wait' : 'cursor-pointer'}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onDrop={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (uploadBusy) return
                  await handleFiles(e.dataTransfer?.files || null)
                }}
                onClick={() => {
                  if (uploadBusy) return
                  fileRef.current?.click()
                }}
              >
                {uploadBusy ? (
                  <div
                    className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-2.5 rounded-[inherit] bg-black/50 backdrop-blur-[3px]"
                    aria-busy="true"
                    aria-live="polite"
                  >
                    <RefreshCw className="h-7 w-7 shrink-0 animate-spin text-violet-300/90" strokeWidth={2} />
                    <span className="text-xs font-medium text-white/75">读取图片中…</span>
                  </div>
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploadBusy}
                  onChange={async (e) => {
                    await handleFiles(e.target.files || null)
                    e.target.value = ''
                  }}
                  className="hidden"
                />
                {images.length ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 md:grid-cols-5 gap-2">
                      {images.map((img, i) => (
                        <div
                          key={img.id}
                          className="relative rounded-lg overflow-hidden bg-black/35 ring-1 ring-inset ring-white/[0.1]"
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setLightbox({ url: img.url, downloadName: img.name || `input-${i + 1}.png` })
                            }}
                            className="block w-full"
                          >
                            <img src={img.url} alt="" className="w-full h-20 object-cover" />
                          </button>
                          {i === 0 && (
                            <span className="absolute left-1 top-1 text-xs px-2 py-1 rounded bg-black/65 text-white font-medium">
                              主图
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeImage(img.id)
                            }}
                            className="absolute right-1 top-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {images.length < MAX_IMAGES ? (
                        <button
                          type="button"
                          disabled={uploadBusy}
                          onClick={(e) => {
                            e.stopPropagation()
                            fileRef.current?.click()
                          }}
                          className="h-20 rounded-lg flex flex-col items-center justify-center gap-1 bg-white/[0.04] text-white/50 ring-1 ring-inset ring-white/[0.1] transition-colors hover:bg-white/[0.07] hover:text-white/65"
                        >
                          <Upload className="w-4 h-4" />
                          <span className="text-[11px]">上传</span>
                        </button>
                      ) : null}
                    </div>
                    {uploadNotice ? <p className="text-[11px] text-amber-200/90">{uploadNotice}</p> : null}
                  </div>
                ) : (
                  <div className="py-10 px-4 text-center">
                    <Upload className="w-10 h-10 mx-auto text-white/35 mb-3" />
                    <p className="text-sm text-white/65">点击或拖拽上传图片</p>
                    <p className="text-xs text-white/40 mt-1">JPG / PNG / WEBP，单张 ≤10MB，最多 5 张</p>
                    {uploadNotice ? <p className="text-[11px] text-amber-200/90 mt-2">{uploadNotice}</p> : null}
                  </div>
                )}
              </div>
            </section>

            <section className="w-full min-w-0 space-y-4">
              <div className="flex items-center gap-1.5">
                <div className="tikgen-module-title text-xs font-semibold uppercase tracking-wide">输出规格</div>
              </div>
              {outputSpecSection()}
            </section>

            <div className="pt-1 w-full min-w-0">
              <button
                type="button"
                disabled={!images.length || uploadBusy || !canGenerate}
                title={!canGenerate ? '请先完成本产品内付费（购买套餐）后再使用图片工具' : undefined}
                onClick={() => void handleSubmit()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/25 ring-1 ring-inset ring-white/10 transition-[filter,opacity] hover:brightness-[1.03] active:brightness-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:brightness-100"
              >
                {submittingCount > 0 ? <RefreshCw className="w-4 h-4 animate-spin" /> : <SubmitIcon className="w-4 h-4" />}
                {rt.submitLabel}
                {images.length > 0 ? (
                  <CreditCostWithZap amount={images.length * CREDITS_PER_IMAGE} wrapInParens />
                ) : (
                  <>
                    （每张 <CreditCostWithZap amount={CREDITS_PER_IMAGE} />）
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="tikgen-panel rounded-2xl p-4 sm:p-5 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto overflow-x-visible">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-white/95">生成历史</h2>
          </div>

          {history.length === 0 ? (
            <div className="min-h-[200px] flex flex-col items-center justify-center text-center text-white/45 border border-white/12 rounded-xl bg-white/[0.02] px-6">
              <ImageIcon className="w-14 h-14 mb-3 opacity-35" />
              <p className="text-sm text-white/55">暂无记录</p>
              <p className="text-xs text-white/40 mt-1 max-w-xs">{rt.emptySubtext}</p>
            </div>
          ) : null}

          {sortedHistory.length > 0 ? (
            <div className="flex flex-col gap-4 pb-2">
              {sortedHistory.map((task) => (
                <div
                  key={task.id}
                  className="image-history-card relative rounded-2xl border border-white/14 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md"
                >
                  <div className="mb-3 flex items-start gap-2">
                    {/* 瀑布流多列时卡片很窄，flex-wrap 会把标签竖排；单行横滑保持与去背景预期一致 */}
                    <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-0.5 [scrollbar-width:thin]">
                      <div className="flex w-max min-w-full flex-nowrap items-center gap-2">
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                          <Clock className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                          {relativeZh(task.ts)}
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                          <Maximize2 className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                          {task.resolutionLabel}
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75 uppercase tracking-wide">
                          {task.formatLabel}
                        </span>
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium border ${
                            task.status === 'completed'
                              ? 'bg-emerald-500/18 text-emerald-100 border-emerald-400/28'
                              : task.status === 'active'
                                ? 'bg-amber-500/18 text-amber-100 border-amber-400/30'
                                : 'bg-red-500/15 text-red-100 border-red-400/25'
                          }`}
                        >
                          {task.status === 'completed' ? '已完成' : task.status === 'active' ? '生成中' : '失败'}
                        </span>
                      </div>
                    </div>
                    {task.status !== 'active' ? (
                      <button
                        type="button"
                        onClick={() => removeHistoryTask(task.id)}
                        className="shrink-0 rounded-md p-1.5 text-white/28 transition-colors hover:bg-white/[0.06] hover:text-white/48 focus:outline-none focus-visible:text-white/55 focus-visible:ring-1 focus-visible:ring-white/20"
                        title="删除此条记录"
                        aria-label="删除此条记录"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    ) : null}
                  </div>

                  <div className="flex gap-3 items-start mb-3">
                    <button
                      type="button"
                      className="shrink-0 w-14 h-14 rounded-xl overflow-hidden border border-white/15 bg-white/[0.04]"
                      onClick={() => {
                        if (task.refThumb) setLightbox({ url: task.refThumb, downloadName: `reference-${task.id}.png` })
                      }}
                    >
                      {task.refThumb ? (
                        <img src={task.refThumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-white/30">无</div>
                      )}
                    </button>
                    <p className="text-xs text-white/78 leading-relaxed flex-1 min-w-0 break-words">
                      共 {task.requestedCount || task.outputUrls.length || 1} 张
                    </p>
                  </div>

                  {task.status === 'active' ? (
                    <div className="mb-4">
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-pink-500 transition-[width] duration-300 ease-out"
                          style={{ width: `${Math.max(1, Math.min(100, task.progress))}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-white/55 mt-1.5 tabular-nums">
                        处理进度 {Math.max(1, Math.min(99, task.progress))}%
                      </p>
                    </div>
                  ) : null}

                  {task.status === 'failed' && task.errorMessage ? (
                    <p className="text-[11px] text-red-300/90 mb-3 break-words">{task.errorMessage}</p>
                  ) : null}

                  {task.outputUrls.length > 0 ? (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => downloadAll(task)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-white/18 text-white/85 hover:bg-white/[0.08]"
                      >
                        <Download className="w-3.5 h-3.5" />
                        下载全部（{task.outputUrls.length}）
                      </button>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {task.outputUrls.map((url, idx) => {
                          const ext = extForTask(task)
                          return (
                            <div
                              key={`${task.id}_out_${idx}`}
                              className="flex flex-col overflow-visible rounded-2xl border border-white/12 bg-black/30 group/out"
                            >
                              <div className="relative z-20 shrink-0 rounded-t-2xl bg-black/30 px-2.5 pb-1.5 pt-2.5">
                                <span className="block w-full text-center text-[13px] sm:text-sm font-semibold leading-snug text-violet-100/95">
                                  结果 {idx + 1}
                                </span>
                              </div>
                              <div
                                className="relative aspect-square w-full overflow-hidden rounded-b-2xl bg-black/35"
                                style={{
                                  backgroundImage:
                                    'linear-gradient(45deg, #2a2a35 25%, transparent 25%), linear-gradient(-45deg, #2a2a35 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a35 75%), linear-gradient(-45deg, transparent 75%, #2a2a35 75%)',
                                  backgroundSize: '12px 12px',
                                  backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
                                }}
                              >
                                <img
                                  src={url}
                                  alt=""
                                  className="absolute inset-0 h-full w-full object-contain pointer-events-none select-none"
                                  draggable={false}
                                />
                                <a
                                  href={buildDownloadProxyUrl(url, `${rt.downloadBase}-${task.id}-${idx + 1}.${ext}`)}
                                  download={`${rt.downloadBase}-${task.id}-${idx + 1}.${ext}`}
                                  rel="noreferrer"
                                  className="absolute right-2 top-2 z-[3] rounded-full border border-white/20 bg-black/70 p-2 text-white opacity-0 transition-opacity pointer-events-none hover:bg-black/85 group-hover/out:pointer-events-auto group-hover/out:opacity-100"
                                  title="下载"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Download className="w-4 h-4" />
                                </a>
                                <button
                                  type="button"
                                  className="absolute inset-0 z-[2] cursor-zoom-in touch-manipulation border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 focus-visible:ring-inset"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setLightbox({ url, downloadName: `${rt.downloadBase}-${task.id}-${idx + 1}.${ext}` })
                                  }}
                                  title="点击放大预览"
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : task.status === 'active' ? (
                    <p className="text-[11px] text-white/45 mb-1">处理进行中，完成后将显示在下面…</p>
                  ) : task.status === 'completed' ? (
                    <p className="text-[11px] text-white/40">未返回图片</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {lightbox ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="presentation"
        >
          <button
            type="button"
            className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setLightbox(null)}
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightbox.url}
            alt=""
            className="max-h-[90vh] max-w-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={buildDownloadProxyUrl(lightbox.url, lightbox.downloadName || 'image.png')}
            download={lightbox.downloadName || 'image.png'}
            rel="noreferrer"
            className="absolute bottom-6 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-sm text-white hover:bg-white/25"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="w-4 h-4" />
            下载
          </a>
        </div>
      ) : null}
    </>
  )
}
