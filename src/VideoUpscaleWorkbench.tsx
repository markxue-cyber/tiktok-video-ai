import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Clock, Download, Maximize2, RefreshCw, Trash2, Upload, Video } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { checkVideoStatus } from './api/video'
import {
  requestVideoUpscaleUploadSign,
  submitVideoEnhanceJob,
  uploadVideoFileToSignedUrl,
  type VideoEnhanceSubmitParams,
} from './api/videoEnhance'
import { createAssetAPI } from './api/assets'
import { archiveAiMediaOnce } from './utils/archiveAiMediaOnce'
import { TIKGEN_IG_IDB, tikgenIgIdbGet, tikgenIgIdbSet, tryLocalStorageSetJson } from './tikgenImageGenPersistence'

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

function VideoUpscaleLoadingCard({
  statusText,
  progressText,
}: {
  statusText?: string
  progressText?: string
}) {
  return (
    <div className="h-96 rounded-xl border border-white/10 bg-[linear-gradient(180deg,#080a14,#03040a)] px-6 text-center flex flex-col items-center justify-center">
      <div className="relative w-[88px] h-[88px] mb-3">
        <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-purple-400 animate-spin" />
        <div className="absolute inset-[14px] rounded-full border-[3px] border-transparent border-r-cyan-300 [animation:spin_1s_linear_infinite_reverse]" />
      </div>
      <h3 className="text-[28px] leading-none font-semibold text-white">视频生成中</h3>
      <p className="mt-2 text-sm text-white/70">正在计算运镜轨迹与画面细节，请稍等片刻...</p>
      <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
        {['构图', '运镜', '质检'].map((chip) => (
          <span key={chip} className="px-2.5 py-1 rounded-full text-xs border border-white/15 bg-white/5 text-white/80">
            {chip}
          </span>
        ))}
      </div>
      {statusText ? <p className="mt-4 text-sm text-white/75">{statusText}</p> : null}
      {progressText ? <p className="mt-1 text-xs text-white/55">{progressText}</p> : null}
    </div>
  )
}

function saveHistorySlice(tasks: VideoUpscaleHistoryTask[]) {
  const slice = tasks.slice(0, VIDEO_UPSCALE_MAX)
  void tikgenIgIdbSet(TIKGEN_IG_IDB.videoUpscaleHistoryFull, slice)
  tryLocalStorageSetJson(VIDEO_UPSCALE_LS, slice)
}

export function VideoUpscaleWorkbench() {
  const [file, setFile] = useState<File | null>(null)
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

  useEffect(() => {
    return () => {
      stopPollRef.current = true
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    ;(async () => {
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

  const resetInput = () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl('')
    setPublicVideoUrl('')
    setUploadError('')
    setVideoW(0)
    setVideoH(0)
    setDurationSec(10)
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

  const removeTask = (id: string) => {
    setHistory((prev) => prev.filter((t) => t.id !== id))
    if (activeJob?.historyId === id) setActiveJob(null)
  }

  const handleStart = async () => {
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
      inputName: file?.name,
      durationSec,
      progress: '0%',
    }
    setHistory((prev) => [row, ...prev].slice(0, VIDEO_UPSCALE_MAX))

    try {
      const params: VideoEnhanceSubmitParams = {
        inputVideoUrl: publicVideoUrl,
        targetResolution: targetRes,
        targetFps,
        videoDurationSec: durationSec,
        aspectRatio,
      }
      const submit = await submitVideoEnhanceJob(params)
      row.taskId = submit.taskId
      patchHistory(hid, { taskId: submit.taskId })
      setActiveJob({
        taskId: submit.taskId,
        historyId: hid,
        progress: '0%',
        statusText: submit.message || '画质提升处理中…',
      })

      for (let i = 0; i < 120; i++) {
        if (stopPollRef.current) return
        await new Promise((r) => setTimeout(r, 5000))
        if (stopPollRef.current) return
        const s = await checkVideoStatus(submit.taskId)
        const pct = s.progress || '0%'
        patchHistory(hid, { progress: pct })
        setActiveJob((aj) =>
          aj && aj.historyId === hid ? { ...aj, progress: pct, statusText: `处理中… ${pct}`.trim() } : aj,
        )
        const st = (s.status || '').toLowerCase()
        if (st === 'succeeded' || st === 'success' || st === 'completed') {
          if (!s.videoUrl) throw new Error('任务完成但未返回视频地址')
          patchHistory(hid, { status: 'completed', outputUrl: s.videoUrl, progress: '100%' })
          setResultUrl(s.videoUrl)
          setActiveJob(null)
          Sentry.captureMessage('video_upscale_success', { level: 'info', extra: { taskId: submit.taskId } })
          await archiveAiMediaOnce({
            url: s.videoUrl,
            type: 'video',
            name: `upscale-${hid}.mp4`,
            metadata: {
              from: 'video_upscale',
              model: 'sora-2',
              targetRes,
              targetFps,
              durationSec,
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
      Sentry.captureException(e, { extra: { scene: 'video_upscale' } })
      patchHistory(hid, { status: 'failed', errorMessage: e?.message || '失败' })
      setActiveJob(null)
      setErrorBanner(e?.message || '处理失败')
      setErrorCode(e?.code || 'UNKNOWN')
    }
  }

  const historyGrouped = useMemo(() => groupHistoryByDay(history), [history])

  const resLabel = (r: string) => (r === '2k' ? '2K' : r === '4k' ? '4K' : '1080P')

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-2">画质提升</h2>
        <p className="text-sm text-gray-500 mb-6">上传短视频（≤50MB、≤60秒），选择目标分辨率与帧率，使用 Sora 2.0 进行画质提升。</p>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">上传视频</label>
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center relative overflow-hidden min-h-[200px]">
            <input
              type="file"
              accept="video/*"
              className="absolute inset-0 opacity-0 cursor-pointer z-10"
              onChange={(e) => void onPickFile(e.target.files)}
            />
            {previewUrl ? (
              <div className="relative z-0">
                <video src={previewUrl} className="max-h-56 mx-auto rounded-lg bg-black" controls playsInline />
                <p className="text-xs text-gray-500 mt-2">
                  时长 {durationSec}s · 约 {aspectRatio}
                  {publicVideoUrl ? <span className="text-emerald-600"> · 已上传</span> : uploading ? <span> · 上传中…</span> : null}
                </p>
                <button
                  type="button"
                  onClick={resetInput}
                  className="mt-2 text-sm text-purple-600 hover:text-purple-800"
                >
                  重新选择
                </button>
              </div>
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto text-gray-400" />
                <p className="text-gray-500 mt-2">点击选择 1 个视频文件</p>
                <p className="text-xs text-gray-400 mt-1">最大 50MB，时长不超过 60 秒</p>
              </>
            )}
            {uploading ? (
              <div className="absolute inset-0 rounded-xl bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-20">
                <div className="text-sm text-white flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  上传中...
                </div>
              </div>
            ) : null}
          </div>
          {uploadError ? (
            <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
              <p className="text-sm text-red-600 flex-1">{uploadError}</p>
              {file ? (
                <button
                  type="button"
                  onClick={() => void runUpload(file, { durationSec, aspect: aspectRatio })}
                  className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 shrink-0"
                >
                  重试上传
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1">目标分辨率</label>
            <select
              value={targetRes}
              onChange={(e) => setTargetRes(e.target.value as '1080p' | '2k' | '4k')}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="1080p">1080P</option>
              <option value="2k">2K</option>
              <option value="4k">4K</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">目标帧率</label>
            <select
              value={targetFps}
              onChange={(e) => setTargetFps(Number(e.target.value) as 30 | 60)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-xs text-gray-600 mb-6">
          <div className="font-medium text-gray-800 mb-1">处理说明</div>
          <ul className="list-disc pl-4 space-y-1">
            <li>模型固定为 Sora 2.0（sora-2），与聚合上游能力一致。</li>
            <li>大文件通过云存储直传，无需整文件经过本站接口。</li>
          </ul>
        </div>

        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={!publicVideoUrl || !!activeJob || uploading}
          className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50"
        >
          {activeJob ? (
            <>
              <RefreshCw className="w-5 h-5 mr-2 animate-spin inline" />
              提升中...
            </>
          ) : (
            '开始提升'
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

        {activeJob ? (
          <div className="mb-6">
            <VideoUpscaleLoadingCard
              statusText={activeJob.statusText}
              progressText={`进度：${activeJob.progress}${activeJob.taskId ? ` | 任务ID：${activeJob.taskId}` : ''}`}
            />
          </div>
        ) : resultUrl && !activeJob ? (
          <div className="mb-6 rounded-xl border border-white/12 bg-black/25 p-4">
            <div className="text-sm font-medium text-white/90 mb-2">本次结果</div>
            <video src={resultUrl} className="w-full rounded-xl bg-black" controls playsInline />
            <a
              href={resultUrl}
              download
              target="_blank"
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
            <p className="text-sm text-white/55">暂无画质提升记录</p>
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
                          画质提升 · {resLabel(task.targetRes)} · {task.targetFps}FPS
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
                            <div className="rounded-xl border border-white/12 bg-black/30 aspect-video flex flex-col items-center justify-center gap-2 text-white/70 text-xs px-4">
                              <RefreshCw className="w-8 h-8 animate-spin opacity-80" />
                              <span>{task.progress || '0%'}</span>
                              {task.taskId ? <span className="text-[10px] text-white/40 break-all text-center">{task.taskId}</span> : null}
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
                            href={task.outputUrl}
                            download
                            target="_blank"
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
    </div>
  )
}
