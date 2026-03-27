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
  ChevronLeft,
  ChevronRight,
  Download,
  Folder,
  ImagePlus,
  Pencil,
  Pin,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { createAssetAPI, listAssetsAPI, type AssetItem } from './api/assets'
import { homeChatTurnAPI } from './api/homeChat'
import { archiveAiMediaOnce } from './utils/archiveAiMediaOnce'

const STORAGE_KEY = 'tikgen.homeChat.sessions.v1'
const ACTIVE_KEY = 'tikgen.homeChat.activeId.v1'
const MAX_SESSIONS = 100
const MAX_STORED_MESSAGES = 200
const API_HISTORY_MAX = 40
const DEFAULT_SEND_TEXT = '请结合上传的媒体回答我的问题。'

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
  blocked?: boolean
  followUps?: string[]
  /** 展示用：流式已显示长度（仅最后一条助手消息可能使用） */
  streamLen?: number
}

export type HomeChatSession = {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  pinned?: boolean
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
    aspectRatio: '1:1' | '16:9' | '9:16' | '4:3'
    style: '写实' | '动漫' | '国潮' | '手绘' | '赛博朋克' | '水墨'
    refWeight: number
    syncToAssets: boolean
    optimizePrompt: boolean
    hdEnhance: boolean
    negativePrompt: boolean
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

const defaultParams = (): HomeChatSession['params'] => ({
  resolution: '2K',
  aspectRatio: '1:1',
  style: '写实',
  refWeight: 0.7,
  syncToAssets: true,
  optimizePrompt: true,
  hdEnhance: true,
  negativePrompt: true,
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

function UserBubble({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`max-w-[min(85%,40rem)] rounded-3xl border border-white/12 bg-gradient-to-br from-violet-900/55 via-purple-900/45 to-fuchsia-900/40 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_32px_rgba(0,0,0,0.35)] px-4 py-3 text-sm leading-relaxed text-white/95 transition duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_12px_40px_rgba(139,92,246,0.18)] ${className}`}
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
    <div className={`max-w-[min(85%,40rem)] px-1 py-1 text-sm leading-relaxed text-white/92 ${className}`}>
      {children}
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
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [assetTab, setAssetTab] = useState<'user_upload' | 'ai_generated'>('user_upload')
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetList, setAssetList] = useState<AssetItem[]>([])
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

  /** 新建对话且尚未上传/发送：展示「AI创作」标题 + 上移输入区 + 功能卡片 */
  const showLanding =
    !!active && active.messages.length === 0 && !pendingUploads.length && !busy

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
    setShowAssetPicker(true)
    setPlusMenuOpen(false)
  }

  const pickAsset = (a: AssetItem) => {
    const id =
      typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
        ? globalThis.crypto.randomUUID()
        : `p_${Date.now()}`
    setPendingUploads((prev) => [
      ...prev,
      {
        id,
        status: 'done',
        progress: 100,
        name: a.name || (a.type === 'video' ? '视频' : '图片'),
        sizeLabel: '',
        type: a.type,
        url: a.url,
        fromAsset: true,
      },
    ])
    setShowAssetPicker(false)
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

  const validateAndUploadFile = async (file: File | null) => {
    if (!file) return
    setError('')
    const mime = String(file.type || '').toLowerCase()
    const isImg = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp'
    const isVid = mime === 'video/mp4' || mime === 'video/quicktime'
    if (!isImg && !isVid) {
      setError('仅支持 JPG/PNG/WebP 图片或 MP4/MOV 视频')
      return
    }
    if (isImg && file.size > 20 * 1024 * 1024) {
      setError('图片单文件需 ≤ 20MB')
      return
    }
    if (isVid) {
      if (file.size > 500 * 1024 * 1024) {
        setError('视频单文件需 ≤ 500MB')
        return
      }
      try {
        const dur = await getVideoDurationSec(file)
        if (dur > 600) {
          setError('视频时长需 ≤ 10 分钟')
          return
        }
      } catch {
        setError('无法读取视频时长，请换一段视频重试')
        return
      }
    }
    const pid =
      typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
        ? globalThis.crypto.randomUUID()
        : `p_${Date.now()}`
    setPendingUploads((prev) => [
      ...prev,
      {
        id: pid,
        status: 'uploading',
        progress: 5,
        name: file.name,
        sizeLabel: formatBytes(file.size),
        type: isVid ? 'video' : 'image',
      },
    ])
    const stopProg = simulateProgress(pid)
    try {
      const dataUrl = await fileToDataUrl(file)
      const kind: 'image' | 'video' = isVid ? 'video' : 'image'
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
    if (!pendingDone.length && !trimmed) {
      setError('请输入有效内容，或上传图片/视频')
      return
    }
    if (!pendingDone.length && trimmed && !hasThreadMedia) {
      setError('请先上传图片或视频，再发起对话')
      return
    }
    const sendText = trimmed || DEFAULT_SEND_TEXT

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
    }

    const paramLine = `【${s.params.resolution} · ${s.params.aspectRatio} · ${s.params.style} · 参考权重 ${s.params.refWeight.toFixed(2)}】`

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
    setError('')
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    hist = [...hist, { role: 'user' as const, text: `[附件] ${sendText}` }]

    try {
      const data = await homeChatTurnAPI({
        mediaType: primary.type,
        mediaUrl: primary.url,
        userMessage: `${paramLine}\n${sendText}`,
        history: hist.slice(-API_HISTORY_MAX),
        params: {
          resolution: s.params.resolution,
          aspectRatio: s.params.aspectRatio,
          style: s.params.style,
          refWeight: s.params.refWeight,
          optimizePrompt: s.params.optimizePrompt,
          hdEnhance: s.params.hdEnhance,
          negativePrompt: s.params.negativePrompt,
        },
      })

      if (!data?.success) {
        const code = String(data?.code || '')
        const msg = String(data?.error || '请求失败')
        if (code === 'QUOTA_EXHAUSTED' || /额度|用尽/.test(msg)) onGoBenefits()
        if (code === 'PAYMENT_REQUIRED' || /付费|订单/.test(msg)) onGoBenefits()
        const am: HomeChatMsg = {
          id: `m_${Date.now()}_e`,
          role: 'assistant',
          text: msg,
          blocked: true,
        }
        setSessions((prev) =>
          prev.map((x) =>
            x.id === activeId ? { ...x, updatedAt: Date.now(), messages: [...x.messages, am] } : x,
          ),
        )
        return
      }

      if (data.kind === 'blocked') {
        const am: HomeChatMsg = {
          id: `m_${Date.now()}_a`,
          role: 'assistant',
          text: String(data.message || ''),
          blocked: true,
        }
        setSessions((prev) =>
          prev.map((x) =>
            x.id === activeId ? { ...x, updatedAt: Date.now(), messages: [...x.messages, am] } : x,
          ),
        )
        return
      }

      if (data.kind === 'analysis' || data.kind === 'mixed') {
        const parts: string[] = []
        if (data.analysisText) parts.push(String(data.analysisText))
        if (data.optimizedPrompt) parts.push(`【优化后提示词】\n${String(data.optimizedPrompt)}`)
        const assistantText = parts.filter(Boolean).join('\n\n') || '（无文本回复）'
        const imgs: string[] = Array.isArray(data.imageUrls) ? data.imageUrls.filter(Boolean) : []
        const am: HomeChatMsg = {
          id: `m_${Date.now()}_a`,
          role: 'assistant',
          text: assistantText,
          images: imgs.length ? imgs : undefined,
          followUps: ASSISTANT_FOLLOWUPS,
          streamLen: 0,
        }
        setSessions((prev) =>
          prev.map((x) => {
            if (x.id !== activeId) return x
            return { ...x, updatedAt: Date.now(), messages: [...x.messages, am] }
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
      if (e?.name === 'AbortError') return
      const am: HomeChatMsg = {
        id: `m_${Date.now()}_err`,
        role: 'assistant',
        text: `请求失败：${e?.message || '未知错误'}`,
        blocked: true,
      }
      setSessions((prev) =>
        prev.map((x) =>
          x.id === activeId ? { ...x, updatedAt: Date.now(), messages: [...x.messages, am] } : x,
        ),
      )
    } finally {
      setBusy(false)
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
  const canSend =
    !busy && (pendingReady || (!!input.trim() && hasThreadMedia))

  const inputDisabled = busy
  const paramsDisabled = busy

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

  const showSuggestTags =
    (pendingReady || !!lastUserWithMedia || pendingUploads.length > 0) && !busy

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
    const f = e.dataTransfer?.files?.[0]
    void validateAndUploadFile(f || null)
  }

  const displayAssistantText = (m: HomeChatMsg) => {
    if (m.role !== 'assistant') return m.text
    const full = m.text
    const n = m.streamLen ?? full.length
    return full.slice(0, n)
  }

  return (
    <div className="flex h-[calc(100vh-6.75rem)] max-h-[calc(100vh-6.75rem)] gap-3 overflow-hidden">
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
                <h1 className="text-center text-2xl font-semibold tracking-tight text-white">AI创作</h1>
                <p className="mt-2 text-center text-sm text-white/40">让创作随灵感而生</p>
              </div>
              <div className="mx-auto mt-6 w-full max-w-3xl">
                {!!toast && <div className="mb-2 text-sm text-amber-200/90">{toast}</div>}
                {!!error && <div className="mb-2 text-sm text-red-300">{error}</div>}
                <div
                  ref={composerRef}
                  className="group rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(14,20,38,0.82)_0%,rgba(10,14,28,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_22px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-[border-color,box-shadow,background] duration-200 hover:border-violet-400/30 hover:shadow-[0_0_0_1px_rgba(167,139,250,0.1)] focus-within:border-violet-400/30 focus-within:shadow-[0_0_0_1px_rgba(167,139,250,0.1)]"
                >
                  <div className="flex items-end">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      disabled={inputDisabled}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (canSend) void handleSend()
                        }
                      }}
                      placeholder={
                        !hasThreadMedia && !pendingReady
                          ? '上传图片或视频，开始对话'
                          : '请输入您的需求，支持图片分析、图片生成、视频分析'
                      }
                      rows={1}
                      className="home-chat-composer-textarea min-h-[2.625rem] min-w-0 flex-1 resize-none overflow-y-auto !border-transparent !bg-transparent px-2 py-1 text-sm leading-relaxed text-white/90 outline-none !shadow-none ring-0 placeholder:text-white/28 focus:!border-transparent focus:!shadow-none focus:ring-0 disabled:opacity-45"
                    />
                  </div>

                  <div className="mt-2 flex items-center gap-2 pt-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="relative shrink-0" ref={plusMenuRef}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation()
                            setParamsOpen(true)
                            setPlusMenuOpen((v) => !v)
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/65 transition hover:bg-white/[0.06] hover:text-violet-100 active:scale-95 disabled:opacity-45"
                          title="上传"
                        >
                          <ImagePlus className="pointer-events-none h-[17px] w-[17px] stroke-[2]" />
                        </button>
                        {plusMenuOpen ? (
                          <div className="absolute bottom-full left-0 z-[60] mb-2 min-w-[11rem] rounded-xl border border-white/14 bg-[#121522] py-1.5 shadow-xl">
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-white/[0.06]"
                              onClick={() => {
                                setPlusMenuOpen(false)
                                uploadInputRef.current?.click()
                              }}
                            >
                              从本地上传
                            </button>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-white/[0.06]"
                              onClick={() => openAssetPicker('both')}
                            >
                              从资产库选择
                            </button>
                          </div>
                        ) : null}
                        <input
                          ref={uploadInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                          className="hidden"
                          onChange={(e) => void validateAndUploadFile(e.target.files?.[0] || null)}
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
                        title="参数设置"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        参数
                      </button>

                      <div className="min-w-0 flex-1 overflow-x-auto">
                        <div className="flex min-w-max items-center gap-2 pr-1 text-[11px] text-white/65">
                          <span>{active?.params.resolution || '2K'}</span>
                          <span className="text-white/25">/</span>
                          <span>{active?.params.aspectRatio || '1:1'}</span>
                          <span className="text-white/25">/</span>
                          <span>{active?.params.style || '写实'}</span>
                          <span className="text-white/25">/</span>
                          <span>参考权重 {active?.params.refWeight?.toFixed(2)}</span>
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
                            disabled={paramsDisabled}
                            onChange={(e) => updateParams({ resolution: e.target.value as any })}
                          >
                            <option value="2K">2K</option>
                            <option value="4K">4K</option>
                            <option value="HD">HD</option>
                          </select>
                        </label>
                        <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                          <span className="shrink-0 whitespace-nowrap">比例</span>
                          <select
                            className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                            value={active?.params.aspectRatio || '1:1'}
                            disabled={paramsDisabled}
                            onChange={(e) => updateParams({ aspectRatio: e.target.value as any })}
                          >
                            <option value="1:1">1:1</option>
                            <option value="16:9">16:9</option>
                            <option value="9:16">9:16</option>
                            <option value="4:3">4:3</option>
                          </select>
                        </label>
                        <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                          <span className="shrink-0 whitespace-nowrap">风格</span>
                          <select
                            className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                            value={active?.params.style || '写实'}
                            disabled={paramsDisabled}
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
                          <span className="shrink-0 whitespace-nowrap tabular-nums">
                            参考权重 {active?.params.refWeight?.toFixed(2)}
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={active?.params.refWeight ?? 0.7}
                            disabled={paramsDisabled}
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
                      disabled={paramsDisabled}
                      onChange={(e) => updateParams({ syncToAssets: e.target.checked })}
                    />
                    生成图片自动同步至资产库
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={active?.params.optimizePrompt !== false}
                      disabled={paramsDisabled}
                      onChange={(e) => updateParams({ optimizePrompt: e.target.checked })}
                    />
                    自动优化提示词
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={active?.params.hdEnhance !== false}
                      disabled={paramsDisabled}
                      onChange={(e) => updateParams({ hdEnhance: e.target.checked })}
                    />
                    开启高清细节增强
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={active?.params.negativePrompt !== false}
                      disabled={paramsDisabled}
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
                      { id: 'imageGen' as const, label: 'AI生图' },
                      { id: 'ecommerce' as const, label: '电商套图' },
                      { id: 'upscale' as const, label: '高清放大' },
                      { id: 'translate' as const, label: '图片翻译' },
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
                        className="relative h-14 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-slate-600/40 to-slate-900/50"
                        aria-hidden
                      >
                        <Sparkles className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-white/25" />
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
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      {active ? (
                        <div className="mt-2 text-[11px] leading-snug text-zinc-400/95">
                          {active.params.resolution} · {active.params.aspectRatio} · {active.params.style} · 参考权重{' '}
                          {active.params.refWeight.toFixed(2)}
                        </div>
                      ) : null}
                    </UserBubble>
                  ) : (
                    <AssistantBubble>
                      {m.blocked ? (
                        <div className="whitespace-pre-wrap text-amber-100/95">{displayAssistantText(m)}</div>
                      ) : (
                        <>
                          <div className="whitespace-pre-wrap">{displayAssistantText(m)}</div>
                          {m.images?.length ? (
                            <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15">
                              {m.images.map((u, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  className="relative h-24 w-24 shrink-0 snap-start overflow-hidden rounded-xl border border-white/12 bg-black/40"
                                  onClick={() => openPreview(u, 'image', `生成 ${i + 1}`, m.images)}
                                >
                                  <img src={u} alt="" className="h-full w-full object-cover" />
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {m.followUps?.length ? (
                            <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                              {m.followUps.map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  className="rounded-lg border border-violet-400/30 bg-violet-500/12 px-3 py-1.5 text-xs text-violet-100/90 transition hover:border-violet-400/50 hover:bg-violet-500/20 hover:text-white"
                                  onClick={() => setInput(t)}
                                >
                                  {t}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )}
                    </AssistantBubble>
                  )}
                </div>
              </div>
            ))}

            {pendingUploads.length > 0 ? (
              <div className="flex flex-col items-end gap-2">
                {pendingUploads.map((p) => (
                  <UserBubble key={p.id}>
                    <div className="flex items-start gap-3">
                      <div className="w-24 h-20 rounded-xl border border-white/12 bg-black/40 overflow-hidden flex items-center justify-center shrink-0">
                        {p.status === 'done' && p.url ? (
                          p.type === 'image' ? (
                            <img src={p.url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <video src={p.url} className="h-full w-full object-cover" muted playsInline />
                          )
                        ) : (
                          <Upload className="h-7 w-7 text-white/35" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        <div className="text-[11px] text-white/40">{p.sizeLabel}</div>
                        {p.status === 'uploading' ? (
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 transition-[width]"
                              style={{ width: `${p.progress}%` }}
                            />
                          </div>
                        ) : null}
                        {p.status === 'error' ? (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-start gap-2 text-xs text-red-300/95">
                              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400/95" aria-hidden />
                              <span>{p.error}</span>
                            </div>
                            <button
                              type="button"
                              className="rounded-lg border border-red-400/35 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-100/95 transition hover:bg-red-500/18"
                              onClick={() => retryPending(p.id)}
                            >
                              重新上传
                            </button>
                          </div>
                        ) : null}
                        {p.status === 'done' ? (
                          <button
                            type="button"
                            className="mt-2 text-[11px] text-white/45 hover:text-white/70"
                            onClick={() => removePending(p.id)}
                          >
                            移除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </UserBubble>
                ))}
              </div>
            ) : null}

            {showSuggestTags ? (
              <div className="flex flex-wrap justify-end gap-2">
                {suggestTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="rounded-lg border border-violet-400/30 bg-violet-500/12 px-3 py-1.5 text-xs text-violet-100/90 transition hover:border-violet-400/50 hover:bg-violet-500/20 hover:text-white"
                    onClick={() => setInput(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}

            {busy ? (
              <div className="flex justify-start">
                <AssistantBubble>
                  <div className="flex items-center gap-2.5 text-white/75">
                    <TypingDots />
                    <span className="text-sm">AI 正在回复</span>
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
            className="group rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(14,20,38,0.82)_0%,rgba(10,14,28,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_22px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-[border-color,box-shadow,background] duration-200 hover:border-violet-400/30 hover:shadow-[0_0_0_1px_rgba(167,139,250,0.1)] focus-within:border-violet-400/30 focus-within:shadow-[0_0_0_1px_rgba(167,139,250,0.1)]"
          >
            <div className="flex items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={inputDisabled}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (canSend) void handleSend()
                  }
                }}
                placeholder={
                  !hasThreadMedia && !pendingReady
                    ? '上传图片或视频，开始对话'
                    : '请输入您的需求，支持图片分析、图片生成、视频分析'
                }
                rows={1}
                className="home-chat-composer-textarea min-h-[2.625rem] min-w-0 flex-1 resize-none overflow-y-auto !border-transparent !bg-transparent px-2 py-1 text-sm leading-relaxed text-white/90 outline-none !shadow-none ring-0 placeholder:text-white/28 focus:!border-transparent focus:!shadow-none focus:ring-0 disabled:opacity-45"
              />
            </div>

            <div className="mt-2 flex items-center gap-2 pt-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative shrink-0" ref={plusMenuRef}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    setParamsOpen(true)
                    setPlusMenuOpen((v) => !v)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/65 transition hover:bg-white/[0.06] hover:text-violet-100 active:scale-95 disabled:opacity-45"
                  title="上传"
                >
                  <ImagePlus className="pointer-events-none h-[17px] w-[17px] stroke-[2]" />
                </button>
                {plusMenuOpen ? (
                  <div className="absolute bottom-full left-0 z-[60] mb-2 min-w-[11rem] rounded-xl border border-white/14 bg-[#121522] py-1.5 shadow-xl">
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-white/[0.06]"
                      onClick={() => {
                        setPlusMenuOpen(false)
                        uploadInputRef.current?.click()
                      }}
                    >
                      从本地上传
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-white/[0.06]"
                      onClick={() => openAssetPicker('both')}
                    >
                      从资产库选择
                    </button>
                  </div>
                ) : null}
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  className="hidden"
                  onChange={(e) => void validateAndUploadFile(e.target.files?.[0] || null)}
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
                title="参数设置"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                参数
              </button>

              <div className="min-w-0 flex-1 overflow-x-auto">
                <div className="flex min-w-max items-center gap-2 pr-1 text-[11px] text-white/65">
                  <span>{active?.params.resolution || '2K'}</span>
                  <span className="text-white/25">/</span>
                  <span>{active?.params.aspectRatio || '1:1'}</span>
                  <span className="text-white/25">/</span>
                  <span>{active?.params.style || '写实'}</span>
                  <span className="text-white/25">/</span>
                  <span>参考权重 {active?.params.refWeight?.toFixed(2)}</span>
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
                      disabled={paramsDisabled}
                      onChange={(e) => updateParams({ resolution: e.target.value as any })}
                    >
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                      <option value="HD">HD</option>
                    </select>
                  </label>
                  <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                    <span className="shrink-0 whitespace-nowrap">比例</span>
                    <select
                      className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                      value={active?.params.aspectRatio || '1:1'}
                      disabled={paramsDisabled}
                      onChange={(e) => updateParams({ aspectRatio: e.target.value as any })}
                    >
                      <option value="1:1">1:1</option>
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                      <option value="4:3">4:3</option>
                    </select>
                  </label>
                  <label className="flex min-w-0 items-center gap-2 text-xs text-white/60">
                    <span className="shrink-0 whitespace-nowrap">风格</span>
                    <select
                      className="tikgen-spec-select min-w-0 flex-1 rounded-lg bg-black/35 px-2 py-1.5 text-white/90"
                      value={active?.params.style || '写实'}
                      disabled={paramsDisabled}
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
                    <span className="shrink-0 whitespace-nowrap tabular-nums">
                      参考权重 {active?.params.refWeight?.toFixed(2)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={active?.params.refWeight ?? 0.7}
                      disabled={paramsDisabled}
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
                disabled={paramsDisabled}
                onChange={(e) => updateParams({ syncToAssets: e.target.checked })}
              />
              生成图片自动同步至资产库
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.optimizePrompt !== false}
                disabled={paramsDisabled}
                onChange={(e) => updateParams({ optimizePrompt: e.target.checked })}
              />
              自动优化提示词
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.hdEnhance !== false}
                disabled={paramsDisabled}
                onChange={(e) => updateParams({ hdEnhance: e.target.checked })}
              />
              开启高清细节增强
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.negativePrompt !== false}
                disabled={paramsDisabled}
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
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="text-lg font-semibold">从资产库选择</div>
              <button type="button" onClick={() => setShowAssetPicker(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-3 border-b flex gap-2">
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm border ${assetTab === 'user_upload' ? 'bg-gray-900 text-white' : ''}`}
                onClick={() => setAssetTab('user_upload')}
              >
                本地上传
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm border ${assetTab === 'ai_generated' ? 'bg-gray-900 text-white' : ''}`}
                onClick={() => setAssetTab('ai_generated')}
              >
                AI 生成
              </button>
            </div>
            <div className="p-5 overflow-auto flex-1">
              {assetBusy ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                  {assetList.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="rounded-xl border overflow-hidden hover:border-violet-400"
                      onClick={() => pickAsset(a)}
                    >
                      {a.type === 'image' ? (
                        <img src={a.url} alt="" className="w-full h-28 object-cover bg-black" />
                      ) : (
                        <video src={a.url} className="w-full h-28 object-cover bg-black" muted playsInline />
                      )}
                      <div className="p-2 text-xs text-gray-700 truncate">{a.name || a.type}</div>
                    </button>
                  ))}
                </div>
              )}
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
