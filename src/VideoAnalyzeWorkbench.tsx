import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Clapperboard,
  Copy,
  FileDown,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageCircle,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { videoAnalyzeChat, type VideoAnalyzeTurn } from './api/videoAnalyze'
import {
  TIKGEN_IG_IDB,
  tikgenIgIdbGet,
  tikgenIgIdbSet,
  type VideoAnalyzeChatMessage,
  type VideoAnalyzeSessionStored,
} from './tikgenImageGenPersistence'

const MAX_VIDEO_BYTES = 18 * 1024 * 1024
const SESSIONS_CAP = 40

const PLACEHOLDER_EMPTY = '上传视频文件或粘贴 TikTok 视频链接，然后问我任何问题…'
const PLACEHOLDER_ACTIVE = '向我提问任何与视频相关的问题…'

type IntentId = 'analyze_script' | 'same_style_prompt' | 'selling_points'

type IntentDef = {
  id: IntentId
  label: string
  prompt: string
  activeClass: string
  idleClass: string
  Icon: typeof FileText
}

const INTENTS: IntentDef[] = [
  {
    id: 'analyze_script',
    label: '分析脚本',
    prompt: '从这个视频中提取完整的文本脚本，包括对话、旁白以及所有文字字幕：',
    activeClass: 'border-emerald-400/70 bg-emerald-500/15 text-emerald-100',
    idleClass: 'border-white/15 bg-white/[0.04] text-white/55 hover:bg-white/[0.07]',
    Icon: FileText,
  },
  {
    id: 'same_style_prompt',
    label: '复刻爆款',
    prompt: '生成与该视频同款提示词，我要拿来作为生成同款视频的提示词',
    activeClass: 'border-amber-400/65 bg-amber-500/12 text-amber-100',
    idleClass: 'border-white/15 bg-white/[0.04] text-white/55 hover:bg-white/[0.07]',
    Icon: ImageIcon,
  },
  {
    id: 'selling_points',
    label: '创作爆款',
    prompt: '分析下该视频的商品核心卖点有哪些',
    activeClass: 'border-sky-400/65 bg-sky-500/12 text-sky-100',
    idleClass: 'border-white/15 bg-white/[0.04] text-white/55 hover:bg-white/[0.07]',
    Icon: Clapperboard,
  },
]

function uid() {
  try {
    return crypto.randomUUID()
  } catch {
    return `va_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }
}

function readFileAsDataUrl(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(`文件过大（上限约 ${Math.round(maxBytes / 1024 / 1024)}MB）`))
      return
    }
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('读取文件失败'))
    r.readAsDataURL(file)
  })
}

function sessionTitleFromMessages(msgs: VideoAnalyzeChatMessage[]): string {
  const u = msgs.find((m) => m.role === 'user')
  const t = (u?.text || '').replace(/\s+/g, ' ').trim()
  if (!t) return '视频分析对话'
  return t.length > 44 ? `${t.slice(0, 44)}…` : t
}

function relativeTimeZh(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 55) return '刚刚'
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))} 分钟前`
  if (sec < 86400) return `${Math.max(1, Math.floor(sec / 3600))} 小时前`
  if (sec < 86400 * 7) return `${Math.max(1, Math.floor(sec / 86400))} 天前`
  const d = new Date(ts)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function mergeSessions(
  list: VideoAnalyzeSessionStored[],
  next: VideoAnalyzeSessionStored,
): VideoAnalyzeSessionStored[] {
  const i = list.findIndex((s) => s.id === next.id)
  const rest = i >= 0 ? list.filter((_, j) => j !== i) : list
  return [next, ...rest].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SESSIONS_CAP)
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function VideoAnalyzeWorkbench({ visible }: { visible: boolean }) {
  const [hydrated, setHydrated] = useState(false)
  const [sessions, setSessions] = useState<VideoAnalyzeSessionStored[]>([])
  const [activeSessionId, setActiveSessionId] = useState(() => uid())
  const [messages, setMessages] = useState<VideoAnalyzeChatMessage[]>([])
  const [intent, setIntent] = useState<IntentId>('analyze_script')
  const [inputText, setInputText] = useState('')
  const [linkUrl, setLinkUrl] = useState('')

  const [sessionVideo, setSessionVideo] = useState<{ name: string; dataUrl: string } | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyFlashId, setCopyFlashId] = useState<string | null>(null)

  const videoInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const visibleRef = useRef(visible)
  const sessionsRef = useRef(sessions)
  const messagesRef = useRef(messages)
  const activeSessionIdRef = useRef(activeSessionId)

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const raw = await tikgenIgIdbGet<VideoAnalyzeSessionStored[]>(TIKGEN_IG_IDB.videoAnalyzeSessions)
      if (cancelled) return
      if (Array.isArray(raw) && raw.length) {
        sessionsRef.current = raw
        setSessions(raw)
      }
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const persistAll = useCallback(async (nextSessions: VideoAnalyzeSessionStored[]) => {
    sessionsRef.current = nextSessions
    setSessions(nextSessions)
    await tikgenIgIdbSet(TIKGEN_IG_IDB.videoAnalyzeSessions, nextSessions)
  }, [])

  const archiveCurrentToHistory = useCallback(async () => {
    const msgs = messagesRef.current
    const sid = activeSessionIdRef.current
    if (msgs.length === 0) return
    const row: VideoAnalyzeSessionStored = {
      id: sid,
      title: sessionTitleFromMessages(msgs),
      updatedAt: Date.now(),
      messages: msgs.map((m) => ({ ...m })),
    }
    await persistAll(mergeSessions(sessionsRef.current, row))
  }, [persistAll])

  useEffect(() => {
    if (!hydrated) return
    if (visible) return
    void (async () => {
      await archiveCurrentToHistory()
      setMessages([])
      setSessionVideo(null)
      setLinkUrl('')
      setInputText('')
      setError('')
      setActiveSessionId(uid())
    })()
  }, [visible, hydrated, archiveCurrentToHistory])

  useEffect(() => {
    if (!visible) return
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, visible, busy])

  const onPickIntent = (id: IntentId) => {
    setIntent(id)
    const row = INTENTS.find((x) => x.id === id)
    if (row) setInputText(row.prompt)
  }

  const onVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !f.type.startsWith('video/')) {
      setError('请选择视频文件（如 mp4 / webm）')
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(f, MAX_VIDEO_BYTES)
      setSessionVideo({ name: f.name, dataUrl })
      setError('')
    } catch (err: any) {
      setError(err?.message || '视频读取失败')
    }
  }

  const send = async () => {
    if (busy) return
    const textBase = inputText.trim()
    const linkLine = linkUrl.trim() ? `参考链接：${linkUrl.trim()}` : ''
    const text = [textBase, linkLine].filter(Boolean).join('\n').trim()
    if (!text && !sessionVideo) {
      setError('请上传视频、粘贴链接或输入问题')
      return
    }
    const finalText = text || '请根据我上传的视频回答。'

    const userMsg: VideoAnalyzeChatMessage = {
      id: uid(),
      role: 'user',
      text: finalText,
      videoDataUrl: sessionVideo?.dataUrl,
    }

    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setBusy(true)
    setError('')

    const payloadTurns: VideoAnalyzeTurn[] = [
      ...nextMessages.slice(0, -1).map((m) => ({
        role: m.role,
        text: m.text,
        videoDataUrl: m.videoDataUrl,
        imageDataUrls: m.imageDataUrls,
      })),
      {
        role: 'user',
        text: userMsg.text,
        videoDataUrl: userMsg.videoDataUrl,
        imageDataUrls: userMsg.imageDataUrls,
      },
    ]

    try {
      const { reply } = await videoAnalyzeChat({ turns: payloadTurns })
      const asst: VideoAnalyzeChatMessage = {
        id: uid(),
        role: 'assistant',
        text: reply || '（无内容）',
      }
      setMessages((prev) => [...prev, asst])
    } catch (e: any) {
      setError(e?.message || '请求失败')
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id))
    } finally {
      setBusy(false)
    }
  }

  const startNewChat = async () => {
    if (busy) return
    await archiveCurrentToHistory()
    setMessages([])
    setSessionVideo(null)
    setLinkUrl('')
    setInputText('')
    setError('')
    setActiveSessionId(uid())
    setIntent('analyze_script')
  }

  const openSession = async (sid: string) => {
    if (busy || sid === activeSessionId) return
    await archiveCurrentToHistory()
    const hit = sessionsRef.current.find((s) => s.id === sid)
    if (!hit) return
    setActiveSessionId(hit.id)
    setMessages(hit.messages.map((m) => ({ ...m })))
    setSessionVideo(null)
    setLinkUrl('')
    setInputText('')
    setError('')
  }

  const addLink = () => {
    const u = window.prompt('粘贴 TikTok 或其它视频链接（模型未必能直接访问，仅作文字参考）：', linkUrl)
    if (u === null) return
    setLinkUrl(u.trim())
  }

  const onCopyAssistant = async (id: string, text: string) => {
    await copyToClipboard(text)
    setCopyFlashId(id)
    window.setTimeout(() => setCopyFlashId(null), 1600)
  }

  const hasConversation = messages.length > 0
  const textareaPlaceholder = hasConversation ? PLACEHOLDER_ACTIVE : PLACEHOLDER_EMPTY

  const tagRow = (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className={`text-xs shrink-0 ${hasConversation ? 'text-white/38' : 'text-white/70'}`}>想做什么</span>
      <div className="flex flex-wrap gap-2">
        {INTENTS.map((it) => {
          const Icon = it.Icon
          return (
            <button
              key={it.id}
              type="button"
              disabled={busy}
              onClick={() => onPickIntent(it.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors disabled:opacity-45 ${
                intent === it.id ? it.activeClass : it.idleClass
              }`}
            >
              <Icon className="w-3.5 h-3.5 opacity-90 shrink-0" />
              {it.label}
            </button>
          )
        })}
      </div>
    </div>
  )

  const attachmentChips =
    sessionVideo || linkUrl ? (
      <div className="flex flex-wrap gap-2">
        {sessionVideo ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-black/35 pl-2 pr-1 py-0.5 text-[11px] text-white/75 ring-1 ring-white/12">
            <Video className="w-3 h-3 opacity-80" />
            <span className="max-w-[200px] truncate">{sessionVideo.name}</span>
            <button
              type="button"
              disabled={busy}
              className="p-0.5 rounded-full hover:bg-white/10"
              onClick={() => setSessionVideo(null)}
              aria-label="移除视频"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ) : null}
        {linkUrl ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/12 pl-2 pr-1 py-0.5 text-[11px] text-sky-100/85 ring-1 ring-sky-400/22">
            <Link2 className="w-3 h-3 opacity-80" />
            <span className="max-w-[220px] truncate">{linkUrl}</span>
            <button
              type="button"
              disabled={busy}
              className="p-0.5 rounded-full hover:bg-white/10"
              onClick={() => setLinkUrl('')}
              aria-label="移除链接"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ) : null}
      </div>
    ) : null

  const bottomActions = (
    <div className="flex items-center justify-between gap-3 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={onVideoFile} />
        <button
          type="button"
          disabled={busy}
          onClick={() => videoInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium bg-black/25 text-white/82 ring-1 ring-white/[0.12] hover:bg-black/35 disabled:opacity-45"
        >
          <Upload className="w-3.5 h-3.5 opacity-90" />
          上传视频
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={addLink}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium bg-black/25 text-white/82 ring-1 ring-white/[0.12] hover:bg-black/35 disabled:opacity-45"
        >
          <Link2 className="w-3.5 h-3.5 opacity-90" />
          添加链接
        </button>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void send()}
        title="发送"
        className="shrink-0 w-11 h-11 rounded-full bg-zinc-200 text-zinc-900 flex items-center justify-center hover:bg-zinc-100 disabled:opacity-40 shadow-md shadow-black/40"
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUp className="w-5 h-5" strokeWidth={2.2} />}
      </button>
    </div>
  )

  return (
    <div className="max-w-[1280px] mx-auto px-4 pb-10">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="min-w-0">
          {!hasConversation ? (
            /* 新对话：整页即一张大输入卡（参考设计稿） */
            <div className="rounded-2xl bg-[#121214] ring-1 ring-white/[0.07] shadow-[0_28px_70px_-30px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col min-h-[min(76vh,720px)] h-[min(78vh,760px)]">
              <div className="shrink-0 flex justify-end px-4 pt-3 pb-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startNewChat()}
                  className="text-[11px] text-violet-200/90 hover:text-violet-100 disabled:opacity-40"
                >
                  + 新对话
                </button>
              </div>
              <div className="flex-1 min-h-0 flex flex-col px-4 pb-5 pt-1">
                <div className="flex-1 min-h-0 flex flex-col rounded-2xl bg-[#2b2b32] ring-1 ring-inset ring-white/[0.1] p-4 sm:p-5 shadow-inner">
                  {tagRow}
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    disabled={busy}
                    placeholder={textareaPlaceholder}
                    className="mt-4 w-full flex-1 min-h-[200px] resize-none rounded-xl bg-[#1e1e24] px-4 py-3.5 text-[15px] leading-relaxed text-white/90 placeholder:text-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/30 disabled:opacity-50"
                  />
                  {attachmentChips ? <div className="mt-3">{attachmentChips}</div> : null}
                  {error ? <p className="mt-2 text-xs text-rose-300/95">{error}</p> : null}
                  <div className="mt-auto pt-4 border-t border-white/[0.08]">{bottomActions}</div>
                </div>
              </div>
            </div>
          ) : (
            /* 已有对话：顶栏 + 消息区 + 底部输入条 */
            <div className="rounded-2xl bg-[#1a1a1f] ring-1 ring-inset ring-white/[0.09] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.75)] overflow-hidden flex flex-col h-[min(85vh,880px)]">
              <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-black/20">
                <span className="text-xs font-medium text-white/45">视频分析</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startNewChat()}
                  className="text-[11px] text-violet-200/85 hover:text-violet-100 disabled:opacity-40"
                >
                  + 新对话
                </button>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4 bg-[#141418]/80"
              >
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[94%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-violet-600/28 text-white/90 ring-1 ring-violet-400/22'
                          : 'bg-[#25252c] text-white/[0.82] ring-1 ring-white/[0.07]'
                      }`}
                    >
                      <pre className="whitespace-pre-wrap font-sans break-words">{m.text}</pre>
                      {m.role === 'assistant' ? (
                        <div className="mt-3 pt-3 border-t border-white/[0.08] flex items-center justify-end gap-3">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 text-[11px] text-white/45 hover:text-white/75 transition-colors"
                            onClick={() => void onCopyAssistant(m.id, m.text)}
                          >
                            <Copy className="w-3.5 h-3.5" />
                            {copyFlashId === m.id ? '已复制' : '复制'}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 text-[11px] text-white/45 hover:text-white/75 transition-colors"
                            onClick={() =>
                              downloadTextFile(m.text, `视频分析-${new Date().toISOString().slice(0, 10)}.txt`)
                            }
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            查看文件
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                {busy ? (
                  <div className="flex justify-start">
                    <div className="rounded-2xl px-3.5 py-2.5 bg-[#25252c] text-white/45 text-xs flex items-center gap-2 ring-1 ring-white/[0.06]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      GPT-4o 正在思考…
                    </div>
                  </div>
                ) : null}
                <div ref={chatEndRef} />
              </div>

              <div className="shrink-0 border-t border-white/[0.07] p-3 sm:p-4 space-y-3 bg-[#1e1e24]">
                {tagRow}
                <div className="rounded-xl bg-[#25252c] ring-1 ring-inset ring-white/[0.08] overflow-hidden">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    disabled={busy}
                    rows={3}
                    placeholder={textareaPlaceholder}
                    className="w-full resize-none bg-transparent px-3.5 py-3 text-sm text-white/88 placeholder:text-white/32 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/25 focus-visible:ring-inset disabled:opacity-50 min-h-[4.5rem]"
                  />
                  {attachmentChips ? <div className="px-3 pb-2">{attachmentChips}</div> : null}
                  {error ? <p className="px-3 pb-2 text-xs text-rose-300/95">{error}</p> : null}
                  <div className="px-3 py-2.5 border-t border-white/[0.06] bg-black/15">{bottomActions}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：会话历史 */}
        <div className="lg:sticky lg:top-24 space-y-3">
          <h3 className="text-sm font-semibold text-white/88 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-violet-300/80" />
            会话历史
          </h3>
          <p className="text-[11px] text-white/38 leading-relaxed">
            离开「视频分析」页面时，当前对话会自动归档到此。点击一条可重新打开（原左侧内容会先归档）。
          </p>
          <div className="space-y-2 max-h-[min(70vh,640px)] overflow-y-auto pr-1">
            {sessions.length === 0 ? (
              <div className="rounded-xl bg-black/20 py-8 text-center text-xs text-white/35 ring-1 ring-inset ring-white/[0.06]">
                暂无历史会话
              </div>
            ) : (
              sessions.map((s) => {
                const active = s.id === activeSessionId && messages.length > 0
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void openSession(s.id)}
                    className={`w-full text-left rounded-xl px-3 py-2.5 flex gap-2.5 transition-colors ring-1 ring-inset disabled:opacity-45 ${
                      active
                        ? 'bg-violet-500/15 ring-violet-400/35'
                        : 'bg-[#1a1a22] ring-white/[0.07] hover:bg-[#22222c] hover:ring-white/12'
                    }`}
                  >
                    <div className="shrink-0 w-8 h-8 rounded-full border border-white/15 flex items-center justify-center text-white/40">
                      <MessageCircle className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-white/85 line-clamp-2 leading-snug">{s.title}</div>
                      <div className="text-[11px] text-white/38 mt-0.5">{relativeTimeZh(s.updatedAt)}</div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
