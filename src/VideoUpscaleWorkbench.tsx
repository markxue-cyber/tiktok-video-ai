import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Clock, Download, Folder, Maximize2, RefreshCw, Trash2, Upload, Video, X } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { checkVideoStatus } from './api/video'
import {
  requestVideoUpscaleUploadSign,
  submitVideoEnhanceJob,
  uploadVideoFileToSignedUrl,
  type VideoEnhanceSubmitParams,
} from './api/videoEnhance'
import { createAssetAPI, listAssetsAPI, type AssetItem } from './api/assets'
import { archiveAiMediaOnce } from './utils/archiveAiMediaOnce'
import {
  TIKGEN_IG_IDB,
  tikgenIgIdbGet,
  tikgenIgIdbSet,
  tryLocalStorageSetJson,
  type VideoUpscaleWorkspaceV1,
} from './tikgenImageGenPersistence'
import { buildDownloadProxyUrl } from './utils/downloadProxy'
import { CreditCostWithZap } from './components/CreditCostWithZap'
import { CREDITS_PER_VIDEO } from './lib/billingCredits'

const VIDEO_UPSCALE_LS = 'tikgen.videoUpscale.history.v1'
const VIDEO_UPSCALE_MAX = 100
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_DURATION_SEC = 60

export type VideoUpscaleHistoryTask = {
  id: string
  ts: number
  status: 'processing' | 'completed' | 'failed'
  targetRes: '1080p' | '2k' | '4k'
  targetFps: 30 | 60
  aspectRatio: string
  inputUrl: string
  inputName?: string
  durationSec: number
  outputUrl?: string
  progress?: string
  taskId?: string
  errorMessage?: string
}

function historyDayKey(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function historyRelativeZh(ts: number) {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 55) return '刚刚'
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))} 分钟前`
  if (sec < 86400) return `${Math.max(1, Math.floor(sec / 3600))} 小时前`
  if (sec < 86400 * 7) return `${Math.max(1, Math.floor(sec / 86400))} 天前`
  return historyDayKey(ts)
}

function groupHistoryByDay(tasks: VideoUpscaleHistoryTask[]) {
  const sorted = [...tasks].sort((a, b) => b.ts - a.ts)
  const order: string[] = []
  const seen = new Set<string>()
  const byDay: Record<string, VideoUpscaleHistoryTask[]> = {}
  for (const t of sorted) {
    const k = historyDayKey(t.ts)
    if (!seen.has(k)) {
      seen.add(k)
      order.push(k)
    }
    if (!byDay[k]) byDay[k] = []
    byDay[k].push(t)
  }
  return order.map((day) => ({ day, tasks: byDay[day] }))
}

function guessAspect(w: number, h: number): string {
  if (!w || !h) return '9:16'
  return w >= h ? '16:9' : '9:16'
}

const VIDEO_UPSCALE_LOADING_CHIPS = ['构图', '运镜', '质检'] as const

function saveHistorySlice(tasks: VideoUpscaleHistoryTask[]) {
  const slice = tasks.slice(0, VIDEO_UPSCALE_MAX)
  void tikgenIgIdbSet(TIKGEN_IG_IDB.videoUpscaleHistoryFull, slice)
  tryLocalStorageSetJson(VIDEO_UPSCALE_LS, slice)
}

export function VideoUpscaleWorkbench({
  canGenerate,
  onRefreshUser,
  onOptimisticCreditsSpend,
}: {
  canGenerate: boolean
  onRefreshUser?: () => void | Promise<void>
  onOptimisticCreditsSpend?: (amount: number) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  /** 本机文件名或资产库视频名（无 File 对象时展示） */
  const [sourceVideoName, setSourceVideoName] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [publicVideoUrl, setPublicVideoUrl] = useState('')
  const [durationSec, setDurationSec] = useState(10)
  const [videoW, setVideoW] = useState(0)
  const [videoH, setVideoH] = useState(0)
  const [targetRes, setTargetRes] = useState<'1080p' | '2k' | '4k'>('1080p')
  const [targetFps, setTargetFps] = useState<30 | 60>(30)

  const [history, setHistory] = useState<VideoUpscaleHistoryTask[]>([])
  const [persistenceReady, setPersistenceReady] = useState(false)

  const [activeJob, setActiveJob] = useState<{
    taskId: string
    historyId: string
    progress: string
    statusText: string
  } | null>(null)

  const [resultUrl, setResultUrl] = useState('')
  const [errorBanner, setErrorBanner] = useState('')
  const [errorCode, setErrorCode] = useState('UNKNOWN')

  const stopPollRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const upscalePollRunningRef = useRef<string | null>(null)

  const [showVideoAssetPicker, setShowVideoAssetPicker] = useState(false)
  const [videoAssetTab, setVideoAssetTab] = useState<'user_upload' | 'ai_generated'>('user_upload')
  const [videoAssetList, setVideoAssetList] = useState<AssetItem[]>([])
  const [videoAssetBusy, setVideoAssetBusy] = useState(false)
  const [videoAssetSelectedIds, setVideoAssetSelectedIds] = useState<Set<string>>(new Set())
  const videoAssetCacheRef = useRef<{ user_upload: AssetItem[] | null; ai_generated: AssetItem[] | null }>({
    user_upload: null,
    ai_generated: null,
  })

  useEffect(() => {
    return () => {
      stopPollRef.current = true
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    ;(async () => {
      try {
        const ws = await tikgenIgIdbGet<VideoUpscaleWorkspaceV1>(TIKGEN_IG_IDB.videoUpscaleWorkspace)
        if (ws && ws.v === 1 && ws.publicVideoUrl) {
          setPublicVideoUrl(ws.publicVideoUrl)
          setPreviewUrl(ws.publicVideoUrl)
          setDurationSec(ws.durationSec || 10)
          setVideoW(ws.videoW || 0)
          setVideoH(ws.videoH || 0)
          setTargetRes(ws.targetRes || '1080p')
          setTargetFps(ws.targetFps || 30)
          setFile(null)
          setSourceVideoName(ws.inputName || '')
        }
      } catch {
        // ignore
      }
      try {
        const fromIdb = await tikgenIgIdbGet<VideoUpscaleHistoryTask[]>(TIKGEN_IG_IDB.videoUpscaleHistoryFull)
        if (Array.isArray(fromIdb) && fromIdb.length) {
          setHistory(fromIdb.filter((x) => x && x.id))
          setPersistenceReady(true)
          return
        }
      } catch {
        // ignore
      }
      try {
        const raw = localStorage.getItem(VIDEO_UPSCALE_LS)
        const parsed = raw ? JSON.parse(raw) : []
        if (Array.isArray(parsed) && parsed.length) setHistory(parsed)
      } catch {
        // ignore
      }
      setPersistenceReady(true)
    })()
  }, [])

  useEffect(() => {
    if (!persistenceReady) return
    saveHistorySlice(history)
  }, [history, persistenceReady])

  useEffect(() => {
    if (!persistenceReady) return
    const snap: VideoUpscaleWorkspaceV1 = {
      v: 1,
      publicVideoUrl,
      durationSec,
      videoW,
      videoH,
      targetRes,
      targetFps,
      inputName: file?.name || sourceVideoName || undefined,
    }
    void tikgenIgIdbSet(TIKGEN_IG_IDB.videoUpscaleWorkspace, snap)
  }, [persistenceReady, publicVideoUrl, durationSec, videoW, videoH, targetRes, targetFps, file?.name, sourceVideoName])

  const aspectRatio = useMemo(() => guessAspect(videoW, videoH), [videoW, videoH])

  const readVideoMeta = useCallback((f: File) => {
    return new Promise<{ duration: number; w: number; h: number }>((resolve, reject) => {
      const url = URL.createObjectURL(f)
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.muted = true
      v.playsInline = true
      v.src = url
      const done = () => {
        URL.revokeObjectURL(url)
      }
      v.onloadedmetadata = () => {
        const d = Number(v.duration)
        const w = v.videoWidth
        const h = v.videoHeight
        done()
        resolve({
          duration: Number.isFinite(d) ? d : 0,
          w: w || 0,
          h: h || 0,
        })
      }
      v.onerror = () => {
        done()
        reject(new Error('无法读取视频信息'))
      }
    })
  }, [])

  const readVideoMetaFromUrl = useCallback((url: string) => {
    return new Promise<{ duration: number; w: number; h: number }>((resolve, reject) => {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.muted = true
      v.playsInline = true
      v.crossOrigin = 'anonymous'
      v.src = url
      v.onloadedmetadata = () => {
        const d = Number(v.duration)
        const w = v.videoWidth
        const h = v.videoHeight
        resolve({
          duration: Number.isFinite(d) ? d : 0,
          w: w || 0,
          h: h || 0,
        })
      }
      v.onerror = () => reject(new Error('无法读取视频信息（可能受跨域限制，请本地上传）'))
    })
  }, [])

  const loadVideoAssetPicker = async (source: 'user_upload' | 'ai_generated') => {
    const cached = videoAssetCacheRef.current[source]
    if (cached && cached.length) {
      setVideoAssetList(cached)
      return
    }
    setVideoAssetBusy(true)
    try {
      const r = await listAssetsAPI({ source, type: 'video', limit: 60, offset: 0 })
      const rows = (r.assets || []).filter((x) => x.type === 'video')
      setVideoAssetList(rows)
      videoAssetCacheRef.current[source] = rows
    } finally {
      setVideoAssetBusy(false)
    }
  }

  useEffect(() => {
    if (!showVideoAssetPicker) return
    void loadVideoAssetPicker(videoAssetTab)
  }, [showVideoAssetPicker, videoAssetTab])

  const toggleVideoAssetPick = (id: string) => {
    setVideoAssetSelectedIds((prev) => {
      if (prev.has(id)) return new Set()
      return new Set([id])
    })
  }

  const confirmVideoAssetPick = async () => {
    const picked = videoAssetList.find((x) => videoAssetSelectedIds.has(x.id))
    setVideoAssetSelectedIds(new Set())
    setShowVideoAssetPicker(false)
    if (!picked?.url) return
    setUploadError('')
    setPublicVideoUrl('')
    setResultUrl('')
    setErrorBanner('')
    try {
      const meta = await readVideoMetaFromUrl(picked.url)
      if (!meta.duration || meta.duration > MAX_DURATION_SEC) {
        setUploadError(`时长需在 ${MAX_DURATION_SEC} 秒以内（当前约 ${meta.duration ? Math.ceil(meta.duration) : '?'} 秒）`)
        return
      }
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
      setFile(null)
      setSourceVideoName(picked.name || '资产库视频')
      setPreviewUrl(picked.url)
      setPublicVideoUrl(picked.url)
      const dSec = Math.max(1, Math.ceil(meta.duration))
      setDurationSec(dSec)
      setVideoW(meta.w)
      setVideoH(meta.h)
    } catch (e: any) {
      setUploadError(e?.message || '无法使用该资产视频')
    }
  }

  const resetInput = () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setSourceVideoName('')
    setPreviewUrl('')
    setPublicVideoUrl('')
    setUploadError('')
    setVideoW(0)
    setVideoH(0)
    setDurationSec(10)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleReselectVideo = () => {
    resetInput()
    requestAnimationFrame(() => fileInputRef.current?.click())
  }

  const onPickFile = async (list: FileList | null) => {
    const f = list?.[0]
    if (!f) return
    setUploadError('')
    setPublicVideoUrl('')
    setResultUrl('')
    setErrorBanner('')
    if (!String(f.type || '').startsWith('video/')) {
      setUploadError('请选择视频文件')
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      setUploadError('文件超过 50MB 上限')
      return
    }
    try {
      const meta = await readVideoMeta(f)
      if (!meta.duration || meta.duration > MAX_DURATION_SEC) {
        setUploadError(`时长需在 ${MAX_DURATION_SEC} 秒以内（当前约 ${meta.duration ? Math.ceil(meta.duration) : '?'} 秒）`)
        return
      }
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
      const blobUrl = URL.createObjectURL(f)
      setFile(f)
      setSourceVideoName(f.name)
      setPreviewUrl(blobUrl)
      const dSec = Math.max(1, Math.ceil(meta.duration))
      setDurationSec(dSec)
      setVideoW(meta.w)
      setVideoH(meta.h)
      const ar = guessAspect(meta.w, meta.h)
      void runUpload(f, { durationSec: dSec, aspect: ar })
    } catch (e: any) {
      setUploadError(e?.message || '读取视频失败')
    }
  }

  const runUpload = async (f: File, meta: { durationSec: number; aspect: string }) => {
    setUploading(true)
    setUploadError('')
    setPublicVideoUrl('')
    try {
      const sign = await requestVideoUpscaleUploadSign({
        fileName: f.name,
        contentType: f.type || 'video/mp4',
        fileSize: f.size,
      })
      await uploadVideoFileToSignedUrl(sign.signedUrl, sign.token, f)
      setPublicVideoUrl(sign.publicUrl)
      try {
        await createAssetAPI({
          source: 'user_upload',
          type: 'video',
          url: sign.publicUrl,
          name: f.name,
          metadata: { from: 'video_upscale_input', durationSec: meta.durationSec, aspectRatio: meta.aspect },
        })
      } catch {
        // 资产入库失败不阻断主流程
      }
    } catch (e: any) {
      setUploadError(e?.message || '上传失败')
      setPublicVideoUrl('')
    } finally {
      setUploading(false)
    }
  }

  const patchHistory = useCallback((id: string, patch: Partial<VideoUpscaleHistoryTask>) => {
    setHistory((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const runUpscaleStatusPoll = useCallback(
    async (
      historyId: string,
      taskId: string,
      meta: { targetRes: '1080p' | '2k' | '4k'; targetFps: 30 | 60; durationSec: number },
    ) => {
      if (upscalePollRunningRef.current === taskId) return
      upscalePollRunningRef.current = taskId
      try {
        for (let i = 0; i < 120; i++) {
          if (stopPollRef.current) return
          await new Promise((r) => setTimeout(r, 5000))
          if (stopPollRef.current) return
          const s = await checkVideoStatus(taskId)
          const pct = s.progress || '0%'
          patchHistory(historyId, { progress: pct })
          setActiveJob((aj) =>
            aj && aj.historyId === historyId ? { ...aj, progress: pct, statusText: `处理中… ${pct}`.trim() } : aj,
          )
          const st = (s.status || '').toLowerCase()
          if (st === 'succeeded' || st === 'success' || st === 'completed') {
            if (!s.videoUrl) throw new Error('任务完成但未返回视频地址')
            patchHistory(historyId, { status: 'completed', outputUrl: s.videoUrl, progress: '100%' })
            setResultUrl(s.videoUrl)
            setActiveJob(null)
            Sentry.captureMessage('video_upscale_success', { level: 'info', extra: { taskId } })
            await archiveAiMediaOnce({
              url: s.videoUrl,
              type: 'video',
              name: `upscale-${historyId}.mp4`,
              metadata: {
                from: 'video_upscale',
                model: 'sora-2',
                targetRes: meta.targetRes,
                targetFps: meta.targetFps,
                durationSec: meta.durationSec,
              },
            })
            return
          }
          if (st === 'failed' || st === 'error') {
            const err: any = new Error(s.failReason || '处理失败')
            err.code = s.failCode || 'UNKNOWN'
            throw err
          }
        }
        throw Object.assign(new Error('处理超时，请稍后在任务中心查看'), { code: 'UPSTREAM_TIMEOUT' })
      } catch (e: any) {
        Sentry.captureException(e, { extra: { scene: 'video_upscale_poll' } })
        patchHistory(historyId, { status: 'failed', errorMessage: e?.message || '失败' })
        setActiveJob(null)
        setErrorBanner(e?.message || '处理失败')
        setErrorCode(e?.code || 'UNKNOWN')
        void onRefreshUser?.()
      } finally {
        if (upscalePollRunningRef.current === taskId) upscalePollRunningRef.current = null
      }
    },
    [patchHistory, onRefreshUser],
  )

  /** 刷新/返回页面后：历史中有「处理中」且带 taskId 时自动续轮询 */
  useEffect(() => {
    if (!persistenceReady) return
    const pro = [...history].sort((a, b) => b.ts - a.ts).find((t) => t.status === 'processing' && t.taskId)
    if (!pro?.taskId) return
    if (upscalePollRunningRef.current === pro.taskId) return
    stopPollRef.current = false
    setActiveJob({
      taskId: pro.taskId,
      historyId: pro.id,
      progress: pro.progress || '0%',
      statusText: '恢复进度…',
    })
    void runUpscaleStatusPoll(pro.id, pro.taskId, {
      targetRes: pro.targetRes,
      targetFps: pro.targetFps,
      durationSec: pro.durationSec,
    })
  }, [persistenceReady, history, runUpscaleStatusPoll])

  const removeTask = (id: string) => {
    setHistory((prev) => prev.filter((t) => t.id !== id))
    if (activeJob?.historyId === id) setActiveJob(null)
  }

  const handleStart = async () => {
    if (!canGenerate) {
      setErrorBanner('请先完成本产品内付费（购买套餐）后再使用视频增强')
      setErrorCode('PAYMENT_REQUIRED')
      return
    }
    if (!publicVideoUrl) {
      setUploadError(uploading ? '正在上传视频，请稍候' : '请先选择并等待视频上传完成')
      return
    }
    setErrorBanner('')
    setErrorCode('UNKNOWN')
    setResultUrl('')
    stopPollRef.current = false

    const hid = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`
    const now = Date.now()
    const row: VideoUpscaleHistoryTask = {
      id: hid,
      ts: now,
      status: 'processing',
      targetRes,
      targetFps,
      aspectRatio,
      inputUrl: publicVideoUrl,
      inputName: file?.name || sourceVideoName || undefined,
      durationSec,
      progress: '0%',
    }
    setHistory((prev) => [row, ...prev].slice(0, VIDEO_UPSCALE_MAX))

    try {
      onOptimisticCreditsSpend?.(CREDITS_PER_VIDEO)
      const params: VideoEnhanceSubmitParams = {
        inputVideoUrl: publicVideoUrl,
        targetResolution: targetRes,
        targetFps,
        videoDurationSec: durationSec,
        aspectRatio,
      }
      const submit = await submitVideoEnhanceJob(params)
      patchHistory(hid, { taskId: submit.taskId })
      setActiveJob({
        taskId: submit.taskId,
        historyId: hid,
        progress: '0%',
        statusText: submit.message || '视频增强处理中…',
      })
      await runUpscaleStatusPoll(hid, submit.taskId, { targetRes, targetFps, durationSec })
    } catch (e: any) {
      Sentry.captureException(e, { extra: { scene: 'video_upscale' } })
      patchHistory(hid, { status: 'failed', errorMessage: e?.message || '失败' })
      setActiveJob(null)
      setErrorBanner(e?.message || '处理失败')
      setErrorCode(e?.code || 'UNKNOWN')
      void onRefreshUser?.()
    }
  }

  const historyGrouped = useMemo(() => groupHistoryByDay(history), [history])

  const resLabel = (r: string) => (r === '2k' ? '2K' : r === '4k' ? '4K' : '1080P')

  const videoUpscaleBtnClass =
    'px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-white/80 ring-1 ring-inset ring-white/[0.07] hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:opacity-50'

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="tikgen-panel rounded-2xl p-6">
        <div className="mb-6">
          <div className="block text-sm font-medium mb-2 text-white/75">上传视频</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              void onPickFile(e.target.files)
              e.target.value = ''
            }}
          />
          <div
            className={`tikgen-ref-dropzone rounded-xl text-center relative overflow-hidden min-h-[200px] p-2.5 transition-shadow ${
              previewUrl ? 'cursor-default' : uploading ? 'cursor-wait' : 'cursor-pointer'
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void onPickFile(e.dataTransfer?.files || null)
            }}
            onClick={() => {
              if (!previewUrl && !uploading) fileInputRef.current?.click()
            }}
          >
            {previewUrl ? (
              <div
                className="relative z-0 flex flex-col items-center p-3 sm:p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-full max-w-md rounded-xl overflow-hidden bg-black ring-1 ring-white/12">
                  <video
                    key={previewUrl}
                    src={previewUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="mx-auto max-h-[min(70vh,520px)] w-full object-contain"
                  />
                </div>
                <p className="text-xs text-white/55 mt-3">
                  {file?.name || sourceVideoName ? (
                    <span className="block truncate max-w-full text-white/75 mb-0.5">{file?.name || sourceVideoName}</span>
                  ) : null}
                  时长 {durationSec}s · 约 {aspectRatio}
                  {publicVideoUrl ? <span className="text-emerald-400/90"> · 已上传</span> : uploading ? <span className="text-white/50"> · 上传中…</span> : null}
                </p>
                <p className="text-[11px] text-white/40 mt-1">使用下方控件可暂停、拖动进度条、全屏播放</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <button type="button" onClick={handleReselectVideo} className={`${videoUpscaleBtnClass} inline-flex items-center`}>
                    重新选择文件
                  </button>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={(e) => {
                      e.stopPropagation()
                      setVideoAssetSelectedIds(new Set())
                      setShowVideoAssetPicker(true)
                    }}
                    className={`${videoUpscaleBtnClass} inline-flex items-center gap-1`}
                  >
                    <Folder className="w-3.5 h-3.5 text-white/45" aria-hidden />
                    从资产库选择
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 py-6 px-4 rounded-xl">
                <div
                  className="mb-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.035] ring-1 ring-inset ring-white/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]"
                  aria-hidden
                >
                  <Upload className="h-[18px] w-[18px] text-violet-200/35" strokeWidth={1.35} />
                </div>
                <p className="text-sm font-medium text-white/[0.55] tracking-tight">点击或拖拽上传</p>
                <p className="text-xs text-white/32 leading-relaxed">最大 50MB，时长不超过 60 秒</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={(e) => {
                      e.stopPropagation()
                      fileInputRef.current?.click()
                    }}
                    className={`${videoUpscaleBtnClass} cursor-pointer`}
                  >
                    选择文件
                  </button>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={(e) => {
                      e.stopPropagation()
                      setVideoAssetSelectedIds(new Set())
                      setShowVideoAssetPicker(true)
                    }}
                    className={`${videoUpscaleBtnClass} inline-flex items-center gap-1`}
                  >
                    <Folder className="w-3.5 h-3.5 text-white/45" aria-hidden />
                    从资产库选择
                  </button>
                </div>
              </div>
            )}
            {uploading ? (
              <div className="absolute inset-0 rounded-xl bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-20 pointer-events-none">
                <div className="text-sm text-white flex items-center gap-2 pointer-events-none">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  上传中...
                </div>
              </div>
            ) : null}
          </div>
          {uploadError ? (
            <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
              <p className="text-sm text-red-300/95 flex-1">{uploadError}</p>
              {file ? (
                <button
                  type="button"
                  onClick={() => void runUpload(file, { durationSec, aspect: aspectRatio })}
                  className="text-sm px-3 py-1.5 rounded-lg border border-red-400/30 text-red-200 hover:bg-red-500/15 shrink-0"
                >
                  重试上传
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1 text-white/75">目标分辨率</label>
            <select
              value={targetRes}
              onChange={(e) => setTargetRes(e.target.value as '1080p' | '2k' | '4k')}
              className="tikgen-spec-select w-full appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-3 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.08] transition-shadow hover:ring-white/12 focus:ring-2 focus:ring-violet-400/35"
            >
              <option value="1080p">1080P</option>
              <option value="2k">2K</option>
              <option value="4k">4K</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-white/75">目标帧率</label>
            <select
              value={targetFps}
              onChange={(e) => setTargetFps(Number(e.target.value) as 30 | 60)}
              className="tikgen-spec-select w-full appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-3 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.08] transition-shadow hover:ring-white/12 focus:ring-2 focus:ring-violet-400/35"
            >
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={!publicVideoUrl || !!activeJob || uploading || !canGenerate}
          title={!canGenerate ? '请先完成本产品内付费（购买套餐）后再使用视频增强' : undefined}
          className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50"
        >
          {activeJob ? (
            <>
              <RefreshCw className="w-5 h-5 mr-2 animate-spin inline" />
              提升中...
            </>
          ) : (
            <span className="inline-flex items-center justify-center gap-1.5">
              <span>开始提升</span>
              <CreditCostWithZap amount={CREDITS_PER_VIDEO} />
            </span>
          )}
        </button>
      </div>

      <div className="tikgen-panel rounded-2xl p-4 sm:p-5 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto overflow-x-visible">
        <h2 className="text-xl font-bold mb-3 text-white/95">生成历史</h2>

        {errorBanner ? (
          <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-100/95">
            <span className="font-medium">上次失败</span> · {errorBanner}
            <span className="text-red-300/80 ml-1">（{errorCode}）</span>
          </div>
        ) : null}

        {resultUrl && !activeJob ? (
          <div className="mb-6 rounded-xl border border-white/12 bg-black/25 p-4">
            <div className="text-sm font-medium text-white/90 mb-2">本次结果</div>
            <video src={resultUrl} className="w-full rounded-xl bg-black" controls playsInline />
            <a
              href={buildDownloadProxyUrl(resultUrl, 'video-upscaled.mp4')}
              download
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-gradient-to-r from-pink-500 to-purple-500 text-white"
            >
              <Download className="w-4 h-4" />
              下载视频
            </a>
          </div>
        ) : !history.length ? (
          <div className="min-h-[200px] flex flex-col items-center justify-center text-center text-white/45 border border-white/12 rounded-xl bg-white/[0.02] px-6 mb-6">
            <Video className="w-14 h-14 mb-3 opacity-35" />
            <p className="text-sm text-white/55">暂无视频增强记录</p>
            <p className="text-xs text-white/40 mt-1 max-w-xs">完成左侧上传与「开始提升」后，进度与结果会出现在此处并写入资产库。</p>
          </div>
        ) : null}

        {historyGrouped.length > 0 ? (
          <div className="space-y-10 pb-2">
            {historyGrouped.map(({ day, tasks }) => (
              <div key={day}>
                <div className="text-sm font-semibold text-white/90 mb-3">{day}</div>
                <div className="flex flex-col gap-4">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="image-history-card rounded-2xl border border-white/14 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md"
                    >
                      <div className="mb-2.5 flex items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 text-lg font-bold leading-snug text-white/95 sm:text-xl pr-1">
                          视频增强 · {resLabel(task.targetRes)} · {task.targetFps}FPS
                        </h3>
                        <button
                          type="button"
                          onClick={() => removeTask(task.id)}
                          className="shrink-0 rounded-md p-1.5 text-white/28 transition-colors hover:bg-white/[0.06] hover:text-white/48"
                          title="删除此条记录"
                          aria-label="删除此条记录"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      </div>
                      <div className="mb-3 overflow-x-auto overflow-y-hidden pb-0.5 [scrollbar-width:thin]">
                        <div className="flex w-max min-w-full flex-nowrap items-center gap-2">
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                            <Clock className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                            {historyRelativeZh(task.ts)}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                            <Box className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                            Sora 2.0
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                            <Maximize2 className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                            {task.aspectRatio}
                          </span>
                          <span
                            className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium border ${
                              task.status === 'completed'
                                ? 'bg-emerald-500/18 text-emerald-100 border-emerald-400/28'
                                : task.status === 'processing'
                                  ? 'bg-amber-500/18 text-amber-100 border-amber-400/30'
                                  : 'bg-red-500/15 text-red-100 border-red-400/25'
                            }`}
                          >
                            {task.status === 'completed' ? '已完成' : task.status === 'processing' ? '处理中' : '失败'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                        <div>
                          <div className="text-[10px] text-white/45 mb-1">源视频</div>
                          <div className="relative rounded-xl overflow-hidden border border-white/12 bg-black/40 aspect-video">
                            <video src={task.inputUrl} className="w-full h-full object-contain" controls playsInline muted />
                          </div>
                          {task.inputName ? (
                            <p className="text-[10px] text-white/40 mt-1 truncate" title={task.inputName}>
                              {task.inputName}
                            </p>
                          ) : null}
                        </div>
                        <div>
                          <div className="text-[10px] text-white/45 mb-1">输出</div>
                          {task.status === 'processing' ? (
                            <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden aspect-video">
                              <div className="relative h-full min-h-[11rem] w-full bg-[linear-gradient(180deg,#080a14,#03040a)]">
                                <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
                                  <div className="relative w-[52px] h-[52px] mb-1.5">
                                    <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-purple-400 animate-spin" />
                                    <div className="absolute inset-[9px] rounded-full border-[3px] border-transparent border-r-cyan-300 [animation:spin_1s_linear_infinite_reverse]" />
                                  </div>
                                  <h4 className="text-base font-semibold text-white/95">视频增强中</h4>
                                  <p className="mt-0.5 text-[10px] text-white/65 line-clamp-2 px-1">
                                    正在提升画质与细节，请稍候…
                                  </p>
                                  <div className="mt-1.5 flex items-center justify-center gap-1 flex-wrap">
                                    {VIDEO_UPSCALE_LOADING_CHIPS.map((chip) => (
                                      <span
                                        key={chip}
                                        className="px-1.5 py-0.5 rounded-full text-[9px] border border-white/15 bg-white/5 text-white/75"
                                      >
                                        {chip}
                                      </span>
                                    ))}
                                  </div>
                                  <div className="mt-2 w-[min(92%,14rem)]">
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/12">
                                      <div
                                        className="h-full rounded-full bg-gradient-to-r from-violet-400/90 to-fuchsia-400/85 transition-[width] duration-300 ease-out"
                                        style={{
                                          width: `${Math.max(
                                            2,
                                            Math.min(
                                              99,
                                              Number.parseInt(String(task.progress || '0').replace(/[^\d]/g, ''), 10) || 8,
                                            ),
                                          )}%`,
                                        }}
                                      />
                                    </div>
                                    <div className="mt-1 text-[10px] text-white/70 tabular-nums">
                                      处理中 {task.progress || '0%'}
                                      {task.taskId ? (
                                        <span className="block text-[9px] text-white/45 break-all mt-0.5">
                                          任务ID：{task.taskId}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : task.status === 'completed' && task.outputUrl ? (
                            <div className="relative rounded-xl overflow-hidden border border-white/12 bg-black/40 aspect-video">
                              <video src={task.outputUrl} className="w-full h-full object-contain" controls playsInline />
                            </div>
                          ) : (
                            <div className="rounded-xl border border-white/12 bg-red-950/20 aspect-video flex items-center justify-center text-xs text-red-200/90 px-3 text-center">
                              {task.errorMessage || '失败'}
                            </div>
                          )}
                        </div>
                      </div>

                      {task.status === 'completed' && task.outputUrl ? (
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={buildDownloadProxyUrl(task.outputUrl, `video-upscaled-${task.id}.mp4`)}
                            download
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-white/18 text-white/85 hover:bg-white/[0.08]"
                          >
                            <Download className="w-3.5 h-3.5" />
                            下载
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {showVideoAssetPicker && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-6xl max-h-[88vh] overflow-hidden bg-white rounded-2xl border shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="text-lg font-semibold">从资产库选择视频</div>
              <button
                type="button"
                onClick={() => setShowVideoAssetPicker(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVideoAssetTab('user_upload')}
                  className={`px-3 py-1.5 rounded-lg text-sm border-2 ${videoAssetTab === 'user_upload' ? 'bg-gray-900 text-white border-purple-400 shadow-[0_0_0_1px_rgba(167,139,250,0.55)]' : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200/70'}`}
                >
                  本地上传
                </button>
                <button
                  type="button"
                  onClick={() => setVideoAssetTab('ai_generated')}
                  className={`px-3 py-1.5 rounded-lg text-sm border-2 ${videoAssetTab === 'ai_generated' ? 'bg-gray-900 text-white border-purple-400 shadow-[0_0_0_1px_rgba(167,139,250,0.55)]' : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200/70'}`}
                >
                  AI 生成
                </button>
              </div>
              <div className="text-sm text-gray-500">已选 {videoAssetSelectedIds.size}/1</div>
            </div>
            <div className="p-5 overflow-auto flex-1">
              {videoAssetBusy ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : videoAssetList.length === 0 ? (
                <div className="text-sm text-gray-500">暂无可选视频资产</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {videoAssetList.map((a) => {
                    const checked = videoAssetSelectedIds.has(a.id)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleVideoAssetPick(a.id)}
                        className={`relative rounded-xl overflow-hidden border transition-all ${checked ? 'border-purple-500 ring-2 ring-purple-300 shadow-[0_0_0_2px_rgba(168,85,247,.35)]' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <video src={a.url} className="w-full h-28 object-cover bg-black" muted playsInline preload="metadata" />
                        {checked && (
                          <div className="absolute right-1.5 top-1.5 w-5 h-5 rounded-full bg-purple-600 text-white text-xs flex items-center justify-center">
                            ✓
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
              <button type="button" onClick={() => setShowVideoAssetPicker(false)} className="px-4 py-2 rounded-lg border">
                取消
              </button>
              <button type="button" onClick={() => void confirmVideoAssetPick()} className="px-4 py-2 rounded-lg bg-purple-600 text-white">
                确认选择{videoAssetSelectedIds.size ? `（${videoAssetSelectedIds.size}）` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
