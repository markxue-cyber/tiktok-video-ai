import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Folder, Home, Pencil, Pin, Plus, RefreshCw, Send, Trash2, Upload, X } from 'lucide-react'
import { createAssetAPI, listAssetsAPI, type AssetItem } from './api/assets'
import { homeChatTurnAPI } from './api/homeChat'
import { archiveAiMediaOnce } from './utils/archiveAiMediaOnce'

const STORAGE_KEY = 'tikgen.homeChat.sessions.v1'
const ACTIVE_KEY = 'tikgen.homeChat.activeId.v1'
const MAX_SESSIONS = 100
const MAX_STORED_MESSAGES = 200
const API_HISTORY_MAX = 40

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

export type HomeChatMsg = {
  id: string
  role: 'user' | 'assistant'
  text: string
  images?: string[]
  blocked?: boolean
}

export type HomeChatSession = {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  pinned?: boolean
  media: null | {
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
  return tail.map((m) => ({ role: m.role, text: m.text }))
}

type Props = {
  onGoBenefits: () => void
  onRefreshUser?: () => void | Promise<void>
}

export function HomeChatModule({ onGoBenefits, onRefreshUser }: Props) {
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
  const [sessionFilter, setSessionFilter] = useState<'all' | 'image_gen' | 'video_analysis'>('all')
  const [sessionSearch, setSessionSearch] = useState('')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [assetTab, setAssetTab] = useState<'user_upload' | 'ai_generated'>('user_upload')
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetList, setAssetList] = useState<AssetItem[]>([])
  const [assetPickType, setAssetPickType] = useState<'image' | 'video' | 'both'>('both')
  const [preview, setPreview] = useState<{ url: string; type: 'image' | 'video'; title?: string } | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  const active = useMemo(() => sessions.find((s) => s.id === activeId) || null, [sessions, activeId])

  useEffect(() => {
    if (!sessions.length) {
      const s = newSession()
      setSessions([s])
      setActiveId(s.id)
      saveSessions([s])
      try {
        localStorage.setItem(ACTIVE_KEY, s.id)
      } catch {
        // ignore
      }
      return
    }
    if (!activeId || !sessions.some((s) => s.id === activeId)) {
      const next = sessions[0]!
      setActiveId(next.id)
      try {
        localStorage.setItem(ACTIVE_KEY, next.id)
      } catch {
        // ignore
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active?.messages.length, busy])

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
  }

  const pickAsset = (a: AssetItem) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? {
              ...s,
              updatedAt: Date.now(),
              media: {
                type: a.type,
                url: a.url,
                name: a.name || (a.type === 'video' ? '视频' : '图片'),
                sizeLabel: '',
                fromAsset: true,
              },
            }
          : s,
      ),
    )
    setShowAssetPicker(false)
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
    setBusy(true)
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
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                updatedAt: Date.now(),
                media: {
                  type: kind,
                  url,
                  name: file.name,
                  sizeLabel: formatBytes(file.size),
                  fromAsset: false,
                },
              }
            : s,
        ),
      )
    } catch (e: any) {
      setError(e?.message || '上传失败')
    } finally {
      setBusy(false)
    }
  }

  const clearMedia = () => {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, updatedAt: Date.now(), media: null } : s)),
    )
    setInput('')
  }

  const handleSend = async () => {
    const s = sessions.find((x) => x.id === activeId)
    if (!s?.media) return
    const text = input.trim()
    if (!text) return
    if (busy) return

    let hist = buildHistoryForApi(s.messages)
    if (hist.length > API_HISTORY_MAX) {
      setToast('已为您保留最近 20 轮有效对话，更早的对话内容已自动精简，保证模型响应速度')
      window.setTimeout(() => setToast(''), 5000)
    }

    const userMsg: HomeChatMsg = {
      id: `m_${Date.now()}_u`,
      role: 'user',
      text,
    }
    setSessions((prev) =>
      prev.map((x) => {
        if (x.id !== activeId) return x
        const nextMsgs = [...x.messages, userMsg].slice(-MAX_STORED_MESSAGES)
        const title =
          x.messages.length === 0 ? sessionTitleFrom(text, x.media!.type) : x.title
        return { ...x, title, updatedAt: Date.now(), messages: nextMsgs }
      }),
    )
    setInput('')
    setBusy(true)
    setError('')
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    hist = [...hist, { role: 'user' as const, text }]

    try {
      const data = await homeChatTurnAPI({
        mediaType: s.media.type,
        mediaUrl: s.media.url,
        userMessage: text,
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
        if (code === 'QUOTA_EXHAUSTED' || /额度|用尽/.test(msg)) {
          onGoBenefits()
        }
        if (code === 'PAYMENT_REQUIRED' || /付费|订单/.test(msg)) {
          onGoBenefits()
        }
        throw new Error(msg)
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
                prompt: text,
              },
            })
          }
        }
      }

      void onRefreshUser?.()
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '发送失败')
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

  const filteredSessions = useMemo(() => {
    const kw = sessionSearch.trim().toLowerCase()
    return sessions
      .filter((s) => {
        if (sessionFilter === 'all') return true
        if (sessionFilter === 'video_analysis') return s.media?.type === 'video'
        return s.media?.type === 'image' || !s.media
      })
      .filter((s) => {
        if (!kw) return true
        return (
          s.title.toLowerCase().includes(kw) ||
          new Date(s.createdAt).toLocaleString().toLowerCase().includes(kw)
        )
      })
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt)
  }, [sessions, sessionFilter, sessionSearch])

  const mediaReady = !!active?.media
  const canSend = mediaReady && !!input.trim() && !busy

  const suggestTags =
    active?.media?.type === 'video'
      ? ['拆解视频脚本', '分析拍摄手法', '提取完整台词']
      : ['帮我分析这张图', '生成同款风格图片', '提取图中商品信息']

  const updateParams = (patch: Partial<HomeChatSession['params']>) => {
    if (!activeId) return
    setSessions((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, params: { ...s.params, ...patch }, updatedAt: Date.now() } : s)),
    )
  }

  return (
    <div className="flex gap-6 min-h-[calc(100vh-7.5rem)]">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {!mediaReady ? (
          <div className="tikgen-panel rounded-2xl p-8 flex-1 flex flex-col items-center justify-center">
            <div className="text-white/90 text-lg font-semibold mb-2 flex items-center gap-2">
              <Home className="w-5 h-5" />
              上传图片或视频开始对话
            </div>
            <p className="text-sm text-white/50 mb-6 text-center max-w-md">
              支持图片：JPG/PNG/WebP（单文件≤20MB）；支持视频：MP4/MOV（单文件≤500MB，时长≤10 分钟）
            </p>
            <div
              className="tikgen-ref-dropzone rounded-xl p-6 w-full max-w-xl cursor-pointer"
              onDragOver={(e) => {
                e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                void validateAndUploadFile(e.dataTransfer?.files?.[0] || null)
              }}
              onClick={() => uploadInputRef.current?.click()}
            >
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => void validateAndUploadFile(e.target.files?.[0] || null)}
              />
              <div className="flex flex-col items-center gap-3 py-6">
                <Upload className="w-10 h-10 text-white/35" />
                <div className="text-sm font-medium text-white/75">点击或拖拽上传图片 / 视频</div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-white/80 ring-1 ring-inset ring-white/[0.07]"
                    onClick={(e) => {
                      e.stopPropagation()
                      uploadInputRef.current?.click()
                    }}
                  >
                    选择文件
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-white/80 ring-1 ring-inset ring-white/[0.07] inline-flex items-center gap-1"
                    onClick={(e) => {
                      e.stopPropagation()
                      openAssetPicker('both')
                    }}
                  >
                    <Folder className="w-3.5 h-3.5 text-white/45" />
                    从资产库选择
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="tikgen-panel rounded-2xl p-4 mb-4">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  className="shrink-0 rounded-xl overflow-hidden border border-white/12 bg-black/40 w-28 h-20 flex items-center justify-center"
                  onClick={() =>
                    active?.media &&
                    setPreview({ url: active.media.url, type: active.media.type, title: active.media.name })
                  }
                >
                  {active?.media?.type === 'image' ? (
                    <img src={active.media.url} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <video src={active.media!.url} className="w-full h-full object-contain" muted playsInline />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white/90 font-medium truncate">{active?.media?.name}</div>
                  <div className="text-xs text-white/45 mt-1">
                    {active?.media?.sizeLabel}
                    {active?.media?.fromAsset ? (
                      <span className="ml-2 text-violet-200/90">来自资产库</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded-lg border border-white/12 text-white/75 hover:bg-white/[0.06]"
                      onClick={() => uploadInputRef.current?.click()}
                    >
                      更换媒体
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded-lg border border-red-400/25 text-red-200 hover:bg-red-500/10"
                      onClick={clearMedia}
                    >
                      删除媒体
                    </button>
                  </div>
                </div>
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => void validateAndUploadFile(e.target.files?.[0] || null)}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="px-3 py-1.5 rounded-full text-xs border border-white/12 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]"
                    onClick={() => setInput(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="tikgen-panel rounded-2xl p-4 flex-1 min-h-0 overflow-y-auto mb-4">
              {active?.messages.length === 0 && !busy ? (
                <div className="h-40 flex items-center justify-center text-white/35 text-sm">开始输入你的问题</div>
              ) : null}
              <div className="space-y-4">
                {active?.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-gradient-to-r from-pink-500/90 to-purple-600/90 text-white'
                          : m.blocked
                            ? 'bg-amber-500/15 border border-amber-400/30 text-amber-50'
                            : 'bg-white/[0.06] border border-white/10 text-white/90'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      {m.images?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.images.map((u, i) => (
                            <button
                              key={i}
                              type="button"
                              className="relative w-24 h-24 rounded-lg overflow-hidden border border-white/12"
                              onClick={() => setPreview({ url: u, type: 'image', title: `生成 ${i + 1}` })}
                            >
                              <img src={u} alt="" className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                {busy ? (
                  <div className="flex justify-start">
                    <div className="bg-white/[0.06] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white/70 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      AI 正在思考…
                    </div>
                  </div>
                ) : null}
                <div ref={listEndRef} />
              </div>
            </div>
          </>
        )}

        {!!error && <div className="mb-2 text-sm text-red-300">{error}</div>}
        {!!toast && <div className="mb-2 text-sm text-amber-200/90">{toast}</div>}

        <div className="tikgen-panel rounded-2xl p-4 shrink-0">
          <div className="flex gap-3 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!mediaReady || busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (canSend) void handleSend()
                }
              }}
              placeholder={
                !mediaReady
                  ? '请先上传图片或视频，再发起对话'
                  : '请输入您的需求，支持图片分析、图片生成、视频分析'
              }
              rows={3}
              className="flex-1 min-w-0 rounded-xl px-4 py-3 bg-black/25 border border-white/10 text-white/90 placeholder:text-white/35 outline-none focus:ring-2 focus:ring-violet-400/30 disabled:opacity-45"
            />
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void handleSend()}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white font-semibold disabled:opacity-45 shrink-0"
            >
              <span className="inline-flex items-center gap-2">
                <Send className="w-4 h-4" />
                发送
              </span>
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <label className="text-white/60 text-xs">
              分辨率
              <select
                className="mt-1 w-full tikgen-spec-select rounded-lg bg-black/35 py-2 px-2 text-white/90"
                value={active?.params.resolution || '2K'}
                disabled={!mediaReady}
                onChange={(e) => updateParams({ resolution: e.target.value as any })}
              >
                <option value="2K">2K</option>
                <option value="4K">4K</option>
                <option value="HD">HD</option>
              </select>
            </label>
            <label className="text-white/60 text-xs">
              比例
              <select
                className="mt-1 w-full tikgen-spec-select rounded-lg bg-black/35 py-2 px-2 text-white/90"
                value={active?.params.aspectRatio || '1:1'}
                disabled={!mediaReady}
                onChange={(e) => updateParams({ aspectRatio: e.target.value as any })}
              >
                <option value="1:1">1:1</option>
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="4:3">4:3</option>
              </select>
            </label>
            <label className="text-white/60 text-xs">
              风格
              <select
                className="mt-1 w-full tikgen-spec-select rounded-lg bg-black/35 py-2 px-2 text-white/90"
                value={active?.params.style || '写实'}
                disabled={!mediaReady}
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
            <label className="text-white/60 text-xs">
              参考权重 {active?.params.refWeight?.toFixed(2)}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={active?.params.refWeight ?? 0.7}
                disabled={!mediaReady}
                onChange={(e) => updateParams({ refWeight: Number(e.target.value) })}
                className="mt-2 w-full"
              />
            </label>
          </div>
          <div className="mt-3 grid sm:grid-cols-2 gap-2 text-xs text-white/80">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.syncToAssets !== false}
                disabled={!mediaReady}
                onChange={(e) => updateParams({ syncToAssets: e.target.checked })}
              />
              生成图片自动同步至资产库
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.optimizePrompt !== false}
                disabled={!mediaReady}
                onChange={(e) => updateParams({ optimizePrompt: e.target.checked })}
              />
              自动优化提示词
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.hdEnhance !== false}
                disabled={!mediaReady}
                onChange={(e) => updateParams({ hdEnhance: e.target.checked })}
              />
              开启高清细节增强
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={active?.params.negativePrompt !== false}
                disabled={!mediaReady}
                onChange={(e) => updateParams({ negativePrompt: e.target.checked })}
              />
              添加通用负面提示词
            </label>
          </div>
        </div>
      </div>

      <aside className="w-[380px] shrink-0 tikgen-panel rounded-2xl p-4 flex flex-col min-h-0 max-h-[calc(100vh-7.5rem)]">
        <button
          type="button"
          onClick={newChat}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white font-semibold mb-4 shrink-0"
        >
          <span className="inline-flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> 新建对话
          </span>
        </button>
        <div className="text-sm font-semibold text-white/90 mb-2">历史对话</div>
        <div className="flex gap-1 mb-2 shrink-0">
          {(['all', 'image_gen', 'video_analysis'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`px-2 py-1 rounded-lg text-[11px] border ${
                sessionFilter === k ? 'bg-white/12 border-white/20 text-white' : 'border-white/10 text-white/55'
              }`}
              onClick={() => setSessionFilter(k)}
            >
              {k === 'all' ? '全部' : k === 'image_gen' ? '图片生成' : '视频分析'}
            </button>
          ))}
        </div>
        <input
          value={sessionSearch}
          onChange={(e) => setSessionSearch(e.target.value)}
          placeholder="搜索标题或时间"
          className="mb-3 w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-white/90 placeholder:text-white/35"
        />
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {filteredSessions.length === 0 ? (
            <div className="text-xs text-white/40 py-8 text-center">暂无历史对话，点击「新建对话」开始创作</div>
          ) : (
            filteredSessions.map((s) => (
              <div
                key={s.id}
                className={`rounded-xl border p-3 cursor-pointer transition-colors ${
                  s.id === activeId ? 'border-violet-400/50 bg-white/[0.07]' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
                onClick={() => setActiveId(s.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-white/90 font-medium truncate">{s.title}</div>
                    <div className="text-[11px] text-white/40 mt-1">{new Date(s.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-white/10 text-white/50"
                      title="置顶"
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePin(s.id)
                      }}
                    >
                      <Pin className={`w-3.5 h-3.5 ${s.pinned ? 'text-amber-200' : ''}`} />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-white/10 text-white/50"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation()
                        renameSession(s.id)
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-white/10 text-red-300/80"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSession(s.id)
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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
          className="mt-3 w-full py-2 rounded-xl border border-white/15 text-sm text-white/70 hover:bg-white/[0.05] shrink-0"
        >
          清空全部历史
        </button>
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
          <div className="max-w-5xl w-full max-h-[90vh] relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="absolute -top-10 right-0 px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20"
              onClick={() => setPreview(null)}
            >
              关闭
            </button>
            {preview.type === 'image' ? (
              <img src={preview.url} alt="" className="w-full max-h-[85vh] object-contain rounded-xl bg-black" />
            ) : (
              <video src={preview.url} className="w-full max-h-[85vh] rounded-xl bg-black" controls autoPlay playsInline />
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
