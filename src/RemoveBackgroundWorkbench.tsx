import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  ChevronDown,
  Clock,
  Download,
  Eraser,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react'
import { createAssetAPI } from './api/assets'
import { removeBackgroundAPI } from './api/removeBackground'

const MAX_IMAGES = 5
const HISTORY_KEY = 'tikgen.removeBg.history'
const HISTORY_MAX = 80

export type RemoveBgHistoryTask = {
  id: string
  ts: number
  refThumb: string
  prompt: string
  modelLabel: string
  resolutionLabel: string
  formatLabel: string
  requestedCount: number
  status: 'active' | 'completed' | 'failed'
  /** 0–100，生成中展示 */
  progress: number
  outputUrls: string[]
  errorMessage?: string
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function loadHistory(): RemoveBgHistoryTask[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x: any) => x && typeof x.id === 'string' && typeof x.ts === 'number')
      .map((t: any) => ({
        ...t,
        progress: typeof t.progress === 'number' ? t.progress : t.status === 'completed' ? 100 : 0,
        outputUrls: Array.isArray(t.outputUrls) ? t.outputUrls : [],
        status: t.status === 'active' || t.status === 'failed' || t.status === 'completed' ? t.status : 'completed',
      }))
      .slice(0, HISTORY_MAX) as RemoveBgHistoryTask[]
  } catch {
    return []
  }
}

function saveHistory(tasks: RemoveBgHistoryTask[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(tasks.slice(0, HISTORY_MAX)))
  } catch {
    // ignore
  }
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

async function safeArchiveUpload(file: File, dataUrl: string) {
  try {
    await createAssetAPI({
      source: 'user_upload',
      type: 'image',
      url: dataUrl,
      name: file.name,
      metadata: { from: 'remove_background_input', mime: file.type, size: file.size },
    })
  } catch {
    // optional
  }
}

/** 去除背景结果写入资产库（AI 生成），与图片生成一致；失败不阻断主流程 */
async function safeArchiveRemoveBgOutput(params: {
  url: string
  taskId: string
  index: number
  resolution: '1024' | '2048'
  outputFormat: 'png' | 'webp'
}) {
  try {
    if (!params.url) return
    const ext = params.outputFormat === 'webp' ? 'webp' : 'png'
    await createAssetAPI({
      source: 'ai_generated',
      type: 'image',
      url: params.url,
      name: `remove-bg-${params.index + 1}-${params.taskId.slice(-10)}.${ext}`,
      metadata: {
        from: 'image_tool_remove_background',
        tool: 'remove_background',
        task_id: params.taskId,
        index: params.index,
        resolution: params.resolution,
        format: params.outputFormat,
      },
    })
  } catch (e) {
    console.error('[assets] remove-bg output archive failed:', e)
  }
}

/** 在浏览器端尽量转为 WEBP（跨域图可能失败，则返回原 URL） */
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

export function RemoveBackgroundWorkbench() {
  const [images, setImages] = useState<Array<{ id: string; url: string; name?: string }>>([])
  const [resolution, setResolution] = useState<'1024' | '2048'>('1024')
  const [outputFormat, setOutputFormat] = useState<'png' | 'webp'>('png')
  const [uploadNotice, setUploadNotice] = useState('')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [history, setHistory] = useState<RemoveBgHistoryTask[]>([])
  const [lightbox, setLightbox] = useState<{ url: string; downloadName?: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const progressTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  useEffect(() => {
    saveHistory(history)
  }, [history])

  const sortedHistory = useMemo(() => [...history].sort((a, b) => b.ts - a.ts), [history])

  const stopProgressTicker = useCallback((taskId: string) => {
    const t = progressTimersRef.current[taskId]
    if (t) {
      clearInterval(t)
      delete progressTimersRef.current[taskId]
    }
  }, [])

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
        next.push({ id: `rb_${Date.now()}_${Math.random().toString(16).slice(2)}`, url: dataUrl, name: f.name })
        void safeArchiveUpload(f, dataUrl)
      }
      setImages((prev) => [...prev, ...next])
    } finally {
      setUploadBusy(false)
    }
  }

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((x) => x.id !== id))
  }

  const handleSubmit = async () => {
    if (!images.length || submitBusy) return
    const list = [...images]
    const taskId = `rb_task_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const task: RemoveBgHistoryTask = {
      id: taskId,
      ts: Date.now(),
      refThumb: list[0]?.url || '',
      prompt: `共 ${list.length} 张`,
      modelLabel: 'Nano Banana 2',
      resolutionLabel: `${resolution}px`,
      formatLabel: outputFormat.toUpperCase(),
      requestedCount: list.length,
      status: 'active',
      progress: 1,
      outputUrls: [],
    }
    setHistory((prev) => [task, ...prev])
    setSubmitBusy(true)

    const outputs: string[] = []
    let failedMsg = ''

    try {
      for (let i = 0; i < list.length; i++) {
        const base = Math.round((i / list.length) * 100)
        const span = Math.round(100 / list.length)
        startProgressTicker(taskId, base, span - 1)

        try {
          const { imageUrl } = await removeBackgroundAPI({
            refImage: list[i].url,
            resolution,
            outputFormat,
          })
          let out = imageUrl
          if (outputFormat === 'webp') {
            out = await maybeToWebp(imageUrl)
          }
          outputs.push(out)
          void safeArchiveRemoveBgOutput({
            url: out,
            taskId,
            index: i,
            resolution,
            outputFormat,
          })
          const doneChunk = Math.round(((i + 1) / list.length) * 100)
          setHistory((prev) =>
            prev.map((x) =>
              x.id === taskId
                ? {
                    ...x,
                    outputUrls: [...outputs],
                    progress: Math.max(x.progress, Math.min(99, doneChunk)),
                  }
                : x,
            ),
          )
        } catch (e: any) {
          failedMsg = String(e?.message || '处理失败')
          stopProgressTicker(taskId)
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
          setSubmitBusy(false)
          return
        }
        stopProgressTicker(taskId)
      }

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
      setImages([])
    } finally {
      stopProgressTicker(taskId)
      setSubmitBusy(false)
    }
  }

  const downloadAll = (task: RemoveBgHistoryTask) => {
    const ext = task.formatLabel.toLowerCase() === 'webp' ? 'webp' : 'png'
    task.outputUrls.forEach((url, idx) => {
      const a = document.createElement('a')
      a.href = url
      a.download = `remove-bg-${task.id}-${idx + 1}.${ext}`
      a.rel = 'noreferrer'
      a.target = '_blank'
      a.click()
    })
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
                className="tikgen-ref-dropzone rounded-xl p-2.5 relative cursor-pointer"
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onDrop={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  await handleFiles(e.dataTransfer?.files || null)
                }}
                onClick={() => fileRef.current?.click()}
              >
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

            <section className="w-full min-w-0">
              <div className="mb-2 flex items-center gap-1.5">
                <div className="tikgen-module-title text-xs font-semibold uppercase tracking-wide">输出规格</div>
              </div>
              {/* 与上方上传区同宽：整行拉满，两列等分，右缘与 tikgen-ref-dropzone 对齐 */}
              <div className="rounded-xl border border-white/[0.12] bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-inset ring-white/[0.06]">
                <div className="grid grid-cols-2 gap-3 w-full min-w-0">
                  <div className="min-w-0">
                    <label htmlFor="rb-resolution" className="sr-only">
                      处理分辨率
                    </label>
                    <div className="relative">
                      <Maximize2
                        className="pointer-events-none absolute left-3 top-1/2 z-[1] h-3.5 w-3.5 -translate-y-1/2 text-emerald-400/90"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <ChevronDown
                        className="pointer-events-none absolute right-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-white/40"
                        aria-hidden
                      />
                      <select
                        id="rb-resolution"
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value as '1024' | '2048')}
                        className="tikgen-spec-select h-11 w-full min-w-0 appearance-none rounded-xl border-0 bg-black/40 py-2.5 pl-9 pr-10 text-sm font-medium text-white/92 outline-none ring-1 ring-inset ring-white/[0.12] transition-[box-shadow,background-color] duration-150 hover:bg-black/45 hover:ring-white/20 focus:ring-2 focus:ring-violet-400/40"
                      >
                        <option value="1024">1024px</option>
                        <option value="2048">2048px</option>
                      </select>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="rb-format" className="sr-only">
                      输出格式
                    </label>
                    <div className="relative">
                      <Box
                        className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-violet-300/75"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <ChevronDown
                        className="pointer-events-none absolute right-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-white/40"
                        aria-hidden
                      />
                      <select
                        id="rb-format"
                        value={outputFormat}
                        onChange={(e) => setOutputFormat(e.target.value as 'png' | 'webp')}
                        className="tikgen-spec-select h-11 w-full min-w-0 appearance-none rounded-xl border-0 bg-black/40 py-2.5 pl-9 pr-10 text-sm font-medium text-white/92 outline-none ring-1 ring-inset ring-white/[0.12] transition-[box-shadow,background-color] duration-150 hover:bg-black/45 hover:ring-white/20 focus:ring-2 focus:ring-violet-400/40"
                      >
                        <option value="png">PNG</option>
                        <option value="webp">WEBP</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="pt-1 flex w-full justify-center">
              <button
                type="button"
                disabled={!images.length || submitBusy}
                onClick={() => void handleSubmit()}
                className="w-full max-w-lg inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {submitBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}
                去除背景
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
              <p className="text-xs text-white/40 mt-1 max-w-xs">上传图片并点击「去除背景」后，进度与结果会出现在这里。</p>
            </div>
          ) : null}

          {sortedHistory.length > 0 ? (
            <div className="flex flex-col gap-4 pb-2">
              {sortedHistory.map((task) => (
                <div
                  key={task.id}
                  className="image-history-card rounded-2xl border border-white/14 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                      <Clock className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                      {relativeZh(task.ts)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                      <Maximize2 className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                      {task.resolutionLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75 uppercase tracking-wide">
                      {task.formatLabel}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium border ${
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
                          const ext = task.formatLabel.toLowerCase() === 'webp' ? 'webp' : 'png'
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
                                  href={url}
                                  download={`remove-bg-${task.id}-${idx + 1}.${ext}`}
                                  target="_blank"
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
                                    setLightbox({ url, downloadName: `remove-bg-${task.id}-${idx + 1}.${ext}` })
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
            href={lightbox.url}
            download={lightbox.downloadName || 'image.png'}
            target="_blank"
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
