import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  Pencil,
  Pin,
  Plus,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { createAssetAPI, listAssetsAPI, type AssetItem } from './api/assets'
import {
  homeChatTurnAPI,
  homeChatTurnStreamAPI,
  postHomeTelemetry,
  type HomeChatImageItem,
  type HomeChatTurnResult,
} from './api/homeChat'
import { archiveAiMediaOnce } from './utils/archiveAiMediaOnce'

const STORAGE_KEY = 'tikgen.homeChat.sessions.v1'
const ACTIVE_KEY = 'tikgen.homeChat.activeId.v1'
const MAX_SESSIONS = 100
const MAX_STORED_MESSAGES = 200
const API_HISTORY_MAX = 40
const DEFAULT_SEND_TEXT = '请结合上传的媒体回答我的问题。'
/** 首页输入框本地上传：单次多选上限，且待上传队列总数不超过该值 */
const MAX_HOME_CHAT_UPLOAD_QUEUE = 6

function buildAssistantTextFromTurn(data: HomeChatTurnResult): string {
  const parts: string[] = []
  if (data.analysisText) parts.push(String(data.analysisText))
  if (data.optimizedPrompt) parts.push(`【优化后提示词】\n${String(data.optimizedPrompt)}`)
  if (data.opsPack) {
    const titles = (data.opsPack.titles || []).filter(Boolean).map((t) => `- ${t}`).join('\n')
    const points = (data.opsPack.sellingPoints || []).filter(Boolean).map((t) => `- ${t}`).join('\n')
    const lead = String(data.opsPack.detailLead || '').trim()
    const block = [
      titles ? `【可直接使用标题】\n${titles}` : '',
      points ? `【可直接使用卖点】\n${points}` : '',
      lead ? `【详情页开场文案】\n${lead}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    if (block) parts.push(block)
  }
  if (data.nextQuestion) parts.push(`【下一步建议】\n${String(data.nextQuestion)}`)
  return parts.filter(Boolean).join('\n\n') || '（无文本回复）'
}

export type HomeChatAttachment = {
  id: string
  type: 'image' | 'video'
  url: string
  name: string
  sizeLabel?: string
  fromAsset?: boolean
}

export type HomeChatMsg = {
  id: string
  role: 'user' | 'assistant'
  text: string
  attachments?: HomeChatAttachment[]
  images?: string[]
  imageItems?: HomeChatImageItem[]
  blocked?: boolean
  followUps?: string[]
  /** 首轮流式：首字未到时在气泡内展示加载态，勿与快捷指令同时出现 */
  pendingAnalysis?: boolean
  /** 展示用：流式已显示长度（仅最后一条助手消息可能使用） */
  streamLen?: number
  /** 用户消息：发送瞬间的参数快照（气泡展示不随底部配置改动） */
  sendParams?: Pick<HomeChatSession['params'], 'aspectRatio' | 'imageCount' | 'subjectLock'>
}

export type HomeChatSession = {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  pinned?: boolean
  /** 最近一次成功生成的图片 URL（资产库链接），用于链式改图参考 */
  lastGeneratedRefUrl?: string
  /** 最近一次结构化分析摘要，供第二轮出图上下文 */
  productAnalysisSummary?: string
  /** 兼容旧版：仅用于迁移与会话筛选兜底 */
  media?: null | {
    type: 'image' | 'video'
    url: string
    name: string
    sizeLabel: string
    fromAsset?: boolean
  }
  messages: HomeChatMsg[]
  params: {
    resolution: '2K' | '4K' | 'HD'
    aspectRatio: '1:1' | '3:4' | '9:16' | '16:9' | '4:3'
    imageCount: 1 | 2 | 4
    style: '写实' | '动漫' | '国潮' | '手绘' | '赛博朋克' | '水墨'
    refWeight: number
    subjectLock: 'high' | 'medium'
    multiRatio: boolean
    abVariant: boolean
    qcEnabled: boolean
    syncToAssets: boolean
    optimizePrompt: boolean
    hdEnhance: boolean
    negativePrompt: boolean
    /** 缺省等同 auto，兼容旧版本地会话 */
    refinementIntent?: 'auto' | 'iterative' | 'fresh'
  }
}

type PendingUpload = {
  id: string
  status: 'uploading' | 'done' | 'error'
  progress: number
  name: string
  sizeLabel: string
  type: 'image' | 'video'
  url?: string
  error?: string
  fromAsset?: boolean
}

/** 输入框内左上角：待上传缩略图 + 删除 / 重试 */
function HomeComposerPendingStrip({
  items,
  onRemove,
  onRetry,
}: {
  items: PendingUpload[]
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {items.map((p) => (
        <div
          key={p.id}
          title={p.name}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-black/35 sm:h-[4.25rem] sm:w-[4.25rem]"
        >
          {p.status === 'done' && p.url ? (
            p.type === 'image' ? (
              <img src={p.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <video src={p.url} className="h-full w-full object-cover" muted playsInline />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Upload className="h-6 w-6 text-white/30" />
            </div>
          )}
          {p.status === 'uploading' ? (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/15">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width]"
                style={{ width: `${Math.max(5, p.progress)}%` }}
              />
            </div>
          ) : null}
          {p.status === 'error' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/65 p-1">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-300" />
              <button
                type="button"
                className="rounded bg-white/12 px-1.5 py-0.5 text-[10px] text-white/95 hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation()
                  onRetry(p.id)
                }}
              >
                重试
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="absolute right-0.5 top-0.5 z-[1] flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white shadow transition hover:bg-black/85"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(p.id)
            }}
            aria-label="移除"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

const defaultParams = (): HomeChatSession['params'] => ({
  resolution: '2K',
  aspectRatio: '3:4',
  imageCount: 2,
  style: '写实',
  refWeight: 0.7,
  subjectLock: 'high',
  multiRatio: false,
  abVariant: false,
  qcEnabled: true,
  syncToAssets: true,
  optimizePrompt: true,
  hdEnhance: true,
  negativePrompt: true,
  refinementIntent: 'auto',
})

function newSession(): HomeChatSession {
  const id =
    typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : `hs_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const now = Date.now()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    title: '新对话',
    pinned: false,
    media: null,
    messages: [],
    params: defaultParams(),
  }
}

function loadSessions(): HomeChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveSessions(sessions: HomeChatSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)))
  } catch {
    // ignore
  }
}

function sessionTitleFrom(firstUserText: string, mediaType: 'image' | 'video') {
  const prefix = mediaType === 'video' ? '视频·' : '图片·'
  const t = String(firstUserText || '').trim().replace(/\s+/g, ' ')
  const short = t.slice(0, 10) || '对话'
  return `${prefix}${short}`
}

function buildHistoryForApi(messages: HomeChatMsg[]): { role: 'user' | 'assistant'; text: string }[] {
  const tail = messages.slice(-API_HISTORY_MAX)
  return tail.map((m) => ({
    role: m.role,
    text:
      m.role === 'user' && m.attachments?.length
        ? `[附件×${m.attachments.length}] ${m.text}`
        : m.text,
  }))
}

function getLastMediaFromMessages(messages: HomeChatMsg[]): { type: 'image' | 'video'; url: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user' || !m.attachments?.length) continue
    const v = m.attachments.find((a) => a.type === 'video')
    if (v) return { type: 'video', url: v.url }
    const im = m.attachments.find((a) => a.type === 'image')
    if (im) return { type: 'image', url: im.url }
  }
  return null
}

function pickPrimaryMedia(
  attachments: HomeChatAttachment[],
  fallback: { type: 'image' | 'video'; url: string } | null,
): { type: 'image' | 'video'; url: string } | null {
  if (attachments.length) {
    const v = attachments.find((a) => a.type === 'video')
    if (v) return { type: 'video', url: v.url }
    const im = attachments.find((a) => a.type === 'image')
    if (im) return { type: 'image', url: im.url }
  }
  return fallback
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function getVideoDurationSec(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video')
    el.preload = 'metadata'
    const url = URL.createObjectURL(file)
    el.onloadedmetadata = () => {
      const d = Number(el.duration)
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(d) ? d : 0)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取视频信息'))
    }
    el.src = url
  })
}

const ASSISTANT_FOLLOWUPS = ['能再详细说明一下吗？', '请列出可执行要点', '还有需要注意的吗？']

const HOME_QUICK_FORCE_PHRASES = [
  '换场景',
  '更亮一点',
  '改成白底主图',
  '改成信息流风格',
  '生成同款风格图片',
  '确认高清生成',
  '换背景',
  '调亮',
  '提亮',
  '生成白底',
  '白底图',
  '白底主图',
]

function homeQuickForcePhrase(txt: string): boolean {
  const raw = String(txt || '')
  return HOME_QUICK_FORCE_PHRASES.some((p) => raw.includes(p))
}

function likelyGenerateIntent(txt: string): boolean {
  return /(生成|出图|做图|白底|场景图|信息流|封面|换场景|更亮|质感|主图|海报|种草)/.test(String(txt || ''))
}

function isPublicAssetUrl(url: string): boolean {
  const u = String(url || '').trim()
  if (!u.startsWith('http')) return false
  try {
    const parsed = new URL(u)
    return parsed.pathname.includes('/storage/v1/object/public/assets/')
  } catch {
    return false
  }
}

function hasSessionGeneratedMessages(messages: HomeChatMsg[]): boolean {
  return messages.some((m) => m.role === 'assistant' && !!(m.images?.length || m.imageItems?.length))
}

async function downloadImageUrl(url: string, filename: string) {
  const r = await fetch(url)
  const blob = await r.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.click()
  URL.revokeObjectURL(href)
}

function UserBubble({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`home-chat-user-bubble max-w-[min(85%,40rem)] rounded-3xl border border-white/12 bg-gradient-to-br from-violet-900/55 via-purple-900/45 to-fuchsia-900/40 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_32px_rgba(0,0,0,0.35)] px-4 py-3 text-sm leading-relaxed transition duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_12px_40px_rgba(139,92,246,0.18)] ${className}`}
    >
      {children}
    </div>
  )
}

function AssistantBubble({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`max-w-[min(85%,40rem)] px-1 py-1 text-sm leading-relaxed ${className}`}>
      {children}
    </div>
  )
}

function HomeGeneratedImageActions({
  imageUrl,
  index,
  sessionId,
  messageId,
  onFeedbackRecorded,
}: {
  imageUrl: string
  index: number
  sessionId: string
  messageId: string
  onFeedbackRecorded?: (satisfied: boolean, ok: boolean) => void
}) {
  const [vote, setVote] = useState<null | 'up' | 'down'>(null)
  const [submitting, setSubmitting] = useState(false)
  const label = `首页生成_${index + 1}`

  const onDownload = () => void downloadImageUrl(imageUrl, `${label}.png`)

  const onFeedback = async (satisfied: boolean) => {
    if (vote !== null || submitting) return
    setSubmitting(true)
    const ok = await postHomeTelemetry({
      event: 'home_feedback',
      satisfied,
      sessionId,
      messageId,
      imageUrl,
      index,
    })
    setSubmitting(false)
    if (ok) setVote(satisfied ? 'up' : 'down')
    onFeedbackRecorded?.(satisfied, ok)
  }

  return (
    <div className="mt-1 flex w-full flex-nowrap items-center justify-center gap-1">
      <button
        type="button"
        title="下载图片"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/12 bg-black/40 text-white/75 transition hover:border-white/22 hover:bg-white/[0.08]"
        onClick={(e) => {
          e.stopPropagation()
          void onDownload()
        }}
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="满意"
        disabled={vote !== null || submitting}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-black/40 text-emerald-200/90 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45 ${
          vote === 'up' ? 'border-emerald-400/70 ring-1 ring-emerald-400/50' : 'border-white/12 hover:border-white/22'
        }`}
        onClick={(e) => {
          e.stopPropagation()
          void onFeedback(true)
        }}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="不满意"
        disabled={vote !== null || submitting}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-black/40 text-rose-200/90 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45 ${
          vote === 'down' ? 'border-rose-400/70 ring-1 ring-rose-400/50' : 'border-white/12 hover:border-white/22'
        }`}
        onClick={(e) => {
          e.stopPropagation()
          void onFeedback(false)
        }}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 px-0.5" aria-hidden>
      <span className="inline-block h-2 w-2 rounded-full bg-white/55 animate-bounce" />
      <span className="inline-block h-2 w-2 rounded-full bg-white/55 animate-bounce [animation-delay:120ms]" />
      <span className="inline-block h-2 w-2 rounded-full bg-white/55 animate-bounce [animation-delay:240ms]" />
    </span>
  )
}

export type HomeNavigateImageTarget = 'imageGen' | 'ecommerce' | 'upscale' | 'translate'

type Props = {
  onGoBenefits: () => void
  onRefreshUser?: () => void | Promise<void>
  /** 首页功能卡片：跳转至图片创作各子模块 */
  onNavigateToImageModule?: (target: HomeNavigateImageTarget) => void
}

export function HomeChatModule({ onGoBenefits, onRefreshUser, onNavigateToImageModule }: Props) {
  const [sessions, setSessions] = useState<HomeChatSession[]>(() => loadSessions())
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY) || ''
    } catch {
      return ''
    }
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyStage, setBusyStage] = useState<'idle' | 'identify' | 'analyze' | 'optimize' | 'generate'>('idle')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [previewToken, setPreviewToken] = useState('')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [assetTab, setAssetTab] = useState<'user_upload' | 'ai_generated'>('user_upload')
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetList, setAssetList] = useState<AssetItem[]>([])
  /** 资产库弹窗内多选（id 集合） */
  const [assetPickerSelectedIds, setAssetPickerSelectedIds] = useState<Set<string>>(() => new Set())
  const [assetPickType, setAssetPickType] = useState<'image' | 'video' | 'both'>('both')
  const [preview, setPreview] = useState<{
    urls: string[]
    index: number
    type: 'image' | 'video'
    title?: string
    scale: number
  } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [paramsOpen, setParamsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const composerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const plusMenuRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)

  const active = useMemo(() => sessions.find((s) => s.id === activeId) || null, [sessions, activeId])

  /** 新建对话且尚未发送首条消息：展示标题 + 上移输入区 + 功能卡片（待上传附件在输入框内展示，不切换布局） */
  const showLanding = !!active && active.messages.length === 0 && !busy

  const hasThreadMedia = useMemo(() => {
    if (!active) return false
    if (active.media) return true
    return !!getLastMediaFromMessages(active.messages)
  }, [active])

  /** 每次进入首页模块：新建一条空会话，原当前会话保留在历史列表中 */
  useLayoutEffect(() => {
    const s = newSession()
    let trimmed = false
    setSessions((prev) => {
      let next = [s, ...prev]
      if (next.length > MAX_SESSIONS) {
        trimmed = true
        const oldestFirst = [...next].sort((a, b) => a.updatedAt - b.updatedAt)
        let over = next.length - MAX_SESSIONS
        for (const row of oldestFirst) {
          if (over <= 0) break
          if (row.pinned) continue
          next = next.filter((x) => x.id !== row.id)
          over -= 1
        }
      }
      return next
    })
    if (trimmed) {
      setToast('已达到 100 条历史会话上限，已自动删除最早未置顶会话')
      window.setTimeout(() => setToast(''), 4000)
    }
    setActiveId(s.id)
    try {
      localStorage.setItem(ACTIVE_KEY, s.id)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    saveSessions(sessions)
  }, [sessions])

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
    } catch {
      // ignore
    }
  }, [activeId])

  useEffect(() => {
    if (showLanding) return
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active?.messages.length, busy, pendingUploads.length, dragOver, showLanding])

  useEffect(() => {
    if (!plusMenuOpen && !paramsOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!composerRef.current) return
      if (composerRef.current.contains(e.target as Node)) return
      setPlusMenuOpen(false)
      setParamsOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [plusMenuOpen, paramsOpen])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(180, Math.max(42, el.scrollHeight))
    el.style.height = `${next}px`
  }, [input])

  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  /** 流式展示：逐字显示最后一条助手消息 */
  useEffect(() => {
    if (!active?.messages.length) return
    const last = active.messages[active.messages.length - 1]
    if (last.role !== 'assistant' || last.blocked) return
    const full = String(last.text || '')
    if (!full.length) return
    const len = last.streamLen ?? 0
    if (len >= full.length) return
    const t = window.setTimeout(() => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeId) return s
          const msgs = s.messages.map((m) =>
            m.id === last.id ? { ...m, streamLen: Math.min(full.length, (m.streamLen ?? 0) + Math.max(2, Math.ceil(full.length / 80))) } : m,
          )
          return { ...s, messages: msgs }
        }),
      )
    }, 18)
    return () => window.clearTimeout(t)
  }, [active?.messages, activeId])

  const loadAssets = useCallback(async () => {
    setAssetBusy(true)
    try {
      const type =
        assetPickType === 'both' ? undefined : assetPickType === 'image' ? 'image' : 'video'
      const r = await listAssetsAPI({ source: assetTab, type, limit: 80, offset: 0 })
      setAssetList(r.assets || [])
    } catch (e: any) {
      setError(e?.message || '加载资产失败')
    } finally {
      setAssetBusy(false)
    }
  }, [assetTab, assetPickType])

  useEffect(() => {
    if (!showAssetPicker) return
    void loadAssets()
  }, [showAssetPicker, loadAssets])

  const openAssetPicker = (t: 'image' | 'video' | 'both') => {
    setAssetPickType(t)
    setAssetPickerSelectedIds(new Set())
    setShowAssetPicker(true)
    setPlusMenuOpen(false)
  }

  const toggleAssetPickerItem = (a: AssetItem) => {
    setAssetPickerSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(a.id)) {
        next.delete(a.id)
        return next
      }
      const room = Math.max(0, MAX_HOME_CHAT_UPLOAD_QUEUE - pendingUploads.length)
      if (next.size >= room) {
        setToast(
          room === 0
            ? `待上传队列已满（最多 ${MAX_HOME_CHAT_UPLOAD_QUEUE} 个），请先发送或删除后再添加`
            : `最多再选 ${room} 个（队列总共不超过 ${MAX_HOME_CHAT_UPLOAD_QUEUE} 个）`,
        )
        window.setTimeout(() => setToast(''), 3500)
        return prev
      }
      next.add(a.id)
      return next
    })
  }

  const confirmAssetPickerSelection = () => {
    if (assetPickerSelectedIds.size === 0) {
      setToast('请先选择至少一项')
      window.setTimeout(() => setToast(''), 2500)
      return
    }
    const selected = assetList.filter((a) => assetPickerSelectedIds.has(a.id))
    const room = Math.max(0, MAX_HOME_CHAT_UPLOAD_QUEUE - pendingUploads.length)
    const toAdd = selected.slice(0, room)
    if (selected.length > toAdd.length) {
      setToast(`待上传队列仅余 ${room} 个空位，已添加前 ${toAdd.length} 项`)
      window.setTimeout(() => setToast(''), 4000)
    }
    const makeId = () =>
      typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
        ? globalThis.crypto.randomUUID()
        : `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    setPendingUploads((prev) => [
      ...prev,
      ...toAdd.map((a) => ({
        id: makeId(),
        status: 'done' as const,
        progress: 100,
        name: a.name || (a.type === 'video' ? '视频' : '图片'),
        sizeLabel: '',
        type: a.type,
        url: a.url,
        fromAsset: true,
      })),
    ])
    setShowAssetPicker(false)
    setAssetPickerSelectedIds(new Set())
    setSessions((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, updatedAt: Date.now(), media: null } : s)),
    )
  }

  const simulateProgress = (id: string) => {
    const timer = window.setInterval(() => {
      setPendingUploads((prev) =>
        prev.map((p) => {
          if (p.id !== id || p.status !== 'uploading') return p
          const next = Math.min(95, p.progress + 8 + Math.random() * 7)
          return { ...p, progress: next }
        }),
      )
    }, 160)
    return () => window.clearInterval(timer)
  }

  const validateAndUploadFiles = async (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0) return
    setError('')
    const files = Array.from(fileList)
    const room = Math.max(0, MAX_HOME_CHAT_UPLOAD_QUEUE - pendingUploads.length)
    if (room === 0) {
      setError(`待上传队列已满（最多 ${MAX_HOME_CHAT_UPLOAD_QUEUE} 个），请先发送或删除后再添加`)
      return
    }
    const take = Math.min(files.length, MAX_HOME_CHAT_UPLOAD_QUEUE, room)
    const capped = files.slice(0, take)
    if (files.length > take) {
      setToast(
        `单次最多选择 ${MAX_HOME_CHAT_UPLOAD_QUEUE} 个文件，且队列总共不超过 ${MAX_HOME_CHAT_UPLOAD_QUEUE} 个；已按顺序添加前若干项`,
      )
      window.setTimeout(() => setToast(''), 4500)
    }

    const uploadValidatedAsset = async (file: File, kind: 'image' | 'video') => {
      const pid =
        typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
          ? globalThis.crypto.randomUUID()
          : `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      setPendingUploads((prev) => [
        ...prev,
        {
          id: pid,
          status: 'uploading',
          progress: 5,
          name: file.name,
          sizeLabel: formatBytes(file.size),
          type: kind,
        },
      ])
      const stopProg = simulateProgress(pid)
      try {
        const dataUrl = await fileToDataUrl(file)
        const created = await createAssetAPI({
          source: 'user_upload',
          type: kind,
          url: dataUrl,
          name: file.name,
          metadata: { from: 'home_chat_upload', mime: file.type, size: file.size },
        })
        const url = String(created?.asset?.url || '').trim()
        if (!url) throw new Error('上传失败')
        stopProg()
        setPendingUploads((prev) =>
          prev.map((p) =>
            p.id === pid ? { ...p, status: 'done', progress: 100, url, type: kind } : p,
          ),
        )
      } catch (e: any) {
        stopProg()
        setPendingUploads((prev) =>
          prev.map((p) =>
            p.id === pid ? { ...p, status: 'error', progress: 0, error: e?.message || '上传失败' } : p,
          ),
        )
      }
    }

    for (const file of capped) {
      const mime = String(file.type || '').toLowerCase()
      const isImg = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp'
      const isVid = mime === 'video/mp4' || mime === 'video/quicktime'
      if (!isImg && !isVid) {
        setToast('已跳过不支持的格式（仅 JPG/PNG/WebP 或 MP4/MOV）')
        window.setTimeout(() => setToast(''), 3500)
        continue
      }
      if (isImg && file.size > 20 * 1024 * 1024) {
        setToast(`已跳过过大图片：${file.name}（单张需 ≤ 20MB）`)
        window.setTimeout(() => setToast(''), 3500)
        continue
      }
      if (isVid) {
        if (file.size > 500 * 1024 * 1024) {
          setToast(`已跳过大体积视频：${file.name}（单个需 ≤ 500MB）`)
          window.setTimeout(() => setToast(''), 3500)
          continue
        }
        try {
          const dur = await getVideoDurationSec(file)
          if (dur > 600) {
            setToast(`已跳过过长视频：${file.name}（需 ≤ 10 分钟）`)
            window.setTimeout(() => setToast(''), 3500)
            continue
          }
        } catch {
          setToast(`无法读取视频时长，已跳过：${file.name}`)
          window.setTimeout(() => setToast(''), 3500)
          continue
        }
      }
      await uploadValidatedAsset(file, isVid ? 'video' : 'image')
    }
  }

  const removePending = (id: string) => {
    setPendingUploads((prev) => prev.filter((p) => p.id !== id))
  }

  const retryPending = (id: string) => {
    uploadInputRef.current?.click()
    setPendingUploads((prev) => prev.filter((p) => p.id !== id))
  }

  const handleSend = async () => {
    const s = sessions.find((x) => x.id === activeId)
    if (!s || busy) return
    const trimmed = input.trim()
    const pendingDone = pendingUploads.filter((p) => p.status === 'done' && p.url)
    const legacyMedia = s.media
    const lastMedia = getLastMediaFromMessages(s.messages)
    const fallbackMedia = lastMedia || (legacyMedia ? { type: legacyMedia.type, url: legacyMedia.url } : null)

    const attachments: HomeChatAttachment[] = pendingDone.map((p) => ({
      id: p.id,
      type: p.type,
      url: p.url!,
      name: p.name,
      sizeLabel: p.sizeLabel,
      fromAsset: !!p.fromAsset,
    }))

    const primary = pickPrimaryMedia(attachments, fallbackMedia)
    if (!primary) {
      setError('请先上传图片或视频，再发起对话')
      return
    }
    /** 与会话内「最近一条带附件的用户消息」主图是否不同；用于后端对新图走完整电商分析而非短跟进 */
    const newSubjectMediaThisTurn =
      !lastMedia ||
      primary.url !== lastMedia.url ||
      primary.type !== lastMedia.type
    if (!pendingDone.length && !trimmed) {
      setError('请输入有效内容，或上传图片/视频')
      return
    }
    if (!pendingDone.length && trimmed && !hasThreadMedia) {
      setError(
        homeQuickForcePhrase(trimmed)
          ? '快捷改图需要先在本对话中上传过商品图；请先上传素材，或从历史消息中保留的附件继续。'
          : '请先上传图片或视频，再发起对话',
      )
      return
    }
    const sendText = trimmed || DEFAULT_SEND_TEXT

    const refForGen =
      primary.type === 'image' &&
      attachments.length === 0 &&
      isPublicAssetUrl(s.lastGeneratedRefUrl || '') &&
      (likelyGenerateIntent(sendText) || homeQuickForcePhrase(sendText))
        ? s.lastGeneratedRefUrl
        : undefined
    const hasGenPayload = hasSessionGeneratedMessages(s.messages)
    const localeStr =
      typeof navigator !== 'undefined' && navigator.language ? navigator.language : ''
    const contextSummary = String(s.productAnalysisSummary || '').slice(0, 2500)

    const conn =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
        : undefined
    const softNetwork =
      !!conn && (conn.saveData === true || /2g|slow-2g/i.test(String(conn.effectiveType || '')))
    const ep = softNetwork
      ? { ...s.params, multiRatio: false as const, abVariant: false as const, qcEnabled: false as const }
      : s.params
    if (softNetwork) {
      setToast('当前网络较慢，已自动关闭多比例、A/B 与轻量质检以加快出图')
      window.setTimeout(() => setToast(''), 4500)
    }

    let hist = buildHistoryForApi(s.messages)
    if (hist.length > API_HISTORY_MAX) {
      setToast('已为您保留最近 20 轮有效对话，更早的对话内容已自动精简，保证模型响应速度')
      window.setTimeout(() => setToast(''), 5000)
    }

    const userMsg: HomeChatMsg = {
      id: `m_${Date.now()}_u`,
      role: 'user',
      text: sendText,
      attachments: attachments.length ? attachments : undefined,
      sendParams: {
        aspectRatio: ep.aspectRatio,
        imageCount: ep.imageCount,
        subjectLock: ep.subjectLock,
      },
    }

    const paramLine = `【${ep.aspectRatio} · ${ep.imageCount}张 · ${
      ep.subjectLock === 'high' ? '高保真' : '标准保真'
    }】`

    setSessions((prev) =>
      prev.map((x) => {
        if (x.id !== activeId) return x
        const nextMsgs = [...x.messages, userMsg].slice(-MAX_STORED_MESSAGES)
        const title =
          x.messages.length === 0 ? sessionTitleFrom(sendText, primary.type) : x.title
        return {
          ...x,
          title,
          updatedAt: Date.now(),
          messages: nextMsgs,
          media: null,
        }
      }),
    )
    setPendingUploads([])
    setInput('')
    setBusy(true)
    setBusyStage('identify')
    setError('')
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    hist = [...hist, { role: 'user' as const, text: `[附件] ${sendText}` }]

    let assistantMsgId: string | null = null
    try {
      const wantsGenerate = likelyGenerateIntent(sendText)
      const wantsFinal = /(确认|继续|正式|高清|final)/i.test(sendText)
      const generateMode: 'preview' | 'final' = wantsGenerate
        ? previewToken && wantsFinal
          ? 'final'
          : 'preview'
        : 'final'
      if (generateMode === 'preview') setPreviewToken('')

      const paramsPayload = {
        resolution: ep.resolution,
        aspectRatio: ep.aspectRatio,
        imageCount: ep.imageCount,
        style: ep.style,
        refWeight: ep.refWeight,
        subjectLock: ep.subjectLock,
        multiRatio: ep.multiRatio,
        targetRatios: ep.multiRatio ? ['1:1', '3:4', '9:16'] : [ep.aspectRatio],
        abVariant: ep.abVariant,
        qcEnabled: ep.qcEnabled,
        generateMode,
        previewToken: generateMode === 'final' ? previewToken : '',
        optimizePrompt: ep.optimizePrompt,
        hdEnhance: ep.hdEnhance,
        negativePrompt: ep.negativePrompt,
        refinementIntent: ep.refinementIntent ?? 'auto',
      }

      setBusyStage('analyze')
      assistantMsgId = `m_${Date.now()}_a`
      setSessions((prev) =>
        prev.map((x) => {
          if (x.id !== activeId) return x
          return {
            ...x,
            updatedAt: Date.now(),
            messages: [
              ...x.messages,
              {
                id: assistantMsgId!,
                role: 'assistant' as const,
                text: '',
                pendingAnalysis: true,
              },
            ],
          }
        }),
      )

      const data = await homeChatTurnStreamAPI(
        {
          mediaType: primary.type,
          mediaUrl: primary.url,
          userMessage: `${paramLine}\n${sendText}`,
          refImageUrl: refForGen,
          contextSummary,
          hasSessionGenerated: hasGenPayload,
          sessionId: s.id,
          locale: localeStr,
          newSubjectMediaThisTurn,
          generateMode,
          previewToken: generateMode === 'final' ? previewToken : '',
          history: hist.slice(-API_HISTORY_MAX),
          splitPipeline: true,
          params: paramsPayload,
        },
        {
          signal: abortRef.current?.signal,
          onDelta: (chunk) => {
            if (!chunk) return
            setSessions((prev) =>
              prev.map((session) => {
                if (session.id !== activeId) return session
                return {
                  ...session,
                  updatedAt: Date.now(),
                  messages: session.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          text: (m.text || '') + chunk,
                          streamLen: (m.text || '').length + chunk.length,
                          pendingAnalysis: false,
                        }
                      : m,
                  ),
                }
              }),
            )
          },
        },
      )

      if (!data?.success) {
        const code = String(data?.code || '')
        const msgRaw = String(data?.error || '请求失败')
        const msg =
          code === 'BAD_MEDIA'
            ? '素材读取失败，请重新上传图片/视频后重试。'
            : code === 'NOT_PRODUCT_IMAGE'
              ? String(data?.error || '当前参考图不太像可上架商品主体，请上传清晰商品图或使用「仅分析」。')
              : code === 'UPSTREAM_FAILED'
                ? '模型服务繁忙，请稍后重试；建议先简化需求或减少生成张数。'
                : code === 'UPSTREAM_TIMEOUT'
                  ? '请求超时，请先生成1张预览图确认方向，或关闭多比例/A-B后重试。'
                  : code === 'RATE_LIMITED'
                    ? '请求过于频繁，请等待 10-20 秒后重试。'
                    : /FUNCTION_INVOCATION_TIMEOUT|timeout/i.test(msgRaw)
                      ? '请求超时，请先生成1张预览图确认方向，或关闭多比例/A-B后重试。'
                      : msgRaw
        if (code === 'QUOTA_EXHAUSTED' || /额度|用尽/.test(msg)) onGoBenefits()
        if (code === 'PAYMENT_REQUIRED' || /付费|订单/.test(msg)) onGoBenefits()
        setSessions((prev) =>
          prev.map((x) => {
            if (x.id !== activeId) return x
            return {
              ...x,
              updatedAt: Date.now(),
              messages: x.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      text: msg,
                      blocked: true,
                      pendingAnalysis: false,
                      followUps: ['重试', '减少生成张数后重试', '仅分析不生成', '重新上传素材'],
                    }
                  : m,
              ),
            }
          }),
        )
        return
      }

      if (data.kind === 'blocked') {
        setSessions((prev) =>
          prev.map((x) => {
            if (x.id !== activeId) return x
            return {
              ...x,
              updatedAt: Date.now(),
              messages: x.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      text: String(data.message || ''),
                      blocked: true,
                      pendingAnalysis: false,
                      followUps: ['仅分析素材', '提炼可用卖点', '重新描述我的需求'],
                    }
                  : m,
              ),
            }
          }),
        )
        return
      }

      if (data.kind === 'analysis' || data.kind === 'mixed' || data.kind === 'mock') {
        const assistantTextFinal = buildAssistantTextFromTurn(data)
        setSessions((prev) =>
          prev.map((x) => {
            if (x.id !== activeId) return x
            return {
              ...x,
              updatedAt: Date.now(),
              productAnalysisSummary: data.analysisText
                ? String(data.analysisText).slice(0, 2000)
                : x.productAnalysisSummary,
              messages: x.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      text: assistantTextFinal,
                      streamLen: assistantTextFinal.length,
                      pendingAnalysis: false,
                      followUps: data.quickActions?.length ? [...data.quickActions] : ASSISTANT_FOLLOWUPS,
                    }
                  : m,
              ),
            }
          }),
        )

        /**
         * 首轮仅分析、出图在第二轮。除服务端显式 deferredImageGen 外，若用户明显要出图但首轮未带图，也走第二轮（防止意图漏判导致永远不请求 generateOnly）。
         */
        const firstResponseHasImages =
          (Array.isArray(data.images) && data.images.some((x) => !!x?.url)) ||
          (Array.isArray(data.imageUrls) && data.imageUrls.some(Boolean))
        /** 比 likelyGenerateIntent 更严：避免「只咨询质感/主图」误触发第二轮出图 */
        const strongExplicitImageRequest =
          homeQuickForcePhrase(sendText) ||
          /(生成|出图|做图|制图|来一张|做一张|来张|做张|张图|重绘|修图|p\s*图|换场景|换背景|白底主图|信息流|同款|更亮|调亮|提亮|做主图|主图生成)/i.test(
            String(sendText || ''),
          )
        const shouldRunFollowUpImageGen =
          data.deferredImageGen === true ||
          (!firstResponseHasImages && strongExplicitImageRequest)

        if (shouldRunFollowUpImageGen) {
          const analysisForGen = String(data.analysisText || '').trim()
          const analysisTextFallback =
            '【商品主体】与参考图一致（继承会话上下文）。\n【说明】用户已发起改图/出图快捷指令；本节为简要占位，正式画面由下一步生成模型输出。\n【商用视觉诊断】仅基于参考图简述当前曝光与主体清晰度，禁止展开第三方修图教程。\n系统将基于参考图按你的指令生成新的商品图。'
          setBusyStage('optimize')
          setBusyStage('generate')
          const data2 = await homeChatTurnAPI(
            {
              generateOnly: true,
              analysisText: analysisForGen || analysisTextFallback,
              mediaType: primary.type,
              mediaUrl: primary.url,
              userMessage: `${paramLine}\n${sendText}`,
              refImageUrl: refForGen,
              contextSummary,
              hasSessionGenerated: hasGenPayload,
              sessionId: s.id,
              locale: localeStr,
              newSubjectMediaThisTurn,
              generateMode,
              previewToken: generateMode === 'final' ? previewToken : '',
              history: hist.slice(-API_HISTORY_MAX),
              params: paramsPayload,
            },
            { signal: abortRef.current?.signal },
          )

          if (!data2?.success) {
            const code = String(data2?.code || '')
            const msgRaw = String(data2?.error || '出图失败')
            const msg =
              code === 'NOT_PRODUCT_IMAGE'
                ? String(data2?.error || '参考图不太像商品主体，请换图或先仅分析。')
                : code === 'IMAGE_GEN_EMPTY'
                  ? String(
                      data2?.error ||
                        '未收到有效出图结果，请重试；若多次出现可暂时关闭「自动优化提示词」或减少生成张数。',
                    )
                : code === 'UPSTREAM_TIMEOUT'
                  ? '出图超时，请稍后重试或先生成预览图。'
                  : code === 'RATE_LIMITED'
                    ? '操作过于频繁，请稍后再试。'
                    : msgRaw
            setSessions((prev) =>
              prev.map((session) => {
                if (session.id !== activeId) return session
                const msgs = session.messages.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, text: `${m.text}\n\n【出图未完成】${msg}`, blocked: true }
                    : m,
                )
                return { ...session, updatedAt: Date.now(), messages: msgs }
              }),
            )
            return
          }

          setBusyStage('optimize')
          const imageItems: HomeChatImageItem[] = Array.isArray(data2.images)
            ? data2.images.filter((x) => !!x?.url)
            : []
          const imgs: string[] = imageItems.length
            ? imageItems.map((x) => x.url)
            : Array.isArray(data2.imageUrls)
              ? data2.imageUrls.filter(Boolean)
              : []
          if (data2.previewToken) setPreviewToken(String(data2.previewToken))
          else if (generateMode === 'final') setPreviewToken('')

          if (!imgs.length) {
            const msg =
              '【出图未完成】服务端返回成功但未包含图片地址，请重试；若持续出现请联系支持或暂时关闭「自动优化提示词」。'
            setSessions((prev) =>
              prev.map((session) => {
                if (session.id !== activeId) return session
                return {
                  ...session,
                  updatedAt: Date.now(),
                  messages: session.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, text: `${m.text}\n\n${msg}`, blocked: true } : m,
                  ),
                }
              }),
            )
            return
          }

          const extraOpt = data2.optimizedPrompt
            ? `\n\n【优化后提示词】\n${String(data2.optimizedPrompt)}`
            : ''
          setSessions((prev) =>
            prev.map((session) => {
              if (session.id !== activeId) return session
              const msgs = session.messages.map((m) =>
                m.id === assistantMsgId
                  ? (() => {
                      const nextText = `${m.text}${extraOpt}`
                      return {
                        ...m,
                        text: nextText,
                        streamLen: nextText.length,
                        images: imgs.length ? imgs : undefined,
                        imageItems: imageItems.length ? imageItems : undefined,
                        followUps:
                          data2.quickActions && data2.quickActions.length
                            ? [...data2.quickActions, ...(data2.previewToken ? ['确认高清生成'] : [])]
                            : m.followUps,
                      }
                    })()
                  : m,
              )
              const firstImg = imgs[0]
              return {
                ...session,
                updatedAt: Date.now(),
                messages: msgs,
                lastGeneratedRefUrl:
                  firstImg && isPublicAssetUrl(firstImg) ? firstImg : session.lastGeneratedRefUrl,
              }
            }),
          )

          if (imgs.length && s.params.syncToAssets) {
            const sid = s.id
            let idx = 0
            const d = new Date()
            const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
            for (const url of imgs) {
              idx += 1
              const name = `对话生成_${ymd}_${idx}.png`
              void archiveAiMediaOnce({
                url,
                type: 'image',
                name,
                metadata: {
                  source_label: '对话生成 - 首页模块',
                  session_id: sid,
                  aspect_ratio: s.params.aspectRatio,
                  style: s.params.style,
                  resolution: s.params.resolution,
                  prompt: sendText,
                },
              })
            }
          }

          void onRefreshUser?.()
          return
        }

        setBusyStage('optimize')
        setBusyStage('generate')
        const imageItems: HomeChatImageItem[] = Array.isArray(data.images)
          ? data.images.filter((x) => !!x?.url)
          : []
        const imgs: string[] = imageItems.length
          ? imageItems.map((x) => x.url)
          : Array.isArray(data.imageUrls)
            ? data.imageUrls.filter(Boolean)
            : []
        if (data.previewToken) setPreviewToken(String(data.previewToken))
        else if (generateMode === 'final') setPreviewToken('')
        setSessions((prev) =>
          prev.map((x) => {
            if (x.id !== activeId) return x
            const firstImg = imgs[0]
            return {
              ...x,
              updatedAt: Date.now(),
              productAnalysisSummary: data.analysisText
                ? String(data.analysisText).slice(0, 2000)
                : x.productAnalysisSummary,
              lastGeneratedRefUrl:
                firstImg && isPublicAssetUrl(firstImg) ? firstImg : x.lastGeneratedRefUrl,
              messages: x.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      text: assistantTextFinal,
                      images: imgs.length ? imgs : undefined,
                      imageItems: imageItems.length ? imageItems : undefined,
                      streamLen: assistantTextFinal.length,
                      pendingAnalysis: false,
                      followUps:
                        data.quickActions && data.quickActions.length
                          ? [...data.quickActions, ...(data.previewToken ? ['确认高清生成'] : [])]
                          : ASSISTANT_FOLLOWUPS,
                    }
                  : m,
              ),
            }
          }),
        )

        if (imgs.length && s.params.syncToAssets) {
          const sid = s.id
          let idx = 0
          const d = new Date()
          const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
          for (const url of imgs) {
            idx += 1
            const name = `对话生成_${ymd}_${idx}.png`
            void archiveAiMediaOnce({
              url,
              type: 'image',
              name,
              metadata: {
                source_label: '对话生成 - 首页模块',
                session_id: sid,
                aspect_ratio: s.params.aspectRatio,
                style: s.params.style,
                resolution: s.params.resolution,
                prompt: sendText,
              },
            })
          }
        }
      }

      void onRefreshUser?.()
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        if (assistantMsgId) {
          setSessions((prev) =>
            prev.map((x) => {
              if (x.id !== activeId) return x
              return {
                ...x,
                updatedAt: Date.now(),
                messages: x.messages.filter((m) => m.id !== assistantMsgId),
              }
            }),
          )
        }
        return
      }
      const raw = String(e?.message || '未知错误')
      const actionable =
        /Failed to fetch|NetworkError|network/i.test(raw)
          ? '网络连接不稳定，请检查网络后重试。'
          : /timeout|timed out/i.test(raw)
            ? '请求超时，请稍后重试；建议先减少生成张数。'
            : raw
      const errText = `请求失败：${actionable}`
      if (assistantMsgId) {
        setSessions((prev) =>
          prev.map((x) => {
            if (x.id !== activeId) return x
            return {
              ...x,
              updatedAt: Date.now(),
              messages: x.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      text: errText,
                      blocked: true,
                      pendingAnalysis: false,
                      followUps: ['重试', '减少生成张数后重试', '仅分析不生成', '重新上传素材'],
                    }
                  : m,
              ),
            }
          }),
        )
      } else {
        const am: HomeChatMsg = {
          id: `m_${Date.now()}_err`,
          role: 'assistant',
          text: errText,
          blocked: true,
          followUps: ['重试', '减少生成张数后重试', '仅分析不生成', '重新上传素材'],
        }
        setSessions((prev) =>
          prev.map((x) =>
            x.id === activeId ? { ...x, updatedAt: Date.now(), messages: [...x.messages, am] } : x,
          ),
        )
      }
    } finally {
      setBusy(false)
      setBusyStage('idle')
    }
  }

  const newChat = () => {
    if (busy) {
      if (!window.confirm('是否新建对话？当前未完成的生成内容将被清空')) return
      abortRef.current?.abort()
      setBusy(false)
    }
    setPendingUploads([])
    const s = newSession()
    setSessions((prev) => {
      let next = [s, ...prev]
      if (next.length > MAX_SESSIONS) {
        setToast('已达到 100 条历史会话上限，已自动删除最早未置顶会话')
        window.setTimeout(() => setToast(''), 4000)
        const oldestFirst = [...next].sort((a, b) => a.updatedAt - b.updatedAt)
        let over = next.length - MAX_SESSIONS
        for (const row of oldestFirst) {
          if (over <= 0) break
          if (row.pinned) continue
          next = next.filter((x) => x.id !== row.id)
          over -= 1
        }
      }
      return next
    })
    setActiveId(s.id)
    setInput('')
    setError('')
    setPreviewToken('')
  }

  const deleteSession = (id: string) => {
    if (!window.confirm('确认删除该会话？')) return
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      if (!next.length) {
        const s = newSession()
        setActiveId(s.id)
        return [s]
      }
      if (id === activeId) {
        setActiveId(next[0]!.id)
      }
      return next
    })
  }

  const clearAll = () => {
    if (!window.confirm('确认清空全部历史会话？')) return
    setPendingUploads([])
    const s = newSession()
    setSessions([s])
    setActiveId(s.id)
    setPreviewToken('')
  }

  const renameSession = (id: string) => {
    const v = window.prompt('重命名会话', sessions.find((x) => x.id === id)?.title || '')
    if (v == null) return
    const t = v.trim()
    if (!t) return
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: t, updatedAt: Date.now() } : s)))
  }

  const togglePin = (id: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned, updatedAt: Date.now() } : s)),
    )
  }

  const filteredSessions = useMemo(
    () => [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt),
    [sessions],
  )

  const pendingReady = pendingUploads.some((p) => p.status === 'done' && p.url)
  const composerPlaceholder = pendingReady
    ? '说说你想怎样改文字、编辑或使用图片'
    : pendingUploads.some((p) => p.status === 'uploading')
      ? '媒体上传处理中…'
      : !hasThreadMedia && !pendingReady
        ? '上传图片或视频，开始对话'
        : '请输入您的需求，支持图片分析、图片生成、视频分析'
  /** 发送仍须等上一轮结束，避免并发打断；输入与高级参数在思考中仍可编辑 */
  const canSend =
    !busy && (pendingReady || (!!input.trim() && hasThreadMedia))

  const lastUserWithMedia = useMemo(() => {
    if (!active?.messages.length) return null
    for (let i = active.messages.length - 1; i >= 0; i--) {
      const m = active.messages[i]
      if (m.role === 'user' && m.attachments?.length) return m
    }
    return null
  }, [active?.messages])

  const suggestTags =
    pendingReady || pendingUploads.some((p) => p.status === 'done')
      ? pendingUploads.find((p) => p.type === 'video')
        ? ['拆解视频脚本', '分析拍摄手法', '提取完整台词']
        : ['帮我分析这张图', '生成同款风格图片', '提取图中商品信息']
      : lastUserWithMedia?.attachments?.some((a) => a.type === 'video')
        ? ['拆解视频脚本', '分析拍摄手法', '提取完整台词']
        : ['帮我分析这张图', '生成同款风格图片', '提取图中商品信息']

  /** 已有正常助手回复时隐藏输入区标签，避免与气泡内快捷指令重复 */
  const hasNonBlockedAssistant =
    active?.messages.some((m) => m.role === 'assistant' && !m.blocked) ?? false
  const showSuggestTags =
    (pendingReady || !!lastUserWithMedia || pendingUploads.length > 0) && !hasNonBlockedAssistant

  const updateParams = (patch: Partial<HomeChatSession['params']>) => {
    if (!activeId) return
    setSessions((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, params: { ...s.params, ...patch }, updatedAt: Date.now() } : s)),
    )
  }

  const openPreview = (url: string, type: 'image' | 'video', title?: string, allUrls?: string[]) => {
    const urls = allUrls?.length ? allUrls : [url]
    const idx = Math.max(0, urls.indexOf(url))
    setPreview({ urls, index: idx, type, title, scale: 1 })
  }

  const onDropFiles = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dt = e.dataTransfer?.files
    if (!dt?.length) return
    void validateAndUploadFiles(dt)
  }

  const displayAssistantText = (m: HomeChatMsg) => {
    if (m.role !== 'assistant') return m.text
    const full = m.text
    const n = m.streamLen ?? full.length
    return full.slice(0, n)
  }

  return (
    <div className="home-chat-module-root flex h-[calc(100vh-6.75rem)] max-h-[calc(100vh-6.75rem)] gap-3 overflow-hidden">
      <div className="flex h-full min-w-0 flex-1 flex-col min-h-0">
        <div
          className="tikgen-panel relative flex flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(120%_80%_at_50%_0%,rgba(88,70,166,0.18)_0%,rgba(46,62,130,0.12)_28%,rgba(16,22,40,0.94)_62%,rgba(10,14,26,0.98)_100%)] shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          onDragEnter={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            if (e.currentTarget.contains(e.relatedTarget as Node)) return
            setDragOver(false)
          }}
          onDrop={onDropFiles}
        >
          {dragOver ? (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-violet-400/60 bg-gradient-to-br from-violet-500/20 via-fuchsia-500/12 to-transparent shadow-[inset_0_0_0_1px_rgba(167,139,250,0.25)] backdrop-blur-[3px]">
              <span className="text-sm font-medium text-violet-100/95 drop-shadow-sm">拖拽到此处上传</span>
            </div>
          ) : null}

          {showLanding ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 pt-6">
              <div className="mx-auto w-full max-w-3xl">
                <h1 className="text-center text-4xl font-semibold tracking-tight text-white">给你灵感，也给你爆款</h1>
              </div>
              <div className="mx-auto mt-8 w-full max-w-3xl">
                {!!toast && <div className="mb-2 text-sm text-amber-200/90">{toast}</div>}
                {!!error && <div className="mb-2 text-sm text-red-300">{error}</div>}
                <div
                  ref={composerRef}
                  className="home-chat-composer-inner group rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(14,20,38,0.82)_0%,rgba(10,14,28,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_22px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-[border-color,box-shadow,background] duration-200 hover:border-violet-400/30 hover:shadow-[0_0_0_1px_rgba(167,139,250,0.1)] focus-within:border-violet-400/30 focus-within:shadow-[0_0_0_1px_rgba(167,139,250,0.1)]"
                >
                  <HomeComposerPendingStrip
                    items={pendingUploads}
                    onRemove={removePending}
                    onRetry={retryPending}
                  />
                  <div className="flex items-end">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (canSend) void handleSend()
                        }
                      }}
                      placeholder={composerPlaceholder}
                      rows={1}
                      className="home-chat-composer-textarea min-h-[2.625rem] min-w-0 flex-1 resize-none overflow-y-auto !border-transparent !bg-transparent px-2 py-1 text-sm leading-relaxed outline-none !shadow-none ring-0 focus:!border-transparent focus:!shadow-none focus:ring-0"
                    />
                  </div>

                  <div className="mt-2 flex items-center gap-2 pt-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="relative shrink-0" ref={plusMenuRef}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPlusMenuOpen((v) => !v)
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/65 transition hover:bg-white/[0.06] hover:text-violet-100 active:scale-95 disabled:opacity-45"
                          title="上传"
                        >
                          <ImagePlus className="pointer-events-none h-[17px] w-[17px] stroke-[2]" />
                        </button>
                        {plusMenuOpen ? (
                          <div className="absolute bottom-full left-0 z-[60] mb-2 min-w-[11rem] overflow-hidden rounded-xl border border-white/14 bg-[#121522] shadow-xl [isolation:isolate]">
                            <button
                              type="button"
                              className="w-full px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.06]"
                              onClick={() => {
                                setPlusMenuOpen(false)
                                uploadInputRef.current?.click()
                              }}
                            >
                              从本地上传
                            </button>
                            <button
                              type="button"
                              className="w-full px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.06]"
                              onClick={() => openAssetPicker('both')}
                            >
                              从资产库选择
                            </button>
                          </div>
                        ) : null}
                        <input
                          ref={uploadInputRef}
                          type="file"
                          multiple
                          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                          className="hidden"
                          onChange={(e) => {
                            void validateAndUploadFiles(e.target.files)
                            e.target.value = ''
                          }}
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setPlusMenuOpen(false)
                          setParamsOpen((v) => !v)
                        }}
                        className={`inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs transition ${
                          paramsOpen
                            ? 'bg-violet-500/20 text-violet-100'
                            : 'text-white/65 hover:bg-white/[0.06] hover:text-violet-100'
                        }`}
                        title="高级设置"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        高级
                      </button>

                      <div className="min-w-0 flex-1 overflow-x-auto">
                        <div className="flex min-w-max items-center gap-2 pr-1 text-[11px] text-white/65">
                          <span>比例</span>
                          <select
                            className="tikgen-spec-select rounded-lg bg-black/35 px-2 py-1 text-white/90"
                            value={active?.params.aspectRatio || '3:4'}
                            onChange={(e) => updateParams({ aspectRatio: e.target.value as any })}
                          >
                            <option value="1:1">1:1</option>
                            <option value="3:4">3:4</option>
                            <option value="9:16">9:16</option>
                          </select>
                          <span className="text-white/25">·</span>
                          <span>张数</span>
                          <select
                            className="tikgen-spec-select rounded-lg bg-black/35 px-2 py-1 text-white/90"
                            value={active?.params.imageCount ?? 2}
                            onChange={(e) => updateParams({ imageCount: Number(e.target.value) as any })}
                          >
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={4}>4</option>
                          </select>
                          <span className="text-white/25">·</span>
                          <span>{active?.params.subjectLock === 'high' ? '高保真' : '标准保真'}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canSend}
                      onClick={() => void handleSend()}
                      className="shrink-0 rounded-xl bg-gradient-to-r from-fuchsia-500 via-violet-600 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(124,58,237,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100"
                    >
                      发送
                    </button>
                  </div>

                  {paramsOpen ? (
                    <div className="mt-2 p-1">
                      <div className="grid max-h-[36vh] grid-cols-1 gap-2 overflow-y-auto pr-1 text-sm sm:grid-cols-2 xl:grid-cols-4">
                        <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                          <span className="shrink-0 whitespace-nowrap">分辨率</span>
                          <select
                            className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                            value={active?.params.resolution || '2K'}
                            onChange={(e) => updateParams({ resolution: e.target.value as any })}
                          >
                            <option value="2K">2K</option>
                            <option value="4K">4K</option>
                            <option value="HD">HD</option>
                          </select>
                        </label>
                        <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                          <span className="shrink-0 whitespace-nowrap">风格</span>
                          <select
                            className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                            value={active?.params.style || '写实'}
                            onChange={(e) => updateParams({ style: e.target.value as any })}
                          >
                            <option value="写实">写实</option>
                            <option value="动漫">动漫</option>
                            <option value="国潮">国潮</option>
                            <option value="手绘">手绘</option>
                            <option value="赛博朋克">赛博朋克</option>
                            <option value="水墨">水墨</option>
                          </select>
                        </label>
                        <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                          <span className="shrink-0 whitespace-nowrap">主体保真</span>
                          <select
                            className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                            value={active?.params.subjectLock || 'high'}
                            onChange={(e) => updateParams({ subjectLock: e.target.value as any })}
                          >
                            <option value="high">高</option>
                            <option value="medium">中</option>
                          </select>
                        </label>
                        <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                          <span className="shrink-0 whitespace-nowrap" title="自动：根据你的话术与是否基于上一张成图推断">
                            改图方式
                          </span>
                          <select
                            className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                            value={active?.params.refinementIntent ?? 'auto'}
                            onChange={(e) =>
                              updateParams({ refinementIntent: e.target.value as 'auto' | 'iterative' | 'fresh' })
                            }
                          >
                            <option value="auto">自动推断</option>
                            <option value="iterative">上一版微调</option>
                            <option value="fresh">重新生成</option>
                          </select>
                        </label>
                        <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                          <span className="shrink-0 whitespace-nowrap tabular-nums">
                            参考权重 {active?.params.refWeight?.toFixed(2)}
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={active?.params.refWeight ?? 0.7}
                            onChange={(e) => updateParams({ refWeight: Number(e.target.value) })}
                            className="min-w-0 flex-1"
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 hidden grid sm:grid-cols-2 gap-2 text-xs text-white/80" aria-hidden>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={active?.params.syncToAssets !== false}
                      onChange={(e) => updateParams({ syncToAssets: e.target.checked })}
                    />
                    生成图片自动同步至资产库
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={active?.params.optimizePrompt !== false}
                      onChange={(e) => updateParams({ optimizePrompt: e.target.checked })}
                    />
                    自动优化提示词
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={active?.params.hdEnhance !== false}
                      onChange={(e) => updateParams({ hdEnhance: e.target.checked })}
                    />
                    开启高清细节增强
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={active?.params.negativePrompt !== false}
                      onChange={(e) => updateParams({ negativePrompt: e.target.checked })}
                    />
                    添加通用负面提示词
                  </label>
                </div>
              </div>

              <div className="mx-auto mt-6 w-full max-w-3xl">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {(
                    [
                      { id: 'imageGen' as const, label: 'AI生图', image: '/home-chat-cards/card-ai-image.png' },
                      { id: 'ecommerce' as const, label: '电商套图', image: '/home-chat-cards/card-ecommerce.png' },
                      { id: 'upscale' as const, label: '高清放大', image: '/home-chat-cards/card-upscale.png' },
                      { id: 'translate' as const, label: '图片翻译', image: '/home-chat-cards/card-translate.png' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigateToImageModule?.(item.id)}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/12 bg-white/[0.04] p-3 text-left transition hover:border-violet-400/35 hover:bg-white/[0.07]"
                    >
                      <span className="text-sm font-medium text-white/90">{item.label}</span>
                      <div
                        className="relative h-14 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-900/30"
                        aria-hidden
                      >
                        <img src={item.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
          <div ref={chatScrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5">

            <div className="space-y-5">
            {active?.messages.map((m) => (
              <div key={m.id}>
                <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'user' ? (
                    <UserBubble>
                      {m.attachments?.length ? (
                        <div className="mb-2 flex max-w-full gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15">
                          {m.attachments.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              className="relative h-24 w-28 shrink-0 snap-start overflow-hidden rounded-xl border border-white/15 bg-black/50 ring-1 ring-inset ring-white/10"
                              onClick={() =>
                                openPreview(
                                  a.url,
                                  a.type,
                                  a.name,
                                  a.type === 'image'
                                    ? m.attachments!.filter((x) => x.type === 'image').map((x) => x.url)
                                    : undefined,
                                )
                              }
                            >
                              {a.type === 'image' ? (
                                <img src={a.url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <video src={a.url} className="h-full w-full object-cover" muted playsInline />
                              )}
                              {a.fromAsset ? (
                                <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[10px] text-violet-200/95">
                                  资产库
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="home-chat-user-body whitespace-pre-wrap">{m.text}</div>
                      {m.sendParams ? (
                        <div className="home-chat-meta-row mt-2 text-[11px] leading-snug">
                          {m.sendParams.aspectRatio} · {m.sendParams.imageCount}张 ·{' '}
                          {m.sendParams.subjectLock === 'high' ? '高保真' : '标准保真'}
                        </div>
                      ) : null}
                    </UserBubble>
                  ) : (
                    <AssistantBubble>
                      {m.blocked ? (
                        <div className="home-chat-assistant-blocked whitespace-pre-wrap">
                          {displayAssistantText(m)}
                        </div>
                      ) : (
                        <>
                          {m.pendingAnalysis && !String(m.text || '').trim() ? (
                            <div className="home-chat-typing-row flex items-center gap-2.5">
                              <TypingDots />
                              <span className="text-sm">正在输出商用分析与卖点结构...</span>
                            </div>
                          ) : (
                            <div className="home-chat-assistant-body whitespace-pre-wrap">
                              {displayAssistantText(m)}
                            </div>
                          )}
                          {m.images?.length ? (
                            <div className="mt-3 flex max-w-full gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15">
                              {m.images.map((u, i) => {
                                const meta = m.imageItems?.[i]
                                return (
                                  <div key={i} className="flex w-24 shrink-0 snap-start flex-col gap-1">
                                    <button
                                      type="button"
                                      className="relative h-24 w-24 overflow-hidden rounded-xl border border-white/12 bg-black/40"
                                      onClick={() => openPreview(u, 'image', `生成 ${i + 1}`, m.images)}
                                    >
                                      <img src={u} alt="" className="h-full w-full object-cover" />
                                      {meta?.ratio || meta?.variant || Number.isFinite(meta?.qcScore) ? (
                                        <span className="home-chat-thumb-caption absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px]">
                                          {[
                                            meta?.ratio,
                                            meta?.variant && meta.variant !== 'normal' ? meta.variant : '',
                                            Number.isFinite(meta?.qcScore) ? `QC ${meta!.qcScore}` : '',
                                          ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                        </span>
                                      ) : null}
                                    </button>
                                    <HomeGeneratedImageActions
                                      imageUrl={u}
                                      index={i}
                                      sessionId={active?.id || ''}
                                      messageId={m.id}
                                      onFeedbackRecorded={(sat, ok) => {
                                        if (ok) {
                                          setToast(
                                            sat
                                              ? '已记录：满意，感谢反馈'
                                              : '已记录：不满意，我们会继续改进',
                                          )
                                        } else {
                                          setToast('反馈提交失败，请检查登录或稍后重试')
                                        }
                                        window.setTimeout(() => setToast(''), 3800)
                                      }}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                          {!m.pendingAnalysis && m.followUps?.length ? (
                            <div className="home-chat-followup-row mt-3 border-t border-white/10 pt-3">
                              <div className="home-chat-chip-label mb-1.5 text-[10px] font-medium uppercase tracking-wide">
                                快捷指令
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {m.followUps.map((t, i) => {
                                  const primary = i < 2
                                  return (
                                    <button
                                      key={`${t}-${i}`}
                                      type="button"
                                      className={
                                        primary
                                          ? 'rounded-lg border border-white/22 bg-white/[0.08] px-3 py-1.5 text-xs font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition hover:border-white/32 hover:bg-white/[0.12]'
                                          : 'rounded-lg border border-white/12 bg-white/[0.05] px-2.5 py-1.5 text-[11px] transition hover:border-white/20 hover:bg-white/[0.08]'
                                      }
                                      onClick={() => {
                                        if (t === '确认高清生成') {
                                          setInput('确认高清生成')
                                          window.setTimeout(() => void handleSend(), 0)
                                          return
                                        }
                                        setInput(t)
                                      }}
                                    >
                                      {t}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </AssistantBubble>
                  )}
                </div>
              </div>
            ))}

            {showSuggestTags ? (
              <div className="home-chat-suggest-row flex flex-wrap justify-end gap-2">
                {suggestTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="rounded-lg border border-white/20 bg-white/[0.06] px-3 py-1.5 text-xs transition hover:border-white/30 hover:bg-white/[0.1]"
                    onClick={() => setInput(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}

            {busy && busyStage !== 'analyze' ? (
              <div className="flex justify-start">
                <AssistantBubble>
                  <div className="home-chat-busy-row flex items-center gap-2.5">
                    <TypingDots />
                    <span className="text-sm">
                      {busyStage === 'identify'
                        ? '正在识别商品特征…'
                        : busyStage === 'optimize'
                          ? '正在优化出图提示词…'
                          : busyStage === 'generate'
                            ? '正在调用模型生成商品图…'
                            : 'AI 正在处理…'}
                    </span>
                  </div>
                </AssistantBubble>
              </div>
            ) : null}
            <div ref={listEndRef} />
          </div>
        </div>

        <div className="shrink-0 bg-transparent px-4 pb-3 pt-2.5">
          {!!toast && <div className="mb-2 text-sm text-amber-200/90">{toast}</div>}
          {!!error && <div className="mb-2 text-sm text-red-300">{error}</div>}

          <div
            ref={composerRef}
            className="home-chat-composer-inner group rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(14,20,38,0.82)_0%,rgba(10,14,28,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_22px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-[border-color,box-shadow,background] duration-200 hover:border-violet-400/30 hover:shadow-[0_0_0_1px_rgba(167,139,250,0.1)] focus-within:border-violet-400/30 focus-within:shadow-[0_0_0_1px_rgba(167,139,250,0.1)]"
          >
            <HomeComposerPendingStrip
              items={pendingUploads}
              onRemove={removePending}
              onRetry={retryPending}
            />
            <div className="flex items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (canSend) void handleSend()
                  }
                }}
                placeholder={composerPlaceholder}
                rows={1}
                className="home-chat-composer-textarea min-h-[2.625rem] min-w-0 flex-1 resize-none overflow-y-auto !border-transparent !bg-transparent px-2 py-1 text-sm leading-relaxed outline-none !shadow-none ring-0 focus:!border-transparent focus:!shadow-none focus:ring-0"
              />
            </div>

            <div className="mt-2 flex items-center gap-2 pt-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative shrink-0" ref={plusMenuRef}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPlusMenuOpen((v) => !v)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/65 transition hover:bg-white/[0.06] hover:text-violet-100 active:scale-95 disabled:opacity-45"
                  title="上传"
                >
                  <ImagePlus className="pointer-events-none h-[17px] w-[17px] stroke-[2]" />
                </button>
                {plusMenuOpen ? (
                  <div className="absolute bottom-full left-0 z-[60] mb-2 min-w-[11rem] overflow-hidden rounded-xl border border-white/14 bg-[#121522] shadow-xl [isolation:isolate]">
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.06]"
                      onClick={() => {
                        setPlusMenuOpen(false)
                        uploadInputRef.current?.click()
                      }}
                    >
                      从本地上传
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.06]"
                      onClick={() => openAssetPicker('both')}
                    >
                      从资产库选择
                    </button>
                  </div>
                ) : null}
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  className="hidden"
                  onChange={(e) => {
                    void validateAndUploadFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setPlusMenuOpen(false)
                  setParamsOpen((v) => !v)
                }}
                className={`inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs transition ${
                  paramsOpen
                    ? 'bg-violet-500/20 text-violet-100'
                    : 'text-white/65 hover:bg-white/[0.06] hover:text-violet-100'
                }`}
                title="高级设置"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                高级
              </button>

              <div className="min-w-0 flex-1 overflow-x-auto">
                <div className="flex min-w-max items-center gap-2 pr-1 text-[11px] text-white/65">
                  <span>比例</span>
                  <select
                    className="tikgen-spec-select rounded-lg bg-black/35 px-2 py-1 text-white/90"
                    value={active?.params.aspectRatio || '3:4'}
                    onChange={(e) => updateParams({ aspectRatio: e.target.value as any })}
                  >
                    <option value="1:1">1:1</option>
                    <option value="3:4">3:4</option>
                    <option value="9:16">9:16</option>
                  </select>
                  <span className="text-white/25">·</span>
                  <span>张数</span>
                  <select
                    className="tikgen-spec-select rounded-lg bg-black/35 px-2 py-1 text-white/90"
                    value={active?.params.imageCount ?? 2}
                    onChange={(e) => updateParams({ imageCount: Number(e.target.value) as any })}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                  </select>
                  <span className="text-white/25">·</span>
                  <span>{active?.params.subjectLock === 'high' ? '高保真' : '标准保真'}</span>
                </div>
              </div>
              </div>
              <button
                type="button"
                disabled={!canSend}
                onClick={() => void handleSend()}
                className="shrink-0 rounded-xl bg-gradient-to-r from-fuchsia-500 via-violet-600 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(124,58,237,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100"
              >
                发送
              </button>
            </div>

            {paramsOpen ? (
              <div className="mt-2 p-1">
                <div className="grid max-h-[36vh] grid-cols-1 gap-2 overflow-y-auto pr-1 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                    <span className="shrink-0 whitespace-nowrap">分辨率</span>
                    <select
                      className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                      value={active?.params.resolution || '2K'}
                      onChange={(e) => updateParams({ resolution: e.target.value as any })}
                    >
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                      <option value="HD">HD</option>
                    </select>
                  </label>
                  <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                    <span className="shrink-0 whitespace-nowrap">风格</span>
                    <select
                      className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                      value={active?.params.style || '写实'}
                      onChange={(e) => updateParams({ style: e.target.value as any })}
                    >
                      <option value="写实">写实</option>
                      <option value="动漫">动漫</option>
                      <option value="国潮">国潮</option>
                      <option value="手绘">手绘</option>
                      <option value="赛博朋克">赛博朋克</option>
                      <option value="水墨">水墨</option>
                    </select>
                  </label>
                  <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                    <span className="shrink-0 whitespace-nowrap">主体保真</span>
                    <select
                      className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                      value={active?.params.subjectLock || 'high'}
                      onChange={(e) => updateParams({ subjectLock: e.target.value as any })}
                    >
                      <option value="high">高</option>
                      <option value="medium">中</option>
                    </select>
                  </label>
                  <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                    <span className="shrink-0 whitespace-nowrap" title="自动：根据你的话术与是否基于上一张成图推断">
                      改图方式
                    </span>
                    <select
                      className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                      value={active?.params.refinementIntent ?? 'auto'}
                      onChange={(e) =>
                        updateParams({ refinementIntent: e.target.value as 'auto' | 'iterative' | 'fresh' })
                      }
                    >
                      <option value="auto">自动推断</option>
                      <option value="iterative">上一版微调</option>
                      <option value="fresh">重新生成</option>
                    </select>
                  </label>
                  <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                    <span className="shrink-0 whitespace-nowrap tabular-nums">
                      参考权重 {active?.params.refWeight?.toFixed(2)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={active?.params.refWeight ?? 0.7}
                      onChange={(e) => updateParams({ refWeight: Number(e.target.value) })}
                      className="min-w-0 flex-1"
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </div>
          <div className="mt-3 hidden grid sm:grid-cols-2 gap-2 text-xs text-white/80" aria-hidden>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.syncToAssets !== false}
                onChange={(e) => updateParams({ syncToAssets: e.target.checked })}
              />
              生成图片自动同步至资产库
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.optimizePrompt !== false}
                onChange={(e) => updateParams({ optimizePrompt: e.target.checked })}
              />
              自动优化提示词
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.hdEnhance !== false}
                onChange={(e) => updateParams({ hdEnhance: e.target.checked })}
              />
              开启高清细节增强
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.negativePrompt !== false}
                onChange={(e) => updateParams({ negativePrompt: e.target.checked })}
              />
              添加通用负面提示词
            </label>
          </div>
        </div>
            </>
          )}
      </div>
    </div>

      <aside
        className={`sticky top-[7.5rem] flex h-[calc(100vh-6.75rem)] shrink-0 flex-col rounded-2xl border border-white/10 bg-[linear-gradient(180deg,#10121a_0%,#0a0c12_100%)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-[width,padding] duration-200 ${
          sidebarCollapsed ? 'w-[58px] px-2 py-3' : 'w-[292px]'
        }`}
      >
        {sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="mb-2 inline-flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-lg border border-white/12 bg-white/[0.04] text-white/75 transition hover:border-violet-400/35 hover:text-violet-200"
            title="展开历史对话"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-white/[0.04] text-white/75 transition hover:border-violet-400/35 hover:text-violet-200"
                title="收起历史对话"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={newChat}
                className="relative flex-1 shrink-0 rounded-xl bg-gradient-to-r from-fuchsia-500 via-violet-600 to-indigo-600 py-2.5 text-sm font-semibold text-white shadow-[0_6px_22px_rgba(124,58,237,0.28)] transition hover:brightness-110"
              >
                <Plus className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
                <span className="block text-center">新建对话</span>
              </button>
            </div>
            <div className="mb-2 text-sm font-semibold text-white/90">历史对话</div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {filteredSessions.length === 0 ? (
                <div className="py-8 text-center text-xs text-white/40">暂无历史对话，点击「新建对话」开始创作</div>
              ) : (
                filteredSessions.map((s) => (
                  <div
                    key={s.id}
                    className={`cursor-pointer rounded-2xl border p-3 backdrop-blur-md transition ${
                      s.id === activeId
                        ? 'border-violet-400/45 bg-gradient-to-br from-violet-900/35 via-[#1a1d28]/90 to-[#14161f]/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                        : 'border-white/10 bg-gradient-to-br from-[#1a1d28]/75 via-[#14161f]/80 to-[#10121a]/85 hover:border-violet-400/35 hover:bg-gradient-to-br hover:from-violet-900/25 hover:via-[#1a1d28]/90 hover:to-[#14161f]/95'
                    }`}
                    onClick={() => setActiveId(s.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white/90">{s.title}</div>
                        <div className="mt-1 text-[11px] text-white/40">{new Date(s.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          className="rounded p-1.5 text-white/70 transition hover:text-violet-300"
                          title="置顶"
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePin(s.id)
                          }}
                        >
                          <Pin className={`h-3.5 w-3.5 ${s.pinned ? 'text-amber-200' : ''}`} />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1.5 text-white/70 transition hover:text-violet-300"
                          title="重命名"
                          onClick={(e) => {
                            e.stopPropagation()
                            renameSession(s.id)
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1.5 text-white/70 transition hover:text-violet-300"
                          title="删除"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteSession(s.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={clearAll}
              className="mt-3 shrink-0 rounded-xl border border-white/12 py-2 text-sm text-white/70 transition hover:border-white/18 hover:bg-white/[0.04]"
            >
              清空全部历史
            </button>
          </>
        )}
      </aside>

      {showAssetPicker ? (
        <div className="fixed inset-0 z-[80] bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[88vh] overflow-hidden bg-white rounded-2xl border shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">从资产库选择</div>
                <p className="text-xs text-gray-500 mt-1">
                  点击缩略图多选，与本地多选共享队列上限（最多 {MAX_HOME_CHAT_UPLOAD_QUEUE} 个）
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAssetPicker(false)
                  setAssetPickerSelectedIds(new Set())
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-3 border-b flex gap-2">
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm border ${assetTab === 'user_upload' ? 'bg-gray-900 text-white' : ''}`}
                onClick={() => {
                  setAssetTab('user_upload')
                  setAssetPickerSelectedIds(new Set())
                }}
              >
                本地上传
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm border ${assetTab === 'ai_generated' ? 'bg-gray-900 text-white' : ''}`}
                onClick={() => {
                  setAssetTab('ai_generated')
                  setAssetPickerSelectedIds(new Set())
                }}
              >
                AI 生成
              </button>
            </div>
            <div className="p-5 overflow-auto flex-1">
              {assetBusy ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                  {assetList.map((a) => {
                    const selected = assetPickerSelectedIds.has(a.id)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAssetPickerItem(a)}
                        className={`relative rounded-xl border overflow-hidden text-left transition ${
                          selected
                            ? 'border-violet-500 ring-2 ring-violet-400/50 shadow-md'
                            : 'border-gray-200 hover:border-violet-400'
                        }`}
                      >
                        {selected ? (
                          <span className="absolute right-2 top-2 z-[1] flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-white shadow">
                            <Check className="h-3.5 w-3.5 stroke-[3]" />
                          </span>
                        ) : null}
                        {a.type === 'image' ? (
                          <img src={a.url} alt="" className="w-full h-28 object-cover bg-black" />
                        ) : (
                          <video src={a.url} className="w-full h-28 object-cover bg-black" muted playsInline />
                        )}
                        <div className="p-2 text-xs text-gray-700 truncate">{a.name || a.type}</div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-600">
                已选 <span className="font-medium text-gray-900">{assetPickerSelectedIds.size}</span> 项
                <span className="text-gray-500">
                  {' '}
                  · 还可加入队列{' '}
                  {Math.max(0, MAX_HOME_CHAT_UPLOAD_QUEUE - pendingUploads.length)} 个（共不超过{' '}
                  {MAX_HOME_CHAT_UPLOAD_QUEUE} 个）
                </span>
              </p>
              <div className="flex items-center gap-2 justify-end shrink-0">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm border border-gray-200 bg-white hover:bg-gray-50"
                  onClick={() => {
                    setShowAssetPicker(false)
                    setAssetPickerSelectedIds(new Set())
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={assetPickerSelectedIds.size === 0}
                  className="px-4 py-2 rounded-lg text-sm bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => void confirmAssetPickerSelection()}
                >
                  添加选中
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div
          className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div className="max-w-5xl w-full max-h-[92vh] relative flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div className="text-xs text-white/70 truncate">{preview.title}</div>
              <div className="flex items-center gap-2 flex-wrap">
                {preview.type === 'image' && preview.urls.length > 1 ? (
                  <>
                    <button
                      type="button"
                      className="text-white/80 p-1.5 rounded-lg hover:bg-white/10"
                      onClick={() => setPreview((p) => (p ? { ...p, index: (p.index + p.urls.length - 1) % p.urls.length } : p))}
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      className="text-white/80 p-1.5 rounded-lg hover:bg-white/10"
                      onClick={() => setPreview((p) => (p ? { ...p, index: (p.index + 1) % p.urls.length } : p))}
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                ) : null}
                {preview.type === 'image' ? (
                  <>
                    <button
                      type="button"
                      className="text-white/80 p-1.5 rounded-lg hover:bg-white/10"
                      onClick={() => setPreview((p) => (p ? { ...p, scale: Math.min(3, p.scale + 0.25) } : p))}
                    >
                      <ZoomIn className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      className="text-white/80 p-1.5 rounded-lg hover:bg-white/10"
                      onClick={() => setPreview((p) => (p ? { ...p, scale: Math.max(0.5, p.scale - 0.25) } : p))}
                    >
                      <ZoomOut className="w-5 h-5" />
                    </button>
                  </>
                ) : null}
                <a
                  href={preview.urls[preview.index]}
                  download
                  className="inline-flex items-center gap-1 text-xs text-white/85 px-2 py-1.5 rounded-lg border border-white/15 hover:bg-white/10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="w-4 h-4" /> 下载
                </a>
                {preview.type === 'image' ? (
                  <button
                    type="button"
                    className="text-xs text-white/85 px-2 py-1.5 rounded-lg border border-white/15 hover:bg-white/10"
                    onClick={async () => {
                      const u = preview.urls[preview.index]
                      try {
                        await createAssetAPI({
                          source: 'user_upload',
                          type: 'image',
                          url: u,
                          name: preview.title || 'image.png',
                          metadata: { from: 'home_chat_preview_save' },
                        })
                        alert('已存入资产库')
                      } catch (e: any) {
                        alert(e?.message || '存入失败')
                      }
                    }}
                  >
                    存入资产库
                  </button>
                ) : null}
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20"
                  onClick={() => setPreview(null)}
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto rounded-xl bg-black/50 flex items-center justify-center min-h-[200px]">
              {preview.type === 'image' ? (
                <img
                  src={preview.urls[preview.index]}
                  alt=""
                  style={{ transform: `scale(${preview.scale})` }}
                  className="max-h-[78vh] max-w-full object-contain transition-transform duration-150"
                />
              ) : (
                <video
                  src={preview.urls[preview.index]}
                  className="w-full max-h-[78vh] rounded-xl bg-black"
                  controls
                  autoPlay
                  playsInline
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
