import { useEffect, useMemo, useRef, useState } from 'react'
import { Video, Image, Zap, LogOut, User, Play, Download, RefreshCw, Sparkles, X, Upload, Scissors, Eraser, Wand2, Folder, ChevronRight, ChevronsLeft, ChevronsRight, Check, Crown, WandSparkles, ShieldCheck, Library, Settings2, Eye, EyeOff, MessageSquare, Bell } from 'lucide-react'
import { checkVideoStatus, generateVideoAPI } from './api/video'
import { beautifyScript, generateImagePrompt, generateVideoScripts, parseProductInfo, type ProductInfo } from './api/ai'
import { generateImageAPI } from './api/image'
import { applyImageStyleTags } from './api/imageStyle'
import { qcEcommerceImage } from './api/imageQc'
import { apiLogin, apiMe, apiRefresh, apiRegister, apiResendSignup, apiRecoverPassword, apiUpdatePassword } from './api/auth'
import { createOrder, getOrderStatus } from './api/payments'
import { createAssetAPI, deleteAssetAPI, listAssetsAPI, updateAssetAPI, type AssetItem } from './api/assets'
import { listTasksAPI, type GenerationTaskItem } from './api/tasks'
import { getMonitoringStatsAPI, type MonitoringStats } from './api/monitoring'
import { getModelAvailabilityAPI } from './api/modelAvailability'
import {
  adminDeletePackageConfig,
  adminListAnnouncements,
  adminListModelControls,
  adminListPackageConfigs,
  adminListSupportTickets,
  adminListUsers,
  adminUpdateModelControl,
  adminUpdateSupportTicket,
  adminUpdateUser,
  adminUpsertAnnouncement,
  adminUpsertPackageConfig,
  type AdminSupportTicketItem,
  type AdminUserItem,
} from './api/admin'
import { listPackageConfigsPublic, type PackageConfigItem } from './api/packageConfigs'
import { listAnnouncementsPublic } from './api/announcements'
import { createSupportTicket, listMySupportTickets, type SupportTicketItem } from './api/support'
import { IMAGE_TEMPLATES, VIDEO_TEMPLATES, type ImageTemplatePreset, type VideoTemplatePreset } from './config/templates'
import { Sentry } from './sentry'
import './workbench-theme.css'

// 视频模型列表来自聚合API报错提示（会随账号权限变化而变化）
const VIDEO_MODELS = [
  { id: 'sora-2', name: 'Sora 2.0' },
  { id: 'sora-2-pro', name: 'Sora 2.0 Pro' },
  { id: 'sora-2-vip', name: 'Sora 2.0 VIP' },
  { id: 'sora_video2', name: 'Sora Video2' },
  { id: 'gpt-video-2', name: 'GPT Video 2' },
  { id: 'gpt-video-2-pro', name: 'GPT Video 2 Pro' },
  { id: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro' },
  { id: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro' },
  { id: 'veo3', name: 'Veo 3' },
  { id: 'veo3-fast', name: 'Veo 3 Fast' },
  { id: 'veo3-pro', name: 'Veo 3 Pro' },
  { id: 'veo2', name: 'Veo 2' },
  { id: 'veo2-fast', name: 'Veo 2 Fast' },
  { id: 'wan2.6-t2v', name: 'Wan 2.6 T2V' },
  { id: 'wan2.6-i2v', name: 'Wan 2.6 I2V' },
  { id: 'wan2.6-r2v', name: 'Wan 2.6 R2V' },
]

const VIDEO_ASPECT_OPTIONS = ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'] as const
const VIDEO_RES_OPTIONS = ['480p', '720p', '1080p', '1440p', '2160p'] as const // 2160p=4K
const VIDEO_DUR_OPTIONS = [4, 5, 6, 8, 10, 12, 15, 20, 30] as const

type VideoAspect = (typeof VIDEO_ASPECT_OPTIONS)[number]
type VideoRes = (typeof VIDEO_RES_OPTIONS)[number]
type VideoDur = (typeof VIDEO_DUR_OPTIONS)[number]

type VideoModelCaps = {
  aspectRatios: VideoAspect[]
  resolutions: VideoRes[]
  durations: VideoDur[]
  defaults: { aspectRatio: VideoAspect; resolution: VideoRes; durationSec: VideoDur }
}

// 不同模型对参数支持范围不同（后续可按聚合API返回进一步精细化）
const VIDEO_MODEL_CAPS: Record<string, VideoModelCaps> = {
  // Sora 系列：一般支持横竖屏 + 720/1080 + 10/15
  'sora-2': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'sora-2-pro': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '1080p', durationSec: 10 } },
  'sora-2-vip': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '1080p', durationSec: 10 } },
  'sora_video2': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },

  // GPT Video
  'gpt-video-2': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'gpt-video-2-pro': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '1080p', durationSec: 10 } },

  // Seedance
  'doubao-seedance-1-5-pro-251215': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'doubao-seedance-1-0-pro-250528': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: ['480p', '720p', '1080p'], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },

  // Veo
  'veo3': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '1080p', durationSec: 10 } },
  'veo3-fast': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: ['480p', '720p', '1080p'], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '720p', durationSec: 10 } },
  'veo3-pro': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: ['720p', '1080p', '1440p', '2160p'], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '2160p', durationSec: 10 } },
  'veo2': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '1080p', durationSec: 10 } },
  'veo2-fast': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: ['480p', '720p', '1080p'], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '720p', durationSec: 10 } },

  // Wan：通常更保守（先给 720p + 10s 默认；仍允许 15s 以便用户试）
  'wan2.6-t2v': { aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4'], resolutions: ['480p', '720p', '1080p'], durations: [4, 5, 6, 8, 10, 12, 15], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'wan2.6-i2v': { aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4'], resolutions: ['480p', '720p', '1080p'], durations: [4, 5, 6, 8, 10, 12, 15], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'wan2.6-r2v': { aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4'], resolutions: ['480p', '720p', '1080p'], durations: [4, 5, 6, 8, 10, 12, 15], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
}
// 图片模型列表：先覆盖聚合端常见可用项（可按账号权限增减）
const IMAGE_MODELS = [
  { id: 'nano-banana-2', name: 'Nano Banana 2' },
  { id: 'seedream', name: 'Seedream 4.5' },
  { id: 'seedream-4.5', name: 'Seedream 4.5 (Alt)' },
  { id: 'flux', name: 'FLUX' },
  { id: 'flux-dev', name: 'FLUX Dev' },
  { id: 'flux-pro', name: 'FLUX Pro' },
  { id: 'sdxl', name: 'SDXL' },
  { id: 'dalle-3', name: 'DALL·E 3' },
  { id: 'midjourney', name: 'Midjourney' },
]

const TEMP_UNAVAILABLE_IMAGE_MODEL_RULES: Array<{ test: RegExp; reason: string }> = [{ test: /midjourney|^mj_/i, reason: '当前通道暂不可用' }]

function getImageModelUnavailableReason(id: string): string {
  const s = String(id || '')
  for (const r of TEMP_UNAVAILABLE_IMAGE_MODEL_RULES) {
    if (r.test.test(s)) return r.reason
  }
  return ''
}

const IMAGE_ASPECT_OPTIONS = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'] as const
const IMAGE_RES_OPTIONS = ['1024', '1536', '2048', '4096'] as const // 通用档位（部分模型会映射到2k/4k）

type ImageAspect = (typeof IMAGE_ASPECT_OPTIONS)[number]
type ImageRes = (typeof IMAGE_RES_OPTIONS)[number]

type ImageModelCaps = {
  aspectRatios: ImageAspect[]
  resolutions: ImageRes[]
  defaults: { aspectRatio: ImageAspect; resolution: ImageRes }
}

const IMAGE_MODEL_CAPS: Record<string, ImageModelCaps> = {
  'nano-banana-2': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['2048', '4096'], defaults: { aspectRatio: '1:1', resolution: '2048' } },
  seedream: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['2048', '4096'], defaults: { aspectRatio: '1:1', resolution: '2048' } },
  'seedream-4.5': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['2048', '4096'], defaults: { aspectRatio: '1:1', resolution: '2048' } },
  flux: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536', '2048'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  'flux-dev': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  'flux-pro': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536', '2048'], defaults: { aspectRatio: '1:1', resolution: '1536' } },
  sdxl: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  'dalle-3': { aspectRatios: ['1:1', '9:16', '16:9'], resolutions: ['1024', '2048'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  midjourney: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '2048'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
}
const DEFAULT_PACKAGES: PackageConfigItem[] = [
  { plan_id: 'trial', name: '试用版', price_cents: 0, currency: 'CNY', daily_quota: 3, features: ['每天3次', '基础功能'], enabled: true, display_order: 10, apply_mode: 'new_only', grace_days: 0 },
  { plan_id: 'basic', name: '基础版', price_cents: 6900, currency: 'CNY', daily_quota: 20, features: ['每天20次', '全部模型'], enabled: true, display_order: 20, apply_mode: 'new_only', grace_days: 0 },
  { plan_id: 'pro', name: '专业版', price_cents: 24900, currency: 'CNY', daily_quota: 999999, features: ['高配额', '4K输出'], enabled: true, display_order: 30, apply_mode: 'new_only', grace_days: 0 },
  { plan_id: 'enterprise', name: '旗舰版', price_cents: 119900, currency: 'CNY', daily_quota: 999999, features: ['企业级', 'API接入'], enabled: true, display_order: 40, apply_mode: 'new_only', grace_days: 0 },
]

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function guessAssetType(file: File): 'image' | 'video' {
  return String(file.type || '').startsWith('video/') ? 'video' : 'image'
}

async function safeArchiveAsset(params: { source: 'user_upload' | 'ai_generated'; type: 'image' | 'video'; url: string; name?: string; metadata?: any }) {
  try {
    if (!params.url) return
    await createAssetAPI(params)
  } catch (e) {
    // Never block core generation/upload UX due to archive write failure.
    // Keep a trace for debugging when user reports missing assets.
    console.error('[assets] archive failed:', e)
  }
}

function GenerationLoadingCard({
  title,
  subtitle,
  chips,
  statusText,
  progressText,
}: {
  title: string
  subtitle: string
  chips?: readonly string[]
  statusText?: string
  progressText?: string
}) {
  return (
    <div className="h-96 rounded-xl border border-white/10 bg-[linear-gradient(180deg,#080a14,#03040a)] px-6 text-center flex flex-col items-center justify-center">
      <div className="relative w-[88px] h-[88px] mb-3">
        <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-purple-400 animate-spin" />
        <div className="absolute inset-[14px] rounded-full border-[3px] border-transparent border-r-cyan-300 [animation:spin_1s_linear_infinite_reverse]" />
      </div>
      <h3 className="text-[28px] leading-none font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-white/70">{subtitle}</p>
      {Array.isArray(chips) && chips.length > 0 ? (
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {chips.map((chip) => (
            <span key={chip} className="px-2.5 py-1 rounded-full text-xs border border-white/15 bg-white/5 text-white/80">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      {statusText ? <p className="mt-4 text-sm text-white/75">{statusText}</p> : null}
      {progressText ? <p className="mt-1 text-xs text-white/55">{progressText}</p> : null}
    </div>
  )
}

const LOADING_COPY = {
  tech: {
    image: {
      title: '图片生成中',
      subtitle: '正在进行多阶段渲染与细节增强，请稍等片刻...',
      chips: ['构图', '光影', '质检'],
    },
    video: {
      title: '视频生成中',
      subtitle: '正在计算运镜轨迹与画面细节，请稍等片刻...',
      chips: ['构图', '运镜', '质检'],
    },
  },
  premium: {
    image: {
      title: '图片生成中',
      subtitle: '高品质画面正在精修中，请稍候...',
      chips: ['构图美学', '光影层次', '品质校验'],
    },
    video: {
      title: '视频生成中',
      subtitle: '高阶视觉表达正在生成中，请稍候...',
      chips: ['镜头语言', '节奏质感', '品质校验'],
    },
  },
} as const

const ACTIVE_LOADING_COPY_STYLE: keyof typeof LOADING_COPY = 'tech'

const ASSETS_CACHE_KEY = 'tikgen.assets.cache.v1'
let assetsMemoryCache: {
  userUploads: AssetItem[]
  aiOutputs: AssetItem[]
  userOffset: number
  aiOffset: number
  userHasMore: boolean
  aiHasMore: boolean
  ts: number
} | null = null
let assetsPrefetching = false
let assetsPrefetchAt = 0
let assetsWarmupDoneForToken = ''
const SESSION_KEY = 'tikgen.session'

function parseSessionFromUrl(): null | {
  access_token: string
  refresh_token?: string
  expires_at?: number
  token_type?: string
  type?: string
} {
  try {
    if (typeof window === 'undefined') return null
    const grab = (raw: string) => {
      const cleaned = raw.startsWith('#') ? raw.slice(1) : raw
      const sp = new URLSearchParams(cleaned)
      const access_token = String(sp.get('access_token') || '')
      const refresh_token = String(sp.get('refresh_token') || '')
      const type = String(sp.get('type') || '')
      if (!access_token) return null
      // Some password recovery reset links may omit refresh_token.
      if (type === 'recovery') {
        // For recovery flows we only need access_token to call our update endpoint.
        if (!access_token) return null
      } else {
        // For other flows, keep the previous requirement.
        if (!refresh_token) return null
      }
      const expires_at = sp.get('expires_at') ? Number(sp.get('expires_at')) : undefined
      const token_type = String(sp.get('token_type') || '')
      return {
        access_token,
        refresh_token: type === 'recovery' ? refresh_token || undefined : refresh_token,
        expires_at: Number.isFinite(expires_at as any) ? expires_at : undefined,
        token_type: token_type || undefined,
        type: type || undefined,
      }
    }

    const hash = String(window.location.hash || '')
    if (hash) {
      const fromHash = grab(hash)
      if (fromHash) return fromHash
    }

    const search = String(window.location.search || '')
    if (search) {
      const cleaned = search.startsWith('?') ? search.slice(1) : search
      const fromSearch = grab(cleaned)
      if (fromSearch) return fromSearch
    }

    return null
  } catch {
    return null
  }
}

async function prefetchAssetsCacheIfNeeded() {
  if (assetsPrefetching) return
  const now = Date.now()
  // Avoid repeated prefetches when user hovers repeatedly.
  if (now - assetsPrefetchAt < 15000) return
  // Fresh enough cache, skip prefetch.
  if (assetsMemoryCache && now - Number(assetsMemoryCache.ts || 0) < 30000) return
  if (!localStorage.getItem('tikgen.accessToken')) return
  assetsPrefetching = true
  try {
    const [u, a] = await Promise.all([
      listAssetsAPI({ source: 'user_upload', limit: 12, offset: 0 }),
      listAssetsAPI({ source: 'ai_generated', limit: 12, offset: 0 }),
    ])
    const payload = {
      userUploads: Array.isArray(u.assets) ? u.assets : [],
      aiOutputs: Array.isArray(a.assets) ? a.assets : [],
      userOffset: Number(u.nextOffset ?? (u.assets?.length || 0)),
      aiOffset: Number(a.nextOffset ?? (a.assets?.length || 0)),
      userHasMore: Boolean(u.hasMore),
      aiHasMore: Boolean(a.hasMore),
      ts: Date.now(),
    }
    assetsMemoryCache = payload
    try {
      localStorage.setItem(ASSETS_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore cache write errors
    }
  } catch {
    // ignore prefetch errors, do not block navigation
  } finally {
    assetsPrefetchAt = Date.now()
    assetsPrefetching = false
  }
}

function App() {
  const urlSession = parseSessionFromUrl()
  const urlType = urlSession?.type || ''
  const [page, setPage] = useState<'landing' | 'auth' | 'home'>(() => {
    if (localStorage.getItem('tikgen.accessToken')) return 'home'
    if (urlType === 'recovery') return 'auth'
    if (urlSession?.access_token) return 'home'
    return 'landing'
  })
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'recover' | 'recoverReset'>(() => {
    return urlType === 'recovery' ? 'recoverReset' : 'login'
  })
  const [user, setUser] = useState<{ id?: string; name: string; email?: string; credits: number; package: string; packageExpiresAt: string } | null>(null)
  const [accessToken, setAccessToken] = useState<string>(() => {
    const stored = localStorage.getItem('tikgen.accessToken')
    if (stored) return stored
    if (urlType === 'recovery') return ''
    return urlSession?.access_token || ''
  })
  const [recoveryAccessToken, setRecoveryAccessToken] = useState<string>(() => {
    if (urlType === 'recovery') return urlSession?.access_token || ''
    return ''
  })
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authPassword2, setAuthPassword2] = useState('')
  const [authShowPassword, setAuthShowPassword] = useState(false)
  const [authShowPassword2, setAuthShowPassword2] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authResendBusy, setAuthResendBusy] = useState(false)
  const [mainNav, setMainNav] = useState<'create' | 'templates' | 'tasks' | 'tools' | 'assets' | 'benefits' | 'developer'>('create')
  const [createNav, setCreateNav] = useState<'video' | 'image'>('video')
  const [toolNav, setToolNav] = useState<'subtitle' | 'watermark' | 'upscale'>('subtitle')
  const [videoTemplatePreset, setVideoTemplatePreset] = useState<VideoTemplatePreset | null>(null)
  const [imageTemplatePreset, setImageTemplatePreset] = useState<ImageTemplatePreset | null>(null)
  const [packageCatalog, setPackageCatalog] = useState<PackageConfigItem[]>(DEFAULT_PACKAGES)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [showAnnouncements, setShowAnnouncements] = useState(false)
  const [announcements, setAnnouncements] = useState<any[]>([])
  const [annBusy, setAnnBusy] = useState(false)
  const [readAnnouncementIds, setReadAnnouncementIds] = useState<string[]>([])
  const announcementsRef = useRef<HTMLDivElement | null>(null)

  const readSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  const saveSession = (session: any) => {
    try {
      if (!session?.access_token) return
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      localStorage.setItem('tikgen.accessToken', String(session.access_token))
    } catch {
      // ignore
    }
  }

  const clearSession = () => {
    localStorage.removeItem('tikgen.accessToken')
    localStorage.removeItem(SESSION_KEY)
  }

  useEffect(() => {
    ;(async () => {
      if (!accessToken) return
      try {
        const me = await apiMe(accessToken)
        const plan = me?.subscription?.planId || 'trial'
        const end = me?.subscription?.currentPeriodEnd ? String(me.subscription.currentPeriodEnd).slice(0, 10) : ''
        setUser({
          id: me?.user?.id,
          name: me?.user?.name || me?.user?.email || '用户',
          email: me?.user?.email,
          credits: 0,
          package: plan,
          packageExpiresAt: end,
        })
        setPage('home')
        // Keep "处理中..." until we leave the auth page.
        setAuthBusy(false)
      } catch {
        try {
          const sess = readSession()
          const rt = String(sess?.refresh_token || '').trim()
          if (!rt) throw new Error('missing refresh token')
          const rr = await apiRefresh(rt)
          const nextSession = rr?.session || null
          if (!nextSession?.access_token) throw new Error('refresh failed')
          saveSession(nextSession)
          const nextToken = String(nextSession.access_token)
          setAccessToken(nextToken)

          const me = await apiMe(nextToken)
          const plan = me?.subscription?.planId || 'trial'
          const end = me?.subscription?.currentPeriodEnd ? String(me.subscription.currentPeriodEnd).slice(0, 10) : ''
          setUser({
            id: me?.user?.id,
            name: me?.user?.name || me?.user?.email || '用户',
            email: me?.user?.email,
            credits: 0,
            package: plan,
            packageExpiresAt: end,
          })
          setPage('home')
          // Keep "处理中..." until we leave the auth page.
          setAuthBusy(false)
        } catch {
          clearSession()
          setAccessToken('')
          setUser(null)
          setAuthBusy(false)
          setPage('landing')
        }
      } finally {
        // no-op
      }
    })()
  }, [accessToken])

  // If user lands on a Supabase recovery link, access/refresh tokens can be stored in URL hash or query.
  // We need to persist them into localStorage so the rest of the app can treat the user as logged in.
  // If it's a password recovery reset link, we should NOT auto-login; instead show a "set new password" UI.
  useEffect(() => {
    if (localStorage.getItem('tikgen.accessToken')) return
    const hs = parseSessionFromUrl()
    if (!hs?.access_token) return
    if (hs.type !== 'recovery' && !hs?.refresh_token) return
    try {
      if (hs.type === 'recovery') {
        setRecoveryAccessToken(hs.access_token)
        setAuthMode('recoverReset')
        setPage('auth')
        return
      }
      saveSession(hs)
      setAccessToken(hs.access_token)
      setPage('home')
    } catch {
      // ignore and let apiMe handle it
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = () => {
    clearSession()
    setAccessToken('')
    setUser(null)
    setPage('landing')
  }

  const currentPackage = useMemo(() => packageCatalog.find((p) => p.plan_id === user?.package) || DEFAULT_PACKAGES.find((p) => p.plan_id === user?.package), [packageCatalog, user?.package])
  const isDevAdmin = useMemo(() => {
    const email = String(user?.email || '').toLowerCase()
    return ['haoxue2027@gmail.com'].includes(email)
  }, [user?.email])

  useEffect(() => {
    if (!isDevAdmin && mainNav === 'developer') {
      setMainNav('create')
      setCreateNav('video')
    }
  }, [isDevAdmin, mainNav])

  useEffect(() => {
    if (!accessToken || page !== 'home') return
    if (assetsWarmupDoneForToken === accessToken) return
    assetsWarmupDoneForToken = accessToken

    let cancelled = false
    const run = () => {
      if (cancelled) return
      void prefetchAssetsCacheIfNeeded()
    }

    const ric = (window as any).requestIdleCallback
    const cic = (window as any).cancelIdleCallback
    let idleId: any = null
    let timerId: any = null
    if (typeof ric === 'function') idleId = ric(run, { timeout: 1200 })
    else timerId = setTimeout(run, 300)

    return () => {
      cancelled = true
      if (idleId != null && typeof cic === 'function') cic(idleId)
      if (timerId != null) clearTimeout(timerId)
    }
  }, [accessToken, page])

  useEffect(() => {
    if (page !== 'home') return
    ;(async () => {
      try {
        const r = await listPackageConfigsPublic()
        const rows = (r.configs || []).filter((x) => x.enabled !== false)
        if (rows.length) setPackageCatalog(rows)
      } catch {
        // ignore package catalog fetch errors
      }
    })()
  }, [page])

  const currentPageLabel = useMemo(() => {
    if (mainNav === 'create') return createNav === 'video' ? '视频生成' : '图片生成'
    if (mainNav === 'templates') return '模板与案例库'
    if (mainNav === 'tasks') return '任务中心'
    if (mainNav === 'tools') return toolNav === 'subtitle' ? '去字幕' : toolNav === 'watermark' ? '去水印' : '画质提升'
    if (mainNav === 'assets') return '资产库'
    if (mainNav === 'benefits') return '个人权益'
    if (mainNav === 'developer' && isDevAdmin) return '开发者后台'
    return '视频生成'
  }, [mainNav, createNav, toolNav, isDevAdmin])

  const ANN_READ_KEY = user?.id ? `tikgen.ann.read.${user.id}` : 'tikgen.ann.read.guest'

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ANN_READ_KEY) || '[]'
      const ids = JSON.parse(raw)
      setReadAnnouncementIds(Array.isArray(ids) ? ids.map(String) : [])
    } catch {
      setReadAnnouncementIds([])
    }
  }, [ANN_READ_KEY])

  const unreadCount = useMemo(() => {
    const readSet = new Set(readAnnouncementIds.map(String))
    return announcements.filter((a) => !readSet.has(String(a.id))).length
  }, [announcements, readAnnouncementIds])

  const markAnnouncementsRead = () => {
    const ids = announcements.map((a) => String(a.id))
    setReadAnnouncementIds(ids)
    try {
      localStorage.setItem(ANN_READ_KEY, JSON.stringify(ids))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!accessToken) return
    ;(async () => {
      try {
        setAnnBusy(true)
        const planId = String(user?.package || 'all')
        const r = await listAnnouncementsPublic(planId)
        setAnnouncements(Array.isArray(r.announcements) ? r.announcements : [])
      } catch {
        setAnnouncements([])
      } finally {
        setAnnBusy(false)
      }
    })()
  }, [accessToken, user?.package])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('tikgen.nav.collapsed.v1')
      setNavCollapsed(raw === '1')
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('tikgen.nav.collapsed.v1', navCollapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [navCollapsed])

  useEffect(() => {
    if (!showAnnouncements) return
    const onPointerDown = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null
      if (!target) return
      if (announcementsRef.current?.contains(target)) return
      setShowAnnouncements(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [showAnnouncements])

  if (page === 'landing')
    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="fixed top-0 left-0 right-0 z-50 bg-black/20 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3"><div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div><span className="text-xl font-bold text-white">TikGen AI</span></div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                setAuthMode('login')
                setPage('auth')
              }}
              className="px-4 py-2 text-white/80 hover:text-white"
            >
              登录
            </button>
            <button
              onClick={() => {
                setAuthMode('register')
                setPage('auth')
              }}
              className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-lg font-medium"
            >
              注册
            </button>
          </div>
        </div>
      </div>
      <div className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold text-white mb-8">AI驱动的内容创作<br/><span className="bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 bg-clip-text text-transparent">释放无限创意</span></h1>
          <p className="text-xl text-white/70 mb-12">集成OpenAI Sora、Google Veo、字节Seedance等顶尖AI模型</p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => {
                setAuthMode('login')
                setPage('auth')
              }}
              className="px-8 py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl font-bold text-lg"
            >
              立即开始创作
            </button>
            <button className="px-8 py-4 bg-white/10 text-white rounded-xl font-bold text-lg border border-white/20 hover:bg-white/15">
              观看演示
            </button>
          </div>
        </div>
      </div>
      <div className="py-20 px-6 bg-black/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-16">核心功能</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10"><div className="w-14 h-14 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center mb-6"><Video className="w-7 h-7 text-white" /></div><h3 className="text-xl font-bold text-white mb-4">AI视频生成</h3><p className="text-white/60">输入文案自动生成视频</p></div>
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10"><div className="w-14 h-14 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center mb-6"><Image className="w-7 h-7 text-white" /></div><h3 className="text-xl font-bold text-white mb-4">AI图片生成</h3><p className="text-white/60">文字描述生成精美图片</p></div>
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10"><div className="w-14 h-14 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-xl flex items-center justify-center mb-6"><Sparkles className="w-7 h-7 text-white" /></div><h3 className="text-xl font-bold text-white mb-4">智能提示词</h3><p className="text-white/60">GPT-4o 自动解析商品并生成脚本/提示词</p></div>
          </div>
          <div className="grid md:grid-cols-3 gap-6 mt-10">
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 text-white">
                <ShieldCheck className="w-5 h-5 text-emerald-300" />
                <span className="font-semibold">企业级稳定</span>
              </div>
              <p className="text-white/60 mt-2 text-sm">任务式生成 + 进度轮询，支持异步产出。</p>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 text-white">
                <WandSparkles className="w-5 h-5 text-pink-300" />
                <span className="font-semibold">一键工作流</span>
              </div>
              <p className="text-white/60 mt-2 text-sm">参考图 → 商品解析 → 脚本 → 提示词 → 生成。</p>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 text-white">
                <Library className="w-5 h-5 text-indigo-300" />
                <span className="font-semibold">资产沉淀</span>
              </div>
              <p className="text-white/60 mt-2 text-sm">本地上传与AI生成素材自动归档到资产库。</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (page === 'auth')
    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <button onClick={() => setPage('landing')} className="text-white/60 mb-8 flex items-center hover:text-white">
          <ChevronRight className="w-5 h-5 rotate-180 mr-1" /> 返回
        </button>
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 border border-white/20">
          <h2 className="text-3xl font-bold text-white text-center mb-8">
            {authMode === 'login' ? '登录账号' : authMode === 'register' ? '注册账号' : '重置密码'}
          </h2>
          <div className="space-y-4">
            <input value={authEmail} onChange={(e)=>setAuthEmail(e.target.value)} type="email" placeholder="邮箱地址" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40" />
            {authMode !== 'recover' && authMode !== 'recoverReset' ? (
              <div className="relative">
                <input
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  type={authShowPassword ? 'text' : 'password'}
                  placeholder="密码"
                  className="w-full px-5 py-4 pr-14 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  aria-label={authShowPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setAuthShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                >
                  {authShowPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            ) : (
              // recoverReset 模式：也要展示新密码输入框
              <div className="relative">
                <input
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  type={authShowPassword ? 'text' : 'password'}
                  placeholder="新密码"
                  className="w-full px-5 py-4 pr-14 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  aria-label={authShowPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setAuthShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                >
                  {authShowPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            )}
            {(authMode === 'register' || authMode === 'recoverReset') && (
              <div className="relative">
                <input
                  value={authPassword2}
                  onChange={(e) => setAuthPassword2(e.target.value)}
                  type={authShowPassword2 ? 'text' : 'password'}
                  placeholder={authMode === 'recoverReset' ? '确认新密码' : '确认密码'}
                  className="w-full px-5 py-4 pr-14 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  aria-label={authShowPassword2 ? '隐藏确认密码' : '显示确认密码'}
                  onClick={() => setAuthShowPassword2((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                >
                  {authShowPassword2 ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            )}
            {authMode === 'login' && (
              <button
                type="button"
                onClick={() => {
                  setAuthError('')
                  setAuthNotice('')
                  setAuthMode('recover')
                }}
                className="w-full text-center text-white/60 hover:text-white text-sm"
              >
                忘记密码？
              </button>
            )}
            <button
              disabled={authBusy}
              onClick={async () => {
                setAuthError('')
                if (authMode === 'register') {
                  const cooldownUntil = Number(localStorage.getItem('tikgen.authCooldownUntil') || 0)
                  if (Date.now() < cooldownUntil) {
                    const minutes = Math.ceil((cooldownUntil - Date.now()) / 60000)
                    return setAuthError(`触发注册限流，请等待 ${minutes} 分钟后再试`)
                  }
                }
                if (!authEmail) return setAuthError('请输入邮箱地址')
                if ((authMode === 'login' || authMode === 'register' || authMode === 'recoverReset') && !authPassword)
                  return setAuthError(authMode === 'recoverReset' ? '请输入新密码' : '请输入密码')
                if ((authMode === 'register' || authMode === 'recoverReset') && authPassword !== authPassword2) return setAuthError('两次密码不一致')
                setAuthBusy(true)
                let keepBusyAfterToken = false
                try {
                  const data =
                    authMode === 'recover'
                      ? await apiRecoverPassword({ email: authEmail })
                      : authMode === 'recoverReset'
                        ? await apiUpdatePassword({ accessToken: recoveryAccessToken, password: authPassword })
                        : authMode === 'register'
                          ? await apiRegister({ email: authEmail, password: authPassword })
                          : await apiLogin({ email: authEmail, password: authPassword })
                  if (authMode === 'register' && data?.needsEmailConfirm) {
                    setAuthMode('login')
                    throw new Error('注册成功：请先去邮箱点击验证链接，然后再回来登录')
                  }
                  if (authMode === 'recover' && data?.success) {
                    setAuthMode('login')
                    setAuthNotice('已发送重置密码邮件，请在 5-10 分钟内检查收件箱/垃圾箱。')
                    return
                  }
                  if (authMode === 'recoverReset' && data?.success) {
                    try {
                      window.location.hash = ''
                    } catch {
                      // ignore
                    }
                    setRecoveryAccessToken('')
                    setAuthPassword('')
                    setAuthPassword2('')
                    setAuthMode('login')
                    setAuthNotice('密码已更新，请使用新密码登录')
                    return
                  }
                  const session = data?.session || null
                  const token = session?.access_token
                  if (!token) throw new Error('登录成功但未返回 token')
                  saveSession(session)
                  Sentry.captureMessage('auth_login_success', { level: 'info', extra: { mode: authMode } })
                  setAccessToken(token)
                  // 登录成功后还需要等 apiMe(accessToken) 完成校验才会跳转首页；
                  // 为了避免按钮文案在等待期间回到“登录”，这里保留 busy 状态，交由 accessToken effect 统一置回。
                  keepBusyAfterToken = true
                } catch (e:any) {
                  const msg = String(e?.message || '登录失败')
                  Sentry.captureException(e, { extra: { scene: 'auth_submit', mode: authMode } })
                  if (authMode === 'register' && msg.toLowerCase().includes('rate limit')) {
                    // Supabase auth has strict anti-abuse limits. We keep a short local cooldown
                    // to prevent repeated requests from the same browser/IP.
                    const cooldownMs = 60 * 60 * 1000
                    localStorage.setItem('tikgen.authCooldownUntil', String(Date.now() + cooldownMs))
                    return setAuthError('触发注册限流，请稍后约 60 分钟再试')
                  }
                  setAuthError(msg)
                } finally {
                  if (!keepBusyAfterToken) setAuthBusy(false)
                }
              }}
              className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl"
            >
              {authBusy
                ? '处理中...'
                : authMode === 'login'
                  ? '登录'
                  : authMode === 'register'
                    ? '注册并登录'
                    : authMode === 'recover'
                      ? '发送重置邮件'
                      : '保存新密码'}
            </button>
            {!!authNotice && <div className="text-sm text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">{authNotice}</div>}
            {!!authError && (
              <div className="text-sm text-red-200 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                {authError}
                {(() => {
                  const msg = String(authError || '')
                  // 兜底：不同 Supabase/不同步骤可能返回略有差异的提示文案
                  const indicatesEmailConfirm =
                    (/邮箱/.test(msg) && /验证/.test(msg)) ||
                    /验证链接/.test(msg) ||
                    /email.*confirm/i.test(msg) ||
                    /not confirmed/i.test(msg) ||
                    /confirmed/i.test(msg)

                  if (!indicatesEmailConfirm) return null
                  return (
                  <div className="mt-3 flex">
                    <button
                      disabled={authResendBusy}
                      onClick={async () => {
                        if (!authEmail) return setAuthError('请输入邮箱地址后再重发')
                        setAuthError('')
                        setAuthNotice('')
                        setAuthResendBusy(true)
                        try {
                          await apiResendSignup({ email: authEmail })
                          setAuthNotice('已重新发送邮箱验证，请稍后查收（可能在垃圾箱/Promotion）')
                        } catch (e: any) {
                          setAuthError(e?.message || '重发失败')
                        } finally {
                          setAuthResendBusy(false)
                        }
                      }}
                      className="w-full py-2 rounded-lg text-sm bg-red-500/20 border border-red-500/30 text-red-100 hover:bg-red-500/30 disabled:opacity-50"
                    >
                      {authResendBusy ? '重发中...' : '重新发送验证邮件'}
                    </button>
                  </div>
                  )
                })()}
              </div>
            )}
            <div className="text-center text-white/60 text-sm">
              {authMode === 'login' ? (
                <button className="hover:text-white" onClick={() => setAuthMode('register')}>
                  没有账号？去注册
                </button>
              ) : authMode === 'register' ? (
                <button className="hover:text-white" onClick={() => setAuthMode('login')}>
                  已有账号？去登录
                </button>
              ) : (
                <button className="hover:text-white" onClick={() => setAuthMode('login')}>
                  返回登录
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const refreshCurrentUser = async () => {
    if (!accessToken) return
    try {
      const me = await apiMe(accessToken)
      const plan = me?.subscription?.planId || 'trial'
      const end = me?.subscription?.currentPeriodEnd ? String(me.subscription.currentPeriodEnd).slice(0, 10) : ''
      setUser({
        id: me?.user?.id,
        name: me?.user?.name || me?.user?.email || '用户',
        email: me?.user?.email,
        credits: 0,
        package: plan,
        packageExpiresAt: end,
      })
    } catch {
      // ignore refresh failures in manual action
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex workbench-root">
      <aside className={`${navCollapsed ? 'w-20' : 'w-64'} bg-white shadow-xl fixed h-full z-30 transition-all relative`}>
        <div className="p-4 border-b">
          <div className={`flex items-center ${navCollapsed ? 'justify-center' : 'justify-between'}`}>
            {!navCollapsed ? (
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div>
                <span className="text-xl font-bold bg-gradient-to-r from-pink-600 to-purple-600 bg-clip-text text-transparent">TikGen AI</span>
              </div>
            ) : (
              <div className="w-10 h-10" aria-hidden="true" />
            )}
          </div>
        </div>
        <button
          onClick={() => setNavCollapsed((v) => !v)}
          className={`absolute top-5 ${navCollapsed ? 'left-1/2 -translate-x-1/2' : 'right-3'} w-7 h-7 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/80`}
          title={navCollapsed ? '展开导航' : '收起导航'}
          aria-label={navCollapsed ? '展开导航' : '收起导航'}
        >
          {navCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
        </button>
        <nav className={`p-3 space-y-2 ${navCollapsed ? 'items-center' : ''}`}>
          <NavPrimary collapsed={navCollapsed} icon={<Wand2 className="w-5 h-5" />} label="创作" active={mainNav === 'create'} onClick={() => setMainNav('create')} />
          {!navCollapsed && mainNav === 'create' && (
            <div className="pl-3 space-y-1">
              <NavSecondary collapsed={false} icon={<Video className="w-4 h-4" />} label="视频生成" active={createNav === 'video'} onClick={() => setCreateNav('video')} />
              <NavSecondary collapsed={false} icon={<Image className="w-4 h-4" />} label="图片生成" active={createNav === 'image'} onClick={() => setCreateNav('image')} />
            </div>
          )}

          <NavPrimary collapsed={navCollapsed} icon={<Library className="w-5 h-5" />} label="模板库" active={mainNav === 'templates'} onClick={() => setMainNav('templates')} />
          <NavPrimary collapsed={navCollapsed} icon={<Library className="w-5 h-5" />} label="任务中心" active={mainNav === 'tasks'} onClick={() => setMainNav('tasks')} />
          <NavPrimary collapsed={navCollapsed} icon={<Settings2 className="w-5 h-5" />} label="工具" active={mainNav === 'tools'} onClick={() => setMainNav('tools')} />
          {!navCollapsed && mainNav === 'tools' && (
            <div className="pl-3 space-y-1">
              <NavSecondary collapsed={false} icon={<Scissors className="w-4 h-4" />} label="去字幕" active={toolNav === 'subtitle'} onClick={() => setToolNav('subtitle')} />
              <NavSecondary collapsed={false} icon={<Eraser className="w-4 h-4" />} label="去水印" active={toolNav === 'watermark'} onClick={() => setToolNav('watermark')} />
              <NavSecondary collapsed={false} icon={<WandSparkles className="w-4 h-4" />} label="画质提升" active={toolNav === 'upscale'} onClick={() => setToolNav('upscale')} />
            </div>
          )}

          <NavPrimary
            collapsed={navCollapsed}
            icon={<Folder className="w-5 h-5" />}
            label="资产库"
            active={mainNav === 'assets'}
            onMouseEnter={() => {
              void prefetchAssetsCacheIfNeeded()
            }}
            onClick={() => setMainNav('assets')}
          />
          <NavPrimary collapsed={navCollapsed} icon={<Crown className="w-5 h-5" />} label="个人权益" active={mainNav === 'benefits'} onClick={() => setMainNav('benefits')} />
          {isDevAdmin && <NavPrimary collapsed={navCollapsed} icon={<ShieldCheck className="w-5 h-5" />} label="开发者后台" active={mainNav === 'developer'} onClick={() => setMainNav('developer')} />}
        </nav>
      </aside>
      <main className={`flex-1 ${navCollapsed ? 'ml-20' : 'ml-64'} transition-all`}>
        <header className="bg-white shadow-sm sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold">
                {mainNav === 'create' && createNav === 'video' && '视频生成'}
                {mainNav === 'create' && createNav === 'image' && '图片生成'}
                {mainNav === 'templates' && '模板与案例库'}
                {mainNav === 'tasks' && '任务中心'}
                {mainNav === 'tools' && (toolNav === 'subtitle' ? '去字幕' : toolNav === 'watermark' ? '去水印' : '画质提升')}
                {mainNav === 'assets' && '资产库'}
                {mainNav === 'benefits' && '个人权益'}
                {mainNav === 'developer' && isDevAdmin && '开发者后台'}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div ref={announcementsRef} className="relative">
                <button
                  onClick={() => {
                    const next = !showAnnouncements
                    setShowAnnouncements(next)
                    if (next) markAnnouncementsRead()
                  }}
                  className="workbench-topicon-btn p-2 rounded-lg"
                  title="公告通知"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-pink-500 text-white text-[10px] leading-4 text-center">{Math.min(unreadCount, 9)}</span>}
                </button>
                {showAnnouncements && (
                  <div className="workbench-ann-panel absolute right-0 mt-2 w-96 max-h-96 overflow-auto bg-white border rounded-xl shadow-xl z-30 p-3">
                    <div className="text-sm font-semibold mb-2">公告中心</div>
                    {annBusy ? (
                      <div className="text-xs text-gray-500 py-2">加载中...</div>
                    ) : announcements.length === 0 ? (
                      <div className="text-xs text-gray-500 py-2">暂无公告</div>
                    ) : (
                      <div className="space-y-2">
                        {announcements.slice(0, 20).map((a) => (
                          <div key={a.id} className="workbench-ann-item border rounded-lg p-2.5">
                            <div className="text-sm font-medium">{a.title || '公告'}</div>
                            <div className="text-xs text-gray-500 mt-1">{String(a.published_at || a.created_at || '').slice(0, 10)}</div>
                            <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap line-clamp-3">{a.content}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button onClick={() => setShowFeedback(true)} className="workbench-topicon-btn p-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700" title="工单/客服">
                <MessageSquare className="w-5 h-5" />
              </button>
              <button onClick={() => setShowHelp(true)} className="workbench-topicon-btn p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700" title="帮助中心">
                <Library className="w-5 h-5" />
              </button>
              <div className="flex items-center space-x-2 bg-gradient-to-r from-pink-50 to-purple-50 px-4 py-2 rounded-full"><Zap className="w-5 h-5 text-pink-500" /><span className="font-bold text-pink-600">{user?.credits}</span><span className="text-sm text-pink-500">积分</span></div>
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-amber-50 rounded-full">
                <Crown className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium text-amber-700">{currentPackage?.name}</span>
                <span className="text-xs text-amber-600/80">至 {user?.packageExpiresAt}</span>
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu((v) => !v)}
                  className="flex items-center space-x-2 px-2 py-1 rounded-lg hover:bg-gray-100"
                >
                  <div className="workbench-user-avatar w-8 h-8 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm font-medium">{user?.name}</span>
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-36 bg-white border rounded-lg shadow-lg z-30 p-1">
                    <button
                      onClick={() => {
                        setShowUserMenu(false)
                        handleLogout()
                      }}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 text-sm text-gray-700 flex items-center"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <div className="p-6">
          {/* Keep generators mounted so in-flight tasks survive nav switches. */}
          <div className={mainNav === 'create' && createNav === 'video' ? '' : 'hidden'}>
            <VideoGenerator templatePreset={videoTemplatePreset} onTemplateApplied={() => setVideoTemplatePreset(null)} />
          </div>
          <div className={mainNav === 'create' && createNav === 'image' ? '' : 'hidden'}>
            <ImageGenerator templatePreset={imageTemplatePreset} onTemplateApplied={() => setImageTemplatePreset(null)} />
          </div>
          {mainNav === 'templates' && (
            <TemplatesLibrary
              onApplyVideo={(preset) => {
                setVideoTemplatePreset(preset)
                setCreateNav('video')
                setMainNav('create')
              }}
              onApplyImage={(preset) => {
                setImageTemplatePreset(preset)
                setCreateNav('image')
                setMainNav('create')
              }}
            />
          )}
          {mainNav === 'assets' && <Assets />}
          {mainNav === 'benefits' && <Packages user={user} onRefreshUser={refreshCurrentUser} packages={packageCatalog} />}
          {mainNav === 'tasks' && <TaskCenter />}
          {mainNav === 'tools' && <div className="text-center py-20 text-gray-500">工具功能下一版推出</div>}
          {mainNav === 'developer' && isDevAdmin && <DeveloperConsole />}
        </div>
      </main>
      <FeedbackLite open={showFeedback} onClose={() => setShowFeedback(false)} currentPage={currentPageLabel} />
      {showHelp && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">帮助中心</h3>
              <button onClick={() => setShowHelp(false)} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <HelpCenter />
          </div>
        </div>
      )}
    </div>
  )
}

function NavPrimary({ icon, label, active, onClick, onMouseEnter, collapsed }: any) {
  return (
    <button
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center ${collapsed ? 'justify-center px-2' : 'space-x-3 px-4'} py-3 rounded-xl transition-all ${
        active ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
      {!collapsed && <span className="font-medium">{label}</span>}
    </button>
  )
}

function NavSecondary({ icon, label, active, onClick, collapsed }: any) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center space-x-2 px-4 py-2 rounded-lg transition-all text-sm ${
        active ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </button>
  )
}

function TemplatesLibrary({
  onApplyVideo,
  onApplyImage,
}: {
  onApplyVideo: (preset: VideoTemplatePreset) => void
  onApplyImage: (preset: ImageTemplatePreset) => void
}) {
  const [tab, setTab] = useState<'video' | 'image'>('video')

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-sm border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">模板与案例库</h2>
            <p className="text-sm text-gray-500 mt-1">选择模板后一键套用到创作页，快速开始生成。</p>
          </div>
          <div className="inline-flex rounded-xl border bg-gray-50 p-1">
            <button
              className={`px-4 py-2 rounded-lg text-sm ${tab === 'video' ? 'bg-white shadow text-purple-700' : 'text-gray-600'}`}
              onClick={() => setTab('video')}
            >
              视频模板
            </button>
            <button
              className={`px-4 py-2 rounded-lg text-sm ${tab === 'image' ? 'bg-white shadow text-purple-700' : 'text-gray-600'}`}
              onClick={() => setTab('image')}
            >
              图片模板
            </button>
          </div>
        </div>
      </div>

      {tab === 'video' && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {VIDEO_TEMPLATES.map((t) => (
            <div key={t.id} className="bg-white rounded-2xl border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{t.title}</h3>
                <span className="text-xs px-2 py-1 rounded-full bg-purple-50 text-purple-700">视频</span>
              </div>
              <p className="text-sm text-gray-600 mt-2 min-h-[40px]">{t.subtitle}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {t.tags.map((x) => (
                  <span key={x} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                    {x}
                  </span>
                ))}
              </div>
              <button
                className="mt-4 w-full py-2.5 rounded-lg bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm font-medium"
                onClick={() => onApplyVideo(t.preset)}
              >
                一键套用到视频生成
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'image' && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {IMAGE_TEMPLATES.map((t) => (
            <div key={t.id} className="bg-white rounded-2xl border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{t.title}</h3>
                <span className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">图片</span>
              </div>
              <p className="text-sm text-gray-600 mt-2 min-h-[40px]">{t.subtitle}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {t.tags.map((x) => (
                  <span key={x} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                    {x}
                  </span>
                ))}
              </div>
              <button
                className="mt-4 w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-sm font-medium"
                onClick={() => onApplyImage(t.preset)}
              >
                一键套用到图片生成
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FeedbackLite({
  open,
  onClose,
  currentPage,
}: {
  open: boolean
  onClose: () => void
  currentPage: string
}) {
  const [kind, setKind] = useState<'bug' | 'suggestion' | 'other'>('bug')
  const [desc, setDesc] = useState('')
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [recentTickets, setRecentTickets] = useState<SupportTicketItem[]>([])
  const [legacyCount, setLegacyCount] = useState(0)

  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const r = await listMySupportTickets(8)
        setRecentTickets(r.tickets || [])
      } catch (e: any) {
        setNotice(e?.message || '获取工单失败，请稍后重试')
        setRecentTickets([])
      }
      try {
        const raw = localStorage.getItem('tikgen.support.tickets.v1')
        const parsed = raw ? JSON.parse(raw) : []
        setLegacyCount(Array.isArray(parsed) ? parsed.length : 0)
      } catch {
        setLegacyCount(0)
      }
    })()
  }, [open])

  if (!open) return null

  const statusLabel: Record<string, string> = { open: '待处理', in_progress: '处理中', resolved: '已解决', closed: '已关闭' }
  const kindLabel: Record<string, string> = { bug: 'Bug/报错', suggestion: '功能建议', other: '其他' }

  const handleSubmit = async () => {
    if (!desc.trim()) {
      setNotice('请先填写问题描述')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const subject = `[${kindLabel[kind] || '反馈'}] ${currentPage}`
      const r = await createSupportTicket({
        kind,
        subject,
        content: desc.trim(),
        email: email.trim(),
        page: currentPage,
      })
      setNotice(`工单 ${r.ticket.ticket_no} 已提交，我们会尽快处理。`)
      setDesc('')
      const list = await listMySupportTickets(8)
      setRecentTickets(list.tickets || [])
    } catch (e: any) {
      setNotice(e?.message || '提交工单失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl border shadow-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-xl font-bold">工单/客服入口（轻量版）</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">问题类型</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg">
              <option value="bug">Bug/报错</option>
              <option value="suggestion">功能建议</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">问题描述</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={5} className="w-full px-3 py-2 border rounded-lg" placeholder="请描述复现步骤、期望结果、实际结果..." />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">联系邮箱（可选）</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="用于客服回访" />
          </div>
          {!!notice && <div className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg p-2">{notice}</div>}
          <div className="rounded-xl border p-3 bg-gray-50">
            <div className="text-sm font-semibold text-gray-800 mb-2">最近工单（服务端）</div>
            {recentTickets.length === 0 ? (
              <div className="text-xs text-gray-500">暂无记录</div>
            ) : (
              <div className="space-y-2 max-h-36 overflow-y-auto">
                {recentTickets.map((t) => (
                  <div key={t.id} className="text-xs bg-white border rounded-lg p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700">{t.ticket_no}</span>
                      <span className="text-gray-500">{new Date(t.created_at).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{kindLabel[t.kind] || t.kind}</span>
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{statusLabel[t.status] || t.status}</span>
                    </div>
                    <div className="text-gray-600 mt-1">{t.content.slice(0, 40) || '(空)'}{t.content.length > 40 ? '...' : ''}</div>
                    {t.admin_note ? <div className="mt-1 text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">官方回复：{t.admin_note}</div> : null}
                  </div>
                ))}
              </div>
            )}
            {legacyCount > 0 ? <div className="mt-2 text-[11px] text-gray-500">本机历史记录 {legacyCount} 条（旧版）。</div> : null}
          </div>
        </div>
        <div className="p-5 border-t flex items-center justify-between">
          <div className="text-xs text-gray-500">提交后可在此处查看处理状态</div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 border rounded-lg">取消</button>
            <button disabled={busy} onClick={handleSubmit} className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-50">
              {busy ? '提交中...' : '提交工单'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HelpCenter() {
  const [keyword, setKeyword] = useState('')
  const faqSections = [
    {
      title: '账号与登录',
      items: [
        { q: '登录提示 Invalid login credentials 怎么办？', a: '确认账号密码；若忘记密码请使用“忘记密码”；若刚注册请先完成邮箱验证。' },
        { q: '点击重置密码邮件后没有进入设置新密码页面？', a: '建议使用无痕窗口打开链接；若仍异常，请附上截图与链接参数反馈。' },
      ],
    },
    {
      title: '图片/视频生成',
      items: [
        { q: '模型不可用怎么处理？', a: '切换到标记为可用的模型后重试；优先选择非“暂不可用”模型。' },
        { q: '生成超时怎么办？', a: '先去任务中心查看状态；若失败可点击“重试（保留参数）”，必要时降低分辨率/时长。' },
        { q: 'DALL·E 3 尺寸错误怎么办？', a: '该模型只支持固定三档尺寸。系统已自动映射，刷新后重试即可。' },
      ],
    },
    {
      title: '额度与套餐',
      items: [
        { q: '提示“今日额度已用尽”怎么办？', a: '说明已达到当日上限，可升级套餐或等待次日恢复。' },
      ],
    },
  ]

  const errorCodeGuide = [
    { code: 'MODEL_UNAVAILABLE', action: '切换可用模型后重试。' },
    { code: 'QUOTA_EXHAUSTED', action: '升级套餐或等待次日额度恢复。' },
    { code: 'UPSTREAM_TIMEOUT', action: '稍后重试，必要时降低分辨率/时长。' },
    { code: 'UPSTREAM_NO_TASKID', action: '上游返回异常，建议重试并保留 request id。' },
    { code: 'NO_OUTPUT', action: '上游未返回结果，建议更换模型重试。' },
    { code: 'UNKNOWN', action: '复制完整报错与任务ID，通过反馈入口提交。' },
  ]

  const kw = keyword.trim().toLowerCase()
  const filteredSections = faqSections
    .map((sec) => ({ ...sec, items: sec.items.filter((it) => !kw || `${it.q} ${it.a}`.toLowerCase().includes(kw)) }))
    .filter((sec) => sec.items.length > 0)

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border p-6 shadow-sm">
        <h2 className="text-xl font-bold">帮助中心 / FAQ</h2>
        <p className="text-sm text-gray-500 mt-1">先搜索关键词；仍无法解决可点击右上角“工单/客服”。</p>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索关键词（登录失败、额度、模型不可用、超时）"
          className="w-full mt-4 px-4 py-2.5 border rounded-lg"
        />
      </div>

      <div className="bg-white rounded-2xl border p-6 shadow-sm">
        <h3 className="font-semibold mb-3">错误码对照</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {errorCodeGuide.map((x) => (
            <div key={x.code} className="rounded-lg border p-3 bg-gray-50">
              <div className="text-sm font-medium text-gray-900">{x.code}</div>
              <div className="text-sm text-gray-600 mt-1">{x.action}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {filteredSections.map((sec) => (
          <div key={sec.title} className="bg-white rounded-2xl border p-6 shadow-sm">
            <h3 className="font-semibold mb-3">{sec.title}</h3>
            <div className="space-y-3">
              {sec.items.map((item, idx) => (
                <details key={`${sec.title}-${idx}`} className="group border rounded-lg p-3">
                  <summary className="cursor-pointer font-medium text-gray-900">{item.q}</summary>
                  <p className="text-sm text-gray-600 mt-2 leading-6">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        ))}
        {filteredSections.length === 0 && <div className="bg-white rounded-2xl border p-8 text-center text-gray-500">没有匹配到结果，可换关键词试试。</div>}
      </div>
    </div>
  )
}

function VideoGenerator({
  templatePreset,
  onTemplateApplied,
}: {
  templatePreset: VideoTemplatePreset | null
  onTemplateApplied: () => void
}) {
  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState('')
  const [refImageDataUrl, setRefImageDataUrl] = useState('')
  const [refImages, setRefImages] = useState<Array<{ id: string; url: string; name?: string; source: 'local' | 'asset' }>>([])
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [assetTab, setAssetTab] = useState<'user_upload' | 'ai_generated'>('user_upload')
  const [assetList, setAssetList] = useState<AssetItem[]>([])
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetSelectedIds, setAssetSelectedIds] = useState<Set<string>>(new Set())
  const assetCacheRef = useRef<{ user_upload: AssetItem[] | null; ai_generated: AssetItem[] | null }>({ user_upload: null, ai_generated: null })
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('sora-2')
  const [size, setSize] = useState<VideoAspect>('9:16')
  const [resolution, setResolution] = useState<VideoRes>('720p')
  const [durationSec, setDurationSec] = useState<VideoDur>(10)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedVideo, setGeneratedVideo] = useState('')
  const [taskId, setTaskId] = useState('')
  const [progress, setProgress] = useState('0%')
  const [statusText, setStatusText] = useState('')
  const [errorText, setErrorText] = useState('')
  const [errorCode, setErrorCode] = useState('UNKNOWN')
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [productInfo, setProductInfo] = useState<ProductInfo>({ name: '', category: '', sellingPoints: '', targetAudience: '', language: '简体中文' })
  const [scripts, setScripts] = useState<string[]>([])
  const [scriptBatches, setScriptBatches] = useState<string[][]>([])
  const [scriptBatchIdx, setScriptBatchIdx] = useState(0)
  const [scriptRefreshCount, setScriptRefreshCount] = useState(0)
  const [selectedScript, setSelectedScript] = useState('')
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [isAiBusy, setIsAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [unavailableVideoMap, setUnavailableVideoMap] = useState<Record<string, string>>({})
  const stopPollingRef = useRef(false)
  const aiJobRef = useRef(0)

  useEffect(() => {
    ;(async () => {
      try {
        const token = localStorage.getItem('tikgen.accessToken') || ''
        if (!token) return
        const r = await getModelAvailabilityAPI(token)
        const map: Record<string, string> = {}
        for (const x of r.video || []) map[String(x.id)] = String(x.reason || '暂不可用')
        try {
          const resp = await fetch('/api/model-controls?type=video')
          const data = await resp.json()
          if (data?.success && Array.isArray(data.controls)) {
            let recommended = ''
            for (const c of data.controls) {
              const id = String(c.model_id || '')
              if (!id) continue
              if (c.enabled === false) map[id] = String(c.note || '后台已禁用')
              if (!recommended && c.recommended === true && c.enabled !== false) recommended = id
            }
            if (recommended && VIDEO_MODELS.some((m) => m.id === recommended)) setModel(recommended)
          }
        } catch {
          // ignore controls loading failures
        }
        setUnavailableVideoMap(map)
      } catch {
        // ignore
      }
    })()
  }, [])

  // NOTE: 能力探测会触发聚合API计费请求，已在后端默认禁用。

  const caps = useMemo<VideoModelCaps>(() => {
    const base =
      VIDEO_MODEL_CAPS[model] || {
        aspectRatios: ['9:16', '16:9'],
        resolutions: ['720p', '1080p'],
        durations: [10, 15],
        defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 },
      }
    return base
  }, [model])

  // 模型切换时：如果当前选择不被支持，自动回落到该模型默认值
  useEffect(() => {
    if (!caps.aspectRatios.includes(size)) setSize(caps.defaults.aspectRatio)
    if (!caps.resolutions.includes(resolution)) setResolution(caps.defaults.resolution)
    if (!caps.durations.includes(durationSec)) setDurationSec(caps.defaults.durationSec)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  useEffect(() => {
    if (!templatePreset) return
    if (templatePreset.model) setModel(String(templatePreset.model))
    if (templatePreset.aspectRatio) setSize(String(templatePreset.aspectRatio) as VideoAspect)
    if (templatePreset.resolution) setResolution(String(templatePreset.resolution) as VideoRes)
    if (templatePreset.durationSec) setDurationSec(Number(templatePreset.durationSec) as VideoDur)
    setPrompt(String(templatePreset.prompt || ''))
    onTemplateApplied()
  }, [templatePreset, onTemplateApplied])

  const renderScriptStructured = (raw: string) => {
    let text = String(raw || '')
    // 兼容服务端/模型偶发把 {"scripts":[...]} 整段塞进单条脚本
    if (text.trim().startsWith('{') && text.includes('"scripts"')) {
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed?.scripts) && parsed.scripts[0]) text = String(parsed.scripts[0])
      } catch {
        // ignore
      }
    }

    // 兼容 [镜头1]/[开场钩子] + 英文管道符
    text = text
      .replace(/\[开场钩子\]/g, '【开场钩子】')
      .replace(/\[收尾CTA\]/g, '【收尾CTA】')
      .replace(/\[镜头(\d+)\]/g, '【镜头$1】')
      .replace(/\s*\|\s*/g, '｜')

    // 一次性解决：模型经常把整条脚本输出成“一段话”，但内部含有【镜头X】标记
    // 这里把这些标记强制断行，确保结构化解析稳定
    text = text
      .replace(/\s*(【开场钩子】)/g, '\n$1')
      .replace(/\s*(【镜头\d+】)/g, '\n$1')
      .replace(/\s*(【收尾CTA】)/g, '\n$1')
      .replace(/^\s*\n/, '')
      .replace(/\n{2,}/g, '\n')

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)

    const hook = lines.find((l) => l.includes('【开场钩子】'))?.replace('【开场钩子】', '').trim()
    const cta = lines.find((l) => l.includes('【收尾CTA】'))?.replace('【收尾CTA】', '').trim()
    const shots = lines
      .filter((l) => l.startsWith('【镜头'))
      .map((l) => {
        const m = l.match(/^【镜头(\d+)】(.*)$/)
        const idx = m?.[1] || ''
        const rest = (m?.[2] || '').trim()
        const parts = rest.split('｜').map((p) => p.trim())
        const get = (prefix: string) => parts.find((p) => p.startsWith(prefix))?.slice(prefix.length).trim() || ''
        return { idx, scene: get('画面：'), subtitle: get('字幕：'), voice: get('口播：') }
      })

    return (
      <div className="space-y-3">
        {hook && (
          <div className="rounded-xl bg-white/60 border border-purple-200 p-3">
            <div className="text-xs text-purple-600 font-medium mb-1">开场钩子</div>
            <div className="text-sm text-gray-900">{hook}</div>
          </div>
        )}
        {shots.length > 0 && (
          <div className="rounded-xl bg-white/60 border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-gray-600">镜头清单</div>
            <div className="divide-y">
              {shots.map((s, i) => (
                <div key={i} className="p-3 grid grid-cols-12 gap-3">
                  <div className="col-span-2">
                    <div className="inline-flex items-center px-2 py-1 rounded-lg bg-purple-100 text-purple-700 text-xs font-semibold">
                      镜头{s.idx || i + 1}
                    </div>
                  </div>
                  <div className="col-span-10 space-y-1 text-sm">
                    {s.scene && <div><span className="text-gray-500">画面：</span><span className="text-gray-900">{s.scene}</span></div>}
                    {s.subtitle && <div><span className="text-gray-500">字幕：</span><span className="text-gray-900">{s.subtitle}</span></div>}
                    {s.voice && <div><span className="text-gray-500">口播：</span><span className="text-gray-900">{s.voice}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {cta && (
          <div className="rounded-xl bg-white/60 border border-emerald-200 p-3">
            <div className="text-xs text-emerald-700 font-medium mb-1">收尾 CTA</div>
            <div className="text-sm text-gray-900">{cta}</div>
          </div>
        )}
        {(shots.length === 0 || !cta) && raw && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <div className="text-xs font-medium text-amber-700 mb-1">原文（未完整解析为分镜）</div>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">{raw}</div>
          </div>
        )}
      </div>
    )
  }

  useEffect(() => {
    return () => {
      stopPollingRef.current = true
    }
  }, [])

  const handlePromptGen = async () => {
    if (!refImageDataUrl) { alert('请先上传参考图'); return }
    setShowModal(true)
    setModalStep(1)
    setAiError('')
    const jobId = ++aiJobRef.current
    setIsAiBusy(true)
    try {
      const parsed = await parseProductInfo({ refImage: refImageDataUrl, language: productInfo.language || '简体中文', kind: 'video' })
      if (jobId !== aiJobRef.current) return
      setProductInfo(parsed)
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '解析失败')
    } finally {
      if (jobId !== aiJobRef.current) return
      setIsAiBusy(false)
    }
  }

  const handleNext = async () => {
    setAiError('')
    if (modalStep === 1) {
      setModalStep(2)
      const jobId = ++aiJobRef.current
      setIsAiBusy(true)
      try {
        const r = await generateVideoScripts({
          product: productInfo,
          language: productInfo.language,
          refImage: refImageDataUrl,
          durationSec,
          aspectRatio: size,
          resolution,
        })
        if (jobId !== aiJobRef.current) return
        setScripts(r.scripts)
        setScriptBatches([r.scripts])
        setScriptBatchIdx(0)
        setScriptRefreshCount(0)
        setSelectedScript(r.scripts[0] || '')
      } catch (e: any) {
        if (jobId !== aiJobRef.current) return
        setAiError(e?.message || '脚本生成失败')
      } finally {
        if (jobId !== aiJobRef.current) return
        setIsAiBusy(false)
      }
      return
    }
    if (modalStep === 2) {
      setModalStep(3)
      setOptimizedPrompt(selectedScript)
      return
    }
    setShowModal(false)
    setPrompt(optimizedPrompt || selectedScript)
  }

  const handlePrev = () => {
    if (modalStep === 1) return
    if (modalStep === 2) setModalStep(1)
    else setModalStep(2)
  }

  const handleRefreshScripts = async () => {
    if (modalStep !== 2) return
    setAiError('')
    if (scriptBatches.length >= 3) {
      const nextIdx = (scriptBatchIdx + 1) % 3
      setScriptBatchIdx(nextIdx)
      const next = scriptBatches[nextIdx] || []
      setScripts(next)
      setSelectedScript(next[0] || '')
      return
    }

    setIsAiBusy(true)
    const jobId = ++aiJobRef.current
    try {
      const r = await generateVideoScripts({
        product: productInfo,
        language: productInfo.language,
        refImage: refImageDataUrl,
        durationSec,
        aspectRatio: size,
        resolution,
      })
      if (jobId !== aiJobRef.current) return
      setScriptBatches((prev) => [...prev, r.scripts])
      setScriptBatchIdx(scriptBatches.length)
      setScriptRefreshCount((c) => Math.min(2, c + 1))
      setScripts(r.scripts)
      setSelectedScript(r.scripts[0] || '')
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '脚本生成失败')
    } finally {
      if (jobId !== aiJobRef.current) return
      setIsAiBusy(false)
    }
  }

  const handleOptimize = async (tag: string) => {
    const newTags = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
    setTags(newTags)
    setAiError('')
    const jobId = ++aiJobRef.current
    setIsAiBusy(true)
    try {
      const r = await beautifyScript({ script: selectedScript, tags: newTags, language: productInfo.language })
      if (jobId !== aiJobRef.current) return
      setOptimizedPrompt(r.optimized)
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '优化失败')
    } finally {
      if (jobId !== aiJobRef.current) return
      setIsAiBusy(false)
    }
  }

  const handleCloseAiBusy = () => {
    aiJobRef.current += 1 // invalidate in-flight AI responses
    setIsAiBusy(false)
    setAiError('')
    if (modalStep === 1) {
      setShowModal(false)
      return
    }
    if (modalStep === 2) {
      setModalStep(1)
      return
    }
    setModalStep(2)
  }

  const finalVideoPrompt = useMemo(() => {
    const base = optimizedPrompt || selectedScript || prompt
    const info = [
      `[视频参数]`,
      `- 总时长：约 ${durationSec}s`,
      `- 画幅：${size}`,
      `- 分辨率：${resolution}`,
      ``,
      `[商品信息]`,
      `- 名称：${productInfo.name}`,
      `- 类目：${productInfo.category}`,
      `- 核心卖点：${productInfo.sellingPoints}`,
      `- 目标人群：${productInfo.targetAudience}`,
      `- 输出语言：${productInfo.language}`,
    ].join('\n')

    const storyboardScript = String(base || '').trim()

    return [
      '你是电商短视频导演。请生成一条写实的商品展示视频（非动画）。',
      '',
      '【硬性要求】',
      `- 总时长：约 ${durationSec}s（镜头节奏与信息密度必须匹配该时长，避免拖沓或塞不下）`,
      `- 画幅：${size}；分辨率：${resolution}`,
      '- 画面：干净、高级、写实，光影自然；突出商品细节与使用动作/使用场景',
      '- 合规：避免医疗/绝对化/夸大承诺；不出现“保证/治愈/永久/100%”等表述',
      '- 文案展示：不要把整段脚本文字铺满画面；字幕仅保留关键短句即可',
      '',
      '【执行方式】',
      '- 请严格按下方“镜头化脚本”执行：保持镜头顺序、镜头数量、每个镜头的核心含义不变',
      '- 你可以在每个镜头里补充更具体的画面细节（景别/镜头运动/光影/道具/背景），但不要新增虚构参数/功效/价格优惠信息',
      '',
      info,
      '',
      '[镜头化脚本（必须执行）]',
      storyboardScript || '(脚本为空)',
    ].join('\n')
  }, [optimizedPrompt, selectedScript, prompt, productInfo, size, resolution, durationSec])

  const handleGenerate = async () => {
    if (!refImageDataUrl) { alert('请先上传参考图'); return }
    if (!prompt) { alert('请输入视频文案描述'); return }
    stopPollingRef.current = false
    setIsGenerating(true)
    setGeneratedVideo('')
    setErrorText('')
    setErrorCode('UNKNOWN')
    setProgress('0%')
    setStatusText('任务提交中...')
    setTaskId('')

    try {
      const submit = await generateVideoAPI(finalVideoPrompt, model, { aspectRatio: size, durationSec, resolution, refImage: refImageDataUrl })
      setTaskId(submit.taskId)
      setStatusText(submit.message || '视频生成中...')

      for (let i = 0; i < 120; i++) { // 最多轮询约10分钟
        if (stopPollingRef.current) return
        await new Promise(r => setTimeout(r, 5000))
        if (stopPollingRef.current) return

        const s = await checkVideoStatus(submit.taskId)
        setProgress(s.progress || '0%')

        const status = (s.status || '').toLowerCase()
        if (status === 'succeeded' || status === 'success' || status === 'completed') {
          if (!s.videoUrl) throw new Error('任务完成但未返回视频地址')
          setGeneratedVideo(s.videoUrl)
          Sentry.captureMessage('video_generation_success', { level: 'info', extra: { taskId: submit.taskId, model } })
          await safeArchiveAsset({
            source: 'ai_generated',
            type: 'video',
            url: s.videoUrl,
            name: `video-${Date.now()}.mp4`,
            metadata: { from: 'video_generator', model, size, resolution, durationSec },
          })
          setStatusText('生成完成')
          setIsGenerating(false)
          return
        }

        if (status === 'failed' || status === 'error') {
          const err: any = new Error(s.failReason || '生成失败')
          err.code = s.failCode || 'UNKNOWN'
          throw err
        }

        setStatusText(`生成中... ${s.progress || ''}`.trim())
      }

      const err: any = new Error('生成超时，请稍后在任务列表中查看')
      err.code = 'UPSTREAM_TIMEOUT'
      throw err
    } catch (e: any) {
      Sentry.captureException(e, { extra: { scene: 'video_generate', model } })
      setErrorText(e?.message || '生成失败')
      setErrorCode(e?.code || 'UNKNOWN')
      setIsGenerating(false)
      setStatusText('')
    }
  }

  if (showModal) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
          <div className="p-6 border-b flex items-center justify-between"><h3 className="text-xl font-bold">一键生成提示词</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button></div>
          <div className="px-6 py-4 border-b bg-gray-50 flex items-center">
            {['商品信息解析', '视频脚本', '提示词优化'].map((s, i) => (
              <div key={i} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${modalStep > i + 1 ? 'bg-green-500 text-white' : modalStep === i + 1 ? 'bg-purple-500 text-white' : 'bg-gray-300'}`}>
                  {modalStep > i + 1 ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`ml-2 text-sm ${modalStep === i + 1 ? 'font-medium' : 'text-gray-400'}`}>{s}</span>
                {i < 2 && <div className="flex-1 h-0.5 bg-gray-200 mx-4" />}
              </div>
            ))}
          </div>
          <div className="p-6">
            {modalStep === 1 && (
              <div className="space-y-4">
                {refImagePreviewUrl && <img src={refImagePreviewUrl} alt="参考图" className="max-h-40 rounded-lg" />}
                {['name', 'category', 'sellingPoints', 'targetAudience'].map((f) => (
                  <div key={f}>
                    <label className="block text-sm font-medium mb-1">
                      {f === 'name' ? '产品名称' : f === 'category' ? '产品类目' : f === 'sellingPoints' ? '核心卖点' : '目标人群'}
                    </label>
                    <input
                      value={productInfo[f as keyof typeof productInfo]}
                      onChange={(e) => setProductInfo({ ...productInfo, [f]: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-medium mb-1">视频语言</label>
                  <select
                    value={productInfo.language}
                    onChange={(e) => setProductInfo({ ...productInfo, language: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                  >
                    <option>简体中文</option>
                    <option>English</option>
                    <option>日本語</option>
                  </select>
                </div>

                {/* 尺寸/时长已移到主页面参考图下方配置 */}
              </div>
            )}
            {modalStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">选择或编辑视频脚本：</p>
                  <button onClick={handleRefreshScripts} className="text-purple-600 text-sm flex items-center">
                    <RefreshCw className="w-4 h-4 mr-1" /> 换一批
                  </button>
                </div>
                <div className="text-xs text-gray-400">
                  批次：{scriptBatchIdx + 1}/{Math.max(1, scriptBatches.length)}（最多生成3批，之后循环切换）
                </div>
                {scripts.map((s, i) => (
                  <div
                    key={i}
                    className={`p-4 border-2 rounded-lg ${selectedScript === s ? 'border-purple-500 bg-purple-50' : 'border-gray-200'}`}
                    onClick={() => setSelectedScript(s)}
                  >
                    <div className="flex items-start">
                      <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center mr-3 ${selectedScript === s ? 'border-purple-500 bg-purple-500' : 'border-gray-300'}`}>
                        {selectedScript === s && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="w-full">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs text-gray-500">脚本{i + 1}</div>
                          <button
                            className="text-xs text-purple-700 hover:text-purple-800"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingIdx((cur) => (cur === i ? null : i))
                            }}
                          >
                            {editingIdx === i ? '完成编辑' : '编辑'}
                          </button>
                        </div>
                        {editingIdx === i ? (
                          <textarea
                            value={s}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const v = e.target.value
                              setScripts((prev) => prev.map((x, idx) => (idx === i ? v : x)))
                              setScriptBatches((prev) => prev.map((batch, bi) => (bi === scriptBatchIdx ? batch.map((x, idx) => (idx === i ? v : x)) : batch)))
                              if (selectedScript === s) setSelectedScript(v)
                            }}
                            className="w-full bg-white/70 border rounded-xl px-3 py-2 outline-none text-sm leading-6 resize-y"
                            rows={10}
                          />
                        ) : (
                          renderScriptStructured(s)
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {modalStep === 3 && (
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500 mb-2">当前脚本</p>
                  <p className="whitespace-pre-wrap text-sm text-gray-900">{selectedScript}</p>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">提示词美化（风格标签）</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      '真人感',
                      '高端',
                      '简洁',
                      '详实',
                      '电影感',
                      '强钩子',
                      '痛点对比',
                      '测评感',
                      '种草口吻',
                      'TikTok风格',
                      '口播优先',
                      '字幕更强',
                      '价格友好（不报价格）',
                    ].map((tag) => (
                      <button
                        key={tag}
                        onClick={() => handleOptimize(tag)}
                        className={`px-3 py-1 rounded-full text-sm ${
                          tags.includes(tag) ? 'bg-purple-500 text-white' : 'bg-gray-100'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">提示：可多选组合风格；优化会保持镜头结构不变，仅调整表达与镜头语言。</p>
                </div>
                {optimizedPrompt && (
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <p className="text-sm text-purple-600 mb-1">优化后</p>
                    <p className="whitespace-pre-wrap text-sm text-gray-900">{optimizedPrompt}</p>
                  </div>
                )}
              </div>
            )}
            {!!aiError && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{aiError}</div>}
          </div>
          {isAiBusy && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center rounded-2xl">
              <div className="relative bg-white shadow-lg border rounded-2xl px-6 py-5 flex items-center min-w-[360px]">
                <button
                  onClick={handleCloseAiBusy}
                  className="absolute right-3 top-3 p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-white/10"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center">
                  <RefreshCw className="w-5 h-5 text-purple-600 animate-spin mr-3" />
                  <div>
                    <div className="font-medium">
                      {modalStep === 3 ? '视频脚本优化中' : modalStep === 2 ? '视频脚本创作中' : '商品信息AI解析中'}
                    </div>
                    <div className="text-sm text-gray-500">请稍等，预计几秒钟...</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="p-6 border-t flex items-center justify-between">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">取消</button>
            <div className="flex items-center gap-3">
              {modalStep > 1 && (
                <button onClick={handlePrev} className="px-4 py-2 border rounded-lg">上一步</button>
              )}
              <button disabled={isAiBusy} onClick={handleNext} className="px-4 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50">
                {isAiBusy ? '处理中...' : modalStep === 3 ? '确认' : '下一步'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">创建视频</h2>
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">上传参考图</label>
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center relative">
            <input
              type="file"
              accept="image/*"
              onChange={async (e: any) => {
                const f: File | undefined = e.target.files?.[0]
                if (!f) return
                const preview = URL.createObjectURL(f)
                setRefImagePreviewUrl(preview)
                const dataUrl = await fileToDataUrl(f)
                setRefImageDataUrl(dataUrl)
                await safeArchiveAsset({
                  source: 'user_upload',
                  type: 'image',
                  url: dataUrl,
                  name: f.name,
                  metadata: { from: 'video_generator_ref', mime: f.type, size: f.size },
                })
              }}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {refImagePreviewUrl ? (
              <img src={refImagePreviewUrl} alt="参考图" className="max-h-40 mx-auto" />
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto text-gray-400" />
                <p className="text-gray-500 mt-2">点击上传参考图</p>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1">AI模型</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.id} disabled={!!unavailableVideoMap[m.id]}>
                  {m.name}
                  {unavailableVideoMap[m.id] ? '（暂不可用）' : ''}
                </option>
              ))}
            </select>
            {unavailableVideoMap[model] ? <div className="mt-1 text-xs text-amber-600">当前模型暂不可用，请切换其他模型。</div> : null}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">分辨率</label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {caps.resolutions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">视频时长</label>
            <select value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value) as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {caps.durations.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">尺寸</label>
            <select value={size} onChange={(e) => setSize(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {caps.aspectRatios.map((ar) => (
                <option key={ar} value={ar}>
                  {ar}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">视频文案描述</label>
            <button
              onClick={handlePromptGen}
              className="px-3 py-1.5 rounded-full text-sm bg-purple-50 text-purple-700 hover:bg-purple-100 flex items-center"
            >
              <Sparkles className="w-4 h-4 mr-1" /> 一键生成提示词
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full px-4 py-3 border rounded-xl min-h-[140px]"
            placeholder="输入商品卖点/场景/风格，或使用一键生成提示词..."
          />
        </div>
        <button onClick={handleGenerate} disabled={isGenerating || !prompt} className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50">{isGenerating ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin inline" />生成中...</> : '生成视频'}</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">生成结果</h2>
        {isGenerating ? (
          <GenerationLoadingCard
            title={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].video.title}
            subtitle={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].video.subtitle}
            chips={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].video.chips}
            statusText={statusText || '视频生成中...'}
            progressText={`进度：${progress}${taskId ? ` | 任务ID：${taskId}` : ''}`}
          />
        ) : errorText ? (
          <div className="h-96 flex flex-col items-center justify-center text-center bg-red-50 rounded-xl px-6">
            <p className="text-red-600 font-medium">生成失败</p>
            <p className="text-sm text-red-500 mt-2 break-words">{errorText}</p>
            <p className="text-xs text-red-400 mt-2">错误码：{errorCode}</p>
            {errorCode !== 'QUOTA_EXHAUSTED' && (
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="mt-5 px-4 py-2 rounded-lg text-sm bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              >
                重试（保留参数）
              </button>
            )}
            {taskId && <p className="text-xs text-red-400 mt-3 break-all">任务ID：{taskId}</p>}
          </div>
        ) : generatedVideo ? (
          <div>
            <video src={generatedVideo} className="w-full rounded-xl" controls />
            <div className="grid grid-cols-2 gap-4 mt-4">
              <button className="py-3 bg-gray-100 rounded-xl flex items-center justify-center"><Play className="w-5 h-5 mr-2" />预览</button>
              <a href={generatedVideo} download className="py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl flex items-center justify-center">
                <Download className="w-5 h-5 mr-2" />下载
              </a>
            </div>
          </div>
        ) : (
          <div className="h-96 flex items-center justify-center text-gray-400 border-2 border-dashed rounded-xl"><Video className="w-16 h-16 opacity-50" /></div>
        )}
      </div>
    </div>
  )
}

function ImageGenerator({
  templatePreset,
  onTemplateApplied,
}: {
  templatePreset: ImageTemplatePreset | null
  onTemplateApplied: () => void
}) {
  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState('')
  const [refImageDataUrl, setRefImageDataUrl] = useState('')
  const [refImages, setRefImages] = useState<Array<{ id: string; url: string; name?: string; source: 'local' | 'asset' }>>([])
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [assetTab, setAssetTab] = useState<'user_upload' | 'ai_generated'>('user_upload')
  const [assetList, setAssetList] = useState<AssetItem[]>([])
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetSelectedIds, setAssetSelectedIds] = useState<Set<string>>(new Set())
  const [previewRefImage, setPreviewRefImage] = useState<{ url: string; name: string; index: number } | null>(null)
  const assetCacheRef = useRef<{ user_upload: AssetItem[] | null; ai_generated: AssetItem[] | null }>({ user_upload: null, ai_generated: null })
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('nano-banana-2')
  const [size, setSize] = useState<ImageAspect>('1:1')
  const [resolution, setResolution] = useState<ImageRes>('2048')
  const [imageCount, setImageCount] = useState<1 | 2 | 3 | 4>(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedImage, setGeneratedImage] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [productInfo, setProductInfo] = useState<ProductInfo>({ name: '', category: '', sellingPoints: '', targetAudience: '', language: '简体中文' })
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [optimizedNegativePrompt, setOptimizedNegativePrompt] = useState('')
  const [promptParts, setPromptParts] = useState<any>({})
  const [sceneMode, setSceneMode] = useState<'clean' | 'lite'>('clean')
  const [categoryHint, setCategoryHint] = useState('other')
  const [selectedStyleTags, setSelectedStyleTags] = useState<string[]>([])
  const [qcResult, setQcResult] = useState<any>(null)
  const [isQcBusy, setIsQcBusy] = useState(false)
  const [genProgress, setGenProgress] = useState(0)
  const [genErrorText, setGenErrorText] = useState('')
  const [genErrorCode, setGenErrorCode] = useState('UNKNOWN')
  const [isAiBusy, setIsAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const aiJobRef = useRef(0)
  const [imageModels, setImageModels] = useState<{ id: string; name: string }[]>(IMAGE_MODELS)
  const [unavailableImageMap, setUnavailableImageMap] = useState<Record<string, string>>({})
  const imageModelOptions = useMemo(
    () =>
      imageModels.map((m) => ({
        ...m,
        unavailableReason: unavailableImageMap[m.id] || getImageModelUnavailableReason(m.id),
      })),
    [imageModels, unavailableImageMap],
  )
  const MAX_REF_IMAGES = 5

  useEffect(() => {
    const first = refImages[0]?.url || ''
    setRefImagePreviewUrl(first)
    setRefImageDataUrl(first)
  }, [refImages])

  const removeRefImage = (id: string) => {
    setRefImages((prev) => prev.filter((x) => x.id !== id))
  }

  const handleLocalRefUpload = async (files: FileList | null) => {
    if (!files?.length) return
    const remain = Math.max(0, MAX_REF_IMAGES - refImages.length)
    if (remain <= 0) return
    const picked = Array.from(files).slice(0, remain)
    const next: Array<{ id: string; url: string; name?: string; source: 'local' }> = []
    for (const f of picked) {
      const dataUrl = await fileToDataUrl(f)
      next.push({ id: `local_${Date.now()}_${Math.random().toString(16).slice(2)}`, url: dataUrl, name: f.name, source: 'local' })
      await safeArchiveAsset({
        source: 'user_upload',
        type: 'image',
        url: dataUrl,
        name: f.name,
        metadata: { from: 'image_generator_ref_multi', mime: f.type, size: f.size },
      })
    }
    setRefImages((prev) => [...prev, ...next].slice(0, MAX_REF_IMAGES))
  }

  const loadAssetPicker = async (source: 'user_upload' | 'ai_generated') => {
    const cached = assetCacheRef.current[source]
    if (cached && cached.length) {
      setAssetList(cached)
      return
    }
    setAssetBusy(true)
    try {
      const r = await listAssetsAPI({ source, type: 'image', limit: 60, offset: 0 })
      const rows = (r.assets || []).filter((x) => x.type === 'image')
      setAssetList(rows)
      assetCacheRef.current[source] = rows
    } finally {
      setAssetBusy(false)
    }
  }

  useEffect(() => {
    if (!showAssetPicker) return
    void loadAssetPicker(assetTab)
  }, [showAssetPicker, assetTab])

  const toggleAssetPick = (id: string) => {
    setAssetSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else {
        const already = refImages.length + next.size
        if (already >= MAX_REF_IMAGES) return next
        next.add(id)
      }
      return next
    })
  }

  const confirmAssetPick = () => {
    const picked = assetList.filter((x) => assetSelectedIds.has(x.id)).map((x) => ({ id: `asset_${x.id}`, url: x.url, name: x.name || '资产图片', source: 'asset' as const }))
    if (picked.length) setRefImages((prev) => [...prev, ...picked].slice(0, MAX_REF_IMAGES))
    setAssetSelectedIds(new Set())
    setShowAssetPicker(false)
  }

  useEffect(() => {
    if (!previewRefImage) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewRefImage(null)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [previewRefImage])

  useEffect(() => {
    ;(async () => {
      try {
        const token = localStorage.getItem('tikgen.accessToken') || ''
        if (!token) return
        const r = await getModelAvailabilityAPI(token)
        const map: Record<string, string> = {}
        for (const x of r.image || []) map[String(x.id)] = String(x.reason || '暂不可用')
        try {
          const resp = await fetch('/api/model-controls?type=image')
          const data = await resp.json()
          if (data?.success && Array.isArray(data.controls)) {
            let recommended = ''
            for (const c of data.controls) {
              const id = String(c.model_id || '')
              if (!id) continue
              if (c.enabled === false) map[id] = String(c.note || '后台已禁用')
              if (!recommended && c.recommended === true && c.enabled !== false) recommended = id
            }
            if (recommended) setModel(recommended)
          }
        } catch {
          // ignore controls loading failures
        }
        setUnavailableImageMap(map)
      } catch {
        // ignore
      }
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const resp = await fetch('/api/models')
        const text = await resp.text()
        const data = (() => {
          try {
            return JSON.parse(text)
          } catch {
            return { success: false, error: text }
          }
        })()
        if (!resp.ok || !data?.success) return
        const list = data?.data?.data
        if (!Array.isArray(list)) return
        const looksLikeImageModel = (id: string) => {
          const s = String(id || '').toLowerCase()
          return (
            s.includes('nano-banana') ||
            s.includes('flux') ||
            s.includes('seedream') ||
            s.includes('dall-e') ||
            s.includes('gpt-image') ||
            s.includes('midjourney') ||
            s.includes('ideogram') ||
            s.includes('recraft') ||
            s.includes('qwen-image') ||
            s.includes('kolors') ||
            s.includes('stable-diffusion')
          )
        }

        const imgs = list
          .filter((m: any) => {
            const id = String(m?.id || '')
            const types: string[] = Array.isArray(m?.supported_endpoint_types) ? m.supported_endpoint_types.map(String) : []
            // 部分模型（如 nano-banana 系列）可能未标注 image-generation，但仍可用于图片生成
            return types.includes('image-generation') || looksLikeImageModel(id)
          })
          .map((m: any) => ({ id: String(m.id), name: String(m.id) }))
        if (imgs.length) {
          // merge with friendly names
          const friendly = new Map(IMAGE_MODELS.map((x) => [x.id, x.name]))
          const merged = imgs.map((x: any) => ({ id: x.id, name: friendly.get(x.id) || x.name }))
          setImageModels(merged)
          if (!merged.some((x: any) => x.id === model)) setModel(merged[0].id)
        }
      } catch {
        // ignore
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const imageCaps = useMemo<ImageModelCaps>(() => {
    // 若模型ID包含明确分辨率后缀（如 *-2k/*-4k/*-512px），优先按后缀限制分辨率
    const id = String(model || '')
    const bySuffix = (() => {
      if (/-4k\b/i.test(id)) return { resolutions: ['4096'] as ImageRes[], defaults: { aspectRatio: '1:1' as ImageAspect, resolution: '4096' as ImageRes } }
      if (/-2k\b/i.test(id)) return { resolutions: ['2048'] as ImageRes[], defaults: { aspectRatio: '1:1' as ImageAspect, resolution: '2048' as ImageRes } }
      if (/512px/i.test(id)) return { resolutions: ['1024'] as ImageRes[], defaults: { aspectRatio: '1:1' as ImageAspect, resolution: '1024' as ImageRes } }
      return null
    })()

    const base =
      IMAGE_MODEL_CAPS[model] || {
        aspectRatios: [...IMAGE_ASPECT_OPTIONS],
        resolutions: [...IMAGE_RES_OPTIONS],
        defaults: { aspectRatio: '1:1', resolution: '1024' },
      }
    if (bySuffix) return { ...base, resolutions: bySuffix.resolutions, defaults: { ...base.defaults, ...bySuffix.defaults } }
    return base
  }, [model])

  useEffect(() => {
    if (!imageCaps.aspectRatios.includes(size)) setSize(imageCaps.defaults.aspectRatio)
    if (!imageCaps.resolutions.includes(resolution)) setResolution(imageCaps.defaults.resolution)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  useEffect(() => {
    const selected = imageModelOptions.find((x) => x.id === model)
    if (selected && !selected.unavailableReason) return
    const firstAvailable = imageModelOptions.find((x) => !x.unavailableReason)
    if (firstAvailable && firstAvailable.id !== model) setModel(firstAvailable.id)
  }, [imageModelOptions, model])

  useEffect(() => {
    if (!templatePreset) return
    if (templatePreset.model) setModel(String(templatePreset.model))
    if (templatePreset.aspectRatio) setSize(String(templatePreset.aspectRatio) as ImageAspect)
    if (templatePreset.resolution) setResolution(String(templatePreset.resolution) as ImageRes)
    setPrompt(String(templatePreset.prompt || ''))
    onTemplateApplied()
  }, [templatePreset, onTemplateApplied])

  const handlePromptGen = async () => {
    if (!refImages.length) {
      alert('请先上传至少1张参考图')
      return
    }
    setShowModal(true)
    setModalStep(1)
    setAiError('')
    setOptimizedPrompt('')
    setOptimizedNegativePrompt('')
    setPromptParts({})
    setSceneMode('clean')
    setCategoryHint('other')
    setSelectedStyleTags([])
    const jobId = ++aiJobRef.current
    setIsAiBusy(true)
    try {
      const parsed = await parseProductInfo({ refImage: refImageDataUrl, language: productInfo.language || '简体中文', kind: 'image' })
      if (jobId !== aiJobRef.current) return
      setProductInfo(parsed)
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '解析失败')
    } finally {
      if (jobId !== aiJobRef.current) return
      setIsAiBusy(false)
    }
  }

  const handleNext = async () => {
    setAiError('')
    if (modalStep === 1) {
      setModalStep(2)
      const jobId = ++aiJobRef.current
      setIsAiBusy(true)
      try {
        const r = await generateImagePrompt({ product: productInfo, language: productInfo.language, aspectRatio: size, resolution, sceneMode })
        if (jobId !== aiJobRef.current) return
        setOptimizedPrompt(r.prompt)
        setOptimizedNegativePrompt(r.negativePrompt || '')
        const hint = String((r as any)?.categoryHint || 'other')
        setCategoryHint(hint)
        const presetParts = applySceneModePreset(sceneMode, r.parts || {})
        const initialParts = applyLearnedTweaks(hint, presetParts)
        setPromptParts(initialParts)
        setOptimizedPrompt(r.prompt || buildPromptFromParts(initialParts))
      } catch (e: any) {
        if (jobId !== aiJobRef.current) return
        setAiError(e?.message || '提示词生成失败')
      } finally {
        if (jobId !== aiJobRef.current) return
        setIsAiBusy(false)
      }
      return
    }
    setShowModal(false)
    setPrompt(optimizedPrompt)
  }

  const buildPromptFromParts = (parts: any) => {
    const pick = (k: string) => String(parts?.[k] || '').trim()
    const segs = [pick('subject'), pick('scene'), pick('composition'), pick('lighting'), pick('camera'), pick('style'), pick('quality'), pick('extra')].filter(Boolean)
    return segs.join('，')
  }

  const IMAGE_STYLE_TAGS = [
    { id: 'clean', label: '主图干净' },
    { id: 'premium', label: '高端棚拍' },
    { id: 'lifestyle', label: '生活场景' },
    { id: 'macro', label: '细节特写' },
    { id: 'clarity', label: '信息清晰' },
    { id: 'texture', label: '质感提升' },
  ] as const

  const applyLocalStyleRule = (tagLabel: string, parts: any) => {
    const next = { ...(parts || {}) }
    const append = (k: string, v: string) => {
      const base = String(next?.[k] || '').trim()
      next[k] = base ? `${base}；${v}` : v
    }
    switch (tagLabel) {
      case '生活场景':
        append('scene', '生活场景但背景弱化：与商品相关的环境，背景轻虚化，不抢主体，画面干净')
        append('composition', '主体占画面60–80%，场景元素1–2个做陪衬，不遮挡主体')
        append('lighting', '自然柔光，真实但不杂乱，避免强阴影')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'clutter, messy background, distracting objects'))
        break
      case '细节特写':
        append('camera', '微距/近景特写，50–90mm，浅景深，对焦在关键结构细节')
        append('composition', '突出关键卖点细节（材质纹理/接口/按键/结构），主体占比更高')
        append('quality', '细节锐利，纹理真实，边缘干净')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'soft focus, motion blur, low detail'))
        break
      case '信息清晰':
        append('composition', '构图规整，主体居中或三分法，背景纯净，留白用于贴标，信息层级清晰')
        append('lighting', '均匀柔光，减少戏剧化光影')
        append('style', '电商主图风格，清晰直观，少艺术化')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'dramatic lighting, heavy vignette, artsy, clutter'))
        break
      case '质感提升':
        append('lighting', '高级柔光箱+轮廓光，控制高光不过曝，材质高光自然')
        append('style', '真实商业摄影，材质更真实（避免塑料感/油腻感）')
        append('quality', '高动态范围，干净锐利，细节丰富')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'plastic, oily, waxy, over-sharpen, oversaturated'))
        break
      case '高端棚拍':
        append('lighting', '三点布光/柔光箱，精致高光与边缘轮廓光，干净反射')
        append('scene', '高级摄影棚背景（纯色/高级渐变/微纹理），干净无噪点')
        append('style', 'premium commercial product photography')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'cheap look, harsh shadow, noisy background'))
        break
      case '主图干净':
        append('scene', '棚拍纯色/轻渐变背景，无杂物，道具极少')
        append('composition', '主体约70–80%，边缘干净，四周留白用于贴标')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'props, clutter, busy background'))
        break
      default:
        break
    }
    return next
  }

  const toggleStyleTag = (tagLabel: string) => {
    setSelectedStyleTags((prev) => {
      const has = prev.includes(tagLabel)
      const nextSel = has ? prev.filter((x) => x !== tagLabel) : [...prev, tagLabel]
      return nextSel
    })
    // 本地规则即时生效（只做追加；取消选择不做回滚，避免惊跳）
    const nextParts = applyLocalStyleRule(tagLabel, promptParts)
    setPromptParts(nextParts)
    setOptimizedPrompt(buildPromptFromParts(nextParts))
  }

  const handleAiPolish = async () => {
    const tags = selectedStyleTags
    if (!tags.length) return
    setAiError('')
    const jobId = ++aiJobRef.current
    setIsAiBusy(true)
    try {
      const currentParts = Object.keys(promptParts || {}).length ? promptParts : {}
      const learned = loadCategoryTweaks(String(categoryHint || 'other'))
      const result = await applyImageStyleTags({
        tags,
        language: productInfo.language || '简体中文',
        parts: currentParts,
        prompt: optimizedPrompt || '',
        negativePrompt: optimizedNegativePrompt || '',
        aspectRatio: size,
        resolution,
        product: productInfo,
        categoryHint,
        sceneMode,
        learnedTweaks: learned,
      })
      if (jobId !== aiJobRef.current) return
      setPromptParts(result.parts || currentParts)
      const nextPrompt = result.prompt || buildPromptFromParts(result.parts || currentParts)
      setOptimizedPrompt(nextPrompt)
      setOptimizedNegativePrompt(result.negativePrompt || '')
      setSelectedStyleTags([])
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || 'AI精修失败')
    } finally {
      if (jobId !== aiJobRef.current) return
      setIsAiBusy(false)
    }
  }

  const handleCloseAiBusy = () => {
    aiJobRef.current += 1
    setIsAiBusy(false)
    setAiError('')
    if (modalStep === 1) {
      setShowModal(false)
      return
    }
    setModalStep(1)
  }

  const applyInfographicTemplate = (tpl: 'feature' | 'scene') => {
    const baseNeg =
      'blurry, lowres, watermark, logo, unreadable text, garbled text, misspelled words, duplicate product, extra tools, extra handles, extra nozzles, deformed, broken proportions, messy background, harsh shadows, overexposed, underexposed, noise'
    const neg = baseNeg

    if (tpl === 'feature') {
      const m: 'clean' | 'lite' = 'clean'
      setSceneMode(m)
      const parts = applySceneModePreset(m, {
        subject: '参考图同款产品一致（外形/配色/结构/角度保持一致），商业级质感，边缘清晰',
        scene: '浅色干净渐变背景（可带轻微浅绿/浅灰），信息图海报风格',
        composition: '主体占画面60–80%，左上角留出标题区，右上角留出参数标注区，中下方留出局部放大圈区域',
        lighting: '柔光箱棚拍光，细节清晰，高级质感，不过曝不过暗',
        camera: '50mm，近景产品主视角，轻微透视，画面干净',
        style: '电商功能示意信息图（Amazon卖点图风格），图标/箭头/标注清晰',
        quality: '高清，锐利，文字清晰可读，无乱码，无水印',
        extra:
          '版式要求：包含“180° ROTARY ADJUSTMENT / Switching Between Two Modes / 0°-180° Rotation Range”等标题与标注；加入弧形箭头、旋转范围示意、圆形局部放大圈展示旋转关节；整体排版规整，留白用于贴标',
      })
      setPromptParts(parts)
      setOptimizedNegativePrompt((prev) => mergeNegative(prev, neg))
      setOptimizedPrompt(buildPromptFromParts(parts))
      return
    }

    const m: 'clean' | 'lite' = 'lite'
    setSceneMode(m)
    const parts = applySceneModePreset(m, {
      subject: '参考图同款产品一致（外形/配色/结构保持一致），商业摄影质感，主体清晰',
      scene: '电商投放海报：左侧生活场景使用照（户外/庭院吹落叶等），右侧信息面板对比卖点列表',
      composition:
        '1:1海报版式：左侧大图人物使用场景（不需要人脸特写），右侧浅色信息面板；主体占比60–80%，信息面板内容清晰可读，层级分明',
      lighting: '自然柔光 + 轻轮廓光，真实场景但不杂乱，主体清晰',
      camera: '35–50mm，中景到近景，人物+产品同框，背景轻虚化',
      style: '电商场景对比海报（投放素材风格），勾选/叉号列表+小窗格对比',
      quality: '高清，锐利，文字清晰可读，无乱码，无水印',
      extra:
        '版式要求：顶部大标题“GOOD SUBSTITUTE FOR TRADITIONAL BLOWERS”；右侧包含绿色勾选卖点列表与红色叉号对比列表；右侧可有2–3个小场景窗格做对比示意；整体背景干净不抢主体',
    })
    setPromptParts(parts)
    setOptimizedNegativePrompt((prev) => mergeNegative(prev, neg))
    setOptimizedPrompt(buildPromptFromParts(parts))
  }

  const applySceneModePreset = (mode: 'clean' | 'lite', parts: any) => {
    const next = { ...(parts || {}) }
    // composition：强制加入电商主体占比规则（第一次生成时也会在后端 prompt 里约束）
    const baseComp = String(next.composition || '').trim()
    const compRule = '主体占画面60–80%（建议约70%），主体清晰锐利，留白用于贴标，背景不抢戏'
    next.composition = baseComp ? `${baseComp}；${compRule}` : compRule

    if (mode === 'clean') {
      const scene = '电商主图棚拍，纯色或轻渐变背景，干净无杂物（极少道具可选且不抢主体）'
      next.scene = String(next.scene || '').trim() ? `${String(next.scene).trim()}；${scene}` : scene
    } else {
      const scene = '电商投放轻场景：加入1–2个弱化场景元素/道具（虚化/弱化、不抢主体），背景依然干净'
      next.scene = String(next.scene || '').trim() ? `${String(next.scene).trim()}；${scene}` : scene
    }
    return next
  }

  const LS_KEY_IMG_TWEAKS = 'tikgen.imgTweaks.v1'
  const loadCategoryTweaks = (hint: string) => {
    try {
      const raw = localStorage.getItem(LS_KEY_IMG_TWEAKS)
      const obj = raw ? JSON.parse(raw) : {}
      return obj?.[hint] || null
    } catch {
      return null
    }
  }
  const saveCategoryTweaks = (hint: string, patch: any) => {
    try {
      const raw = localStorage.getItem(LS_KEY_IMG_TWEAKS)
      const obj = raw ? JSON.parse(raw) : {}
      const prev = obj?.[hint] || {}
      obj[hint] = { ...prev, ...patch, updatedAt: Date.now() }
      localStorage.setItem(LS_KEY_IMG_TWEAKS, JSON.stringify(obj))
    } catch {
      // ignore
    }
  }

  const applyLearnedTweaks = (hint: string, parts: any) => {
    const t = loadCategoryTweaks(hint)
    if (!t) return parts
    const next = { ...(parts || {}) }
    if (t.compositionAdd) next.composition = String(next.composition || '').trim() ? `${String(next.composition).trim()}；${t.compositionAdd}` : t.compositionAdd
    if (t.sceneAdd) next.scene = String(next.scene || '').trim() ? `${String(next.scene).trim()}；${t.sceneAdd}` : t.sceneAdd
    if (t.negativeAdd) setOptimizedNegativePrompt((prev) => mergeNegative(prev, t.negativeAdd))
    return next
  }

  const handleGenerate = async () => {
    if (!refImages.length) {
      alert('请至少上传1张参考图')
      return
    }
    if (!prompt) {
      alert('请输入图片描述')
      return
    }
    setIsGenerating(true)
    setGeneratedImage('')
    setQcResult(null)
    setGenErrorText('')
    setGenErrorCode('UNKNOWN')
    setGenProgress(1)
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setGenProgress((p) => {
        // ease-out: 快到 70%，再慢慢到 90%
        const target = p < 70 ? 70 : 90
        const step = p < 70 ? 6 : 2
        return Math.min(target, p + step)
      })
    }, 700)
    try {
      const r = await generateImageAPI({
        prompt,
        negativePrompt: optimizedNegativePrompt || undefined,
        model,
        aspectRatio: size,
        resolution,
        refImage: refImageDataUrl || undefined,
        imageCount,
      })
      setGeneratedImage(r.imageUrl)
      Sentry.captureMessage('image_generation_success', { level: 'info', extra: { model, size, resolution } })
      await safeArchiveAsset({
        source: 'ai_generated',
        type: 'image',
        url: r.imageUrl,
        name: `image-${Date.now()}.png`,
        metadata: { from: 'image_generator', model, size, resolution },
      })
      clearInterval(timer)
      // 如果生成很快，给用户一个“完成感”
      const elapsed = Date.now() - startedAt
      if (elapsed < 1200) {
        setGenProgress(92)
        await new Promise((rr) => setTimeout(rr, 350))
      }
      setGenProgress(100)
      // 仅在生成成功后做一次电商质检（仍需用户点击生成触发，且有计费保险栓）
      setIsQcBusy(true)
      try {
        const qc = await qcEcommerceImage({
          imageUrl: r.imageUrl,
          refImage: refImageDataUrl || undefined,
          product: productInfo,
          aspectRatio: size,
          resolution,
          language: productInfo.language || '简体中文',
        })
        setQcResult(qc.qc)
      } catch {
        // ignore QC failures
      } finally {
        setIsQcBusy(false)
      }
    } catch (e: any) {
      Sentry.captureException(e, { extra: { scene: 'image_generate', model, size, resolution } })
      setGenErrorText(e?.message || '生成失败')
      setGenErrorCode(e?.code || 'UNKNOWN')
      clearInterval(timer)
      setGenProgress(0)
    } finally {
      setIsGenerating(false)
    }
  }

  const mergeNegative = (base: string, add: string) => {
    const a = String(base || '')
    const b = String(add || '')
    const norm = (s: string) =>
      s
        .split(/[,，\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
    const set = new Set([...norm(a), ...norm(b)])
    return Array.from(set).join(', ')
  }

  const handleQcFixAndRetry = async () => {
    if (!qcResult) return
    const addNeg = String(qcResult?.fix?.addToNegative || '').trim()
    const tweaks = qcResult?.fix?.promptTweaks || {}

    // 轻量学习：将本次质检常见问题转成“下次同品类默认微调”
    try {
      const issues: string[] = Array.isArray(qcResult?.issues) ? qcResult.issues.map(String) : []
      const hint = String(categoryHint || 'other')
      const patch: any = {}
      if (issues.some((x) => x.includes('主体') && (x.includes('偏小') || x.includes('占比')))) {
        patch.compositionAdd = '主体占比更高（约70–80%），减少无关留白，突出主体'
      }
      if (issues.some((x) => x.includes('背景') && (x.includes('简单') || x.includes('缺少场景') || x.includes('场景')))) {
        patch.sceneAdd = '在不抢主体前提下加入1–2个弱化场景元素/道具并虚化，增强场景感'
      }
      if (addNeg) patch.negativeAdd = addNeg
      if (Object.keys(patch).length) saveCategoryTweaks(hint, patch)
    } catch {
      // ignore
    }

    const nextParts = { ...(promptParts || {}) }
    ;['subject', 'scene', 'composition', 'lighting', 'camera', 'style', 'quality', 'extra'].forEach((k) => {
      const v = String(tweaks?.[k] || '').trim()
      if (v) nextParts[k] = v
    })
    setPromptParts(nextParts)
    setOptimizedPrompt(buildPromptFromParts(nextParts))
    setOptimizedNegativePrompt((prev) => mergeNegative(prev, addNeg))

    // 直接用修复后的 prompt 重试生成
    setPrompt(buildPromptFromParts(nextParts))
    setIsGenerating(true)
    setGeneratedImage('')
    setQcResult(null)
    setGenProgress(1)
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setGenProgress((p) => {
        const target = p < 70 ? 70 : 90
        const step = p < 70 ? 6 : 2
        return Math.min(target, p + step)
      })
    }, 700)
    try {
      const r = await generateImageAPI({
        prompt: buildPromptFromParts(nextParts),
        negativePrompt: mergeNegative(optimizedNegativePrompt, addNeg) || undefined,
        model,
        aspectRatio: size,
        resolution,
        refImage: refImageDataUrl || undefined,
        imageCount,
      })
      setGeneratedImage(r.imageUrl)
      await safeArchiveAsset({
        source: 'ai_generated',
        type: 'image',
        url: r.imageUrl,
        name: `image-${Date.now()}.png`,
        metadata: { from: 'image_generator_retry', model, size, resolution },
      })
      clearInterval(timer)
      const elapsed = Date.now() - startedAt
      if (elapsed < 1200) {
        setGenProgress(92)
        await new Promise((rr) => setTimeout(rr, 350))
      }
      setGenProgress(100)
      setIsQcBusy(true)
      try {
        const qc = await qcEcommerceImage({
          imageUrl: r.imageUrl,
          refImage: refImageDataUrl || undefined,
          product: productInfo,
          aspectRatio: size,
          resolution,
          language: productInfo.language || '简体中文',
        })
        setQcResult(qc.qc)
      } catch {
        // ignore
      } finally {
        setIsQcBusy(false)
      }
    } catch (e: any) {
      alert(e?.message || '修复重试失败')
      clearInterval(timer)
      setGenProgress(0)
    } finally {
      setIsGenerating(false)
    }
  }

  if (showModal) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
          <div className="p-6 border-b flex items-center justify-between"><h3 className="text-xl font-bold">一键生成提示词</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button></div>
          <div className="px-6 py-4 border-b bg-gray-50 flex items-center">
            {['商品信息解析', '图片优化提示词'].map((s, i) => (
              <div key={i} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${modalStep > i + 1 ? 'bg-green-500 text-white' : modalStep === i + 1 ? 'bg-purple-500 text-white' : 'bg-gray-300'}`}>
                  {modalStep > i + 1 ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`ml-2 text-sm ${modalStep === i + 1 ? 'font-medium' : 'text-gray-400'}`}>{s}</span>
                {i < 1 && <div className="flex-1 h-0.5 bg-gray-200 mx-4" />}
              </div>
            ))}
          </div>
          <div className="p-6">
            {modalStep === 1 && (<div className="space-y-4">{refImagePreviewUrl && <img src={refImagePreviewUrl} alt="参考图" className="max-h-40 rounded-lg" />}{['name', 'category', 'sellingPoints', 'targetAudience'].map(f => <div key={f}><label className="block text-sm font-medium mb-1">{f === 'name' ? '产品名称' : f === 'category' ? '产品类目' : f === 'sellingPoints' ? '核心卖点' : '目标人群'}</label><input value={productInfo[f as keyof typeof productInfo]} onChange={e => setProductInfo({...productInfo, [f]: e.target.value})} className="w-full px-4 py-2 border rounded-lg" /></div>)}<div><label className="block text-sm font-medium mb-1">图片语言</label><select value={productInfo.language} onChange={e => setProductInfo({...productInfo, language: e.target.value})} className="w-full px-4 py-2 border rounded-lg"><option>简体中文</option><option>English</option></select></div></div>)}
            {modalStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium">图片优化提示词</label>
                  <div className="flex flex-wrap gap-2">
                    <div className="flex items-center bg-gray-100 rounded-full p-1 mr-1">
                      <button
                        disabled={isAiBusy}
                        onClick={() => applyInfographicTemplate('feature')}
                        className="px-3 py-1 rounded-full text-xs bg-white shadow text-gray-900 disabled:opacity-50"
                      >
                        功能示意图
                      </button>
                      <button
                        disabled={isAiBusy}
                        onClick={() => applyInfographicTemplate('scene')}
                        className="px-3 py-1 rounded-full text-xs bg-white shadow text-gray-900 disabled:opacity-50"
                      >
                        场景对比海报
                      </button>
                    </div>
                    <div className="flex items-center bg-gray-100 rounded-full p-1 mr-1">
                      <button
                        onClick={() => {
                          const m: 'clean' | 'lite' = 'clean'
                          setSceneMode(m)
                          const next = applySceneModePreset(m, promptParts)
                          setPromptParts(next)
                          setOptimizedPrompt(buildPromptFromParts(next))
                        }}
                        className={`px-3 py-1 rounded-full text-xs ${sceneMode === 'clean' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
                      >
                        主图干净
                      </button>
                      <button
                        onClick={() => {
                          const m: 'clean' | 'lite' = 'lite'
                          setSceneMode(m)
                          const next = applySceneModePreset(m, promptParts)
                          setPromptParts(next)
                          setOptimizedPrompt(buildPromptFromParts(next))
                        }}
                        className={`px-3 py-1 rounded-full text-xs ${sceneMode === 'lite' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
                      >
                        轻场景
                      </button>
                    </div>
                    {IMAGE_STYLE_TAGS.map((t) => (
                      <button
                        key={t.id}
                        disabled={isAiBusy}
                        onClick={() => toggleStyleTag(t.label)}
                        className={`px-2.5 py-1 rounded-full text-xs border disabled:opacity-50 ${
                          selectedStyleTags.includes(t.label)
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                    <button
                      disabled={isAiBusy || selectedStyleTags.length === 0}
                      onClick={handleAiPolish}
                      className="px-3 py-1 rounded-full text-xs bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-50"
                    >
                      AI精修{selectedStyleTags.length ? `（${selectedStyleTags.length}）` : ''}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { k: 'subject', label: '主体' },
                    { k: 'scene', label: '场景' },
                    { k: 'composition', label: '构图' },
                    { k: 'lighting', label: '光影' },
                    { k: 'camera', label: '镜头' },
                    { k: 'style', label: '风格' },
                    { k: 'quality', label: '质量' },
                    { k: 'extra', label: '补充' },
                  ].map((x) => (
                    <div key={x.k} className="md:col-span-1">
                      <label className="block text-xs text-gray-600 mb-1">{x.label}</label>
                      <input
                        value={String(promptParts?.[x.k] || '')}
                        onChange={(e) => {
                          const next = { ...(promptParts || {}), [x.k]: e.target.value }
                          setPromptParts(next)
                          // 同步更新最终 prompt，保证生成用的是最新结构化内容
                          setOptimizedPrompt(buildPromptFromParts(next))
                        }}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        placeholder={`填写${x.label}（可留空）`}
                      />
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">负面词（避免项）</label>
                  <textarea
                    value={optimizedNegativePrompt}
                    onChange={(e) => setOptimizedNegativePrompt(e.target.value)}
                    className="w-full px-4 py-3 border rounded-xl min-h-[90px]"
                    placeholder="例如：模糊，低清，畸形，多余物体，文字水印，过曝，噪点，杂乱背景…"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">最终 prompt（可直接编辑）</label>
                  <textarea value={optimizedPrompt} onChange={e => setOptimizedPrompt(e.target.value)} className="w-full px-4 py-3 border rounded-xl min-h-[120px]" />
                </div>
              </div>
            )}
            {!!aiError && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{aiError}</div>}
          </div>
          {isAiBusy && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center rounded-2xl">
              <div className="relative bg-white shadow-lg border rounded-2xl px-6 py-5 flex items-center min-w-[360px]">
                <button
                  onClick={handleCloseAiBusy}
                  className="absolute right-3 top-3 p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-white/10"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
                <RefreshCw className="w-5 h-5 text-purple-600 animate-spin mr-3" />
                <div>
                  <div className="font-medium">{modalStep === 2 ? '图片优化提示词AI生成中' : '商品信息解析中'}</div>
                  <div className="text-sm text-gray-500">请稍等，预计几秒钟...</div>
                </div>
              </div>
            </div>
          )}
          <div className="p-6 border-t flex justify-end space-x-3">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">取消</button>
            <button disabled={isAiBusy} onClick={handleNext} className="px-4 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50">
              {isAiBusy ? '处理中...' : modalStep === 2 ? '确认' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <div className="mb-6">
          <label className="block text-sm font-medium mb-1">模型选择</label>
          <select value={model} onChange={e => setModel(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
            {imageModelOptions.map((m) => (
              <option key={m.id} value={m.id} disabled={!!m.unavailableReason}>
                {m.name}
                {m.unavailableReason ? `（暂不可用）` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">参考图（可上传 1-5 张，至少 1 张）</label>
            <div className="text-xs text-gray-500">{refImages.length}/{MAX_REF_IMAGES}</div>
          </div>
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-2.5">
            {refImages.length ? (
              <div className="grid grid-cols-5 gap-2">
                {refImages.map((img, i) => (
                  <div key={img.id} className="relative rounded-lg overflow-hidden border bg-gray-50">
                    <button
                      type="button"
                      onClick={() => setPreviewRefImage({ url: img.url, name: img.name || `参考图${i + 1}`, index: i })}
                      className="block w-full"
                      title="点击预览"
                    >
                      <img src={img.url} alt={img.name || `参考图${i + 1}`} className="w-full h-20 object-cover" />
                    </button>
                    {i === 0 && <span className="absolute left-1 top-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">主参考</span>}
                    <button
                      onClick={() => setPreviewRefImage({ url: img.url, name: img.name || `参考图${i + 1}`, index: i })}
                      className="absolute left-1 bottom-1 h-5 px-1.5 rounded bg-black/60 text-white text-[10px] inline-flex items-center gap-1"
                      title="预览"
                    >
                      <Eye className="w-3 h-3" /> 预览
                    </button>
                    <button onClick={() => removeRefImage(img.id)} className="absolute right-1 top-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs">×</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-2 text-center min-h-[150px] flex flex-col items-center justify-center">
                <Upload className="w-6 h-6 mx-auto text-gray-300 mb-1.5" />
                <div className="text-base font-semibold mb-1">点击或拖拽上传图片</div>
                <div className="text-[10px] text-gray-500 mb-2.5">支持 JPG、JPEG、PNG、WEBP，单张不超过 10 MB</div>
                <div className="flex items-center justify-center gap-2">
                  <label className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer hover:bg-gray-50">
                    选择文件
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={async (e: any) => {
                        await handleLocalRefUpload(e.target.files || null)
                        e.target.value = ''
                      }}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={() => {
                      setAssetSelectedIds(new Set())
                      setShowAssetPicker(true)
                    }}
                    className="px-3 py-1.5 rounded-lg border text-xs hover:bg-gray-50"
                  >
                    从资产库选择
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">比例</label>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {imageCaps.aspectRatios.map((ar) => (
              <button
                key={ar}
                onClick={() => setSize(ar)}
                className={`rounded-xl border px-2 py-2 text-sm shrink-0 w-[92px] ${size === ar ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <div className="h-7 flex items-center justify-center">
                  <div
                    className="bg-gray-400/80 rounded-sm"
                    style={{
                      width: ar === '16:9' ? 24 : ar === '4:3' ? 20 : ar === '1:1' ? 16 : ar === '3:4' ? 12 : 10,
                      height: ar === '9:16' ? 24 : ar === '3:4' ? 20 : ar === '1:1' ? 16 : ar === '4:3' ? 14 : ar === '16:9' ? 10 : 8,
                    }}
                  />
                </div>
                <div>{ar}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1">分辨率</label>
            <select value={resolution} onChange={e => setResolution(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {imageCaps.resolutions.map((r) => (
                <option key={r} value={r}>
                  {r === '1024' ? '1k' : r === '1536' ? '1.5k' : r === '2048' ? '2k' : r === '4096' ? '4k' : r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">生成张数</label>
            <select value={imageCount} onChange={(e) => setImageCount(Number(e.target.value) as 1 | 2 | 3 | 4)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">提示词</label>
            <button
              onClick={handlePromptGen}
              className="px-3 py-1.5 rounded-full text-sm bg-purple-50 text-purple-700 hover:bg-purple-100 flex items-center"
            >
              <Sparkles className="w-4 h-4 mr-1" /> 一键生成提示词
            </button>
          </div>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full px-4 py-3 border rounded-xl min-h-[140px]" placeholder="输入画面描述/风格，或使用一键生成提示词..." />
        </div>
        <button onClick={handleGenerate} disabled={isGenerating || !prompt} className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50">{isGenerating ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin inline" />生成中...</> : '生成图片'}</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">生成结果</h2>
        {isGenerating ? (
          <GenerationLoadingCard
            title={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].image.title}
            subtitle={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].image.subtitle}
            chips={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].image.chips}
            progressText={`生成进度：${Math.max(1, Math.min(99, genProgress))}%`}
          />
        ) : generatedImage ? (
          <div>
            <img src={generatedImage} alt="生成图片" className="w-full rounded-xl" />
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">电商主图质检</div>
                {isQcBusy && <div className="text-sm text-gray-500 flex items-center"><RefreshCw className="w-4 h-4 mr-2 animate-spin" />质检中...</div>}
              </div>
              {qcResult ? (
                <div className="mt-2 p-4 rounded-xl border bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className="font-medium">评分：</span>{Number(qcResult.score || 0)}
                      <span className="mx-2 text-gray-300">|</span>
                      <span className="font-medium">结论：</span>
                      <span className={qcResult.verdict === 'pass' ? 'text-green-600' : qcResult.verdict === 'warn' ? 'text-amber-600' : 'text-red-600'}>
                        {qcResult.verdict === 'pass' ? '可投放' : qcResult.verdict === 'warn' ? '可优化' : '不建议投放'}
                      </span>
                    </div>
                    <button
                      onClick={handleQcFixAndRetry}
                      className="px-3 py-2 rounded-lg text-sm bg-purple-600 text-white hover:bg-purple-700"
                    >
                      一键修复并重试
                    </button>
                  </div>
                  {Array.isArray(qcResult.issues) && qcResult.issues.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-600 mb-1">问题</div>
                      <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                        {qcResult.issues.slice(0, 6).map((x: string, i: number) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(qcResult.suggestions) && qcResult.suggestions.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-600 mb-1">建议</div>
                      <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                        {qcResult.suggestions.slice(0, 6).map((x: string, i: number) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-500">生成完成后将自动进行一次主图质检。</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <a href={generatedImage} target="_blank" rel="noreferrer" className="py-3 bg-gray-100 rounded-xl flex items-center justify-center">
                <Play className="w-5 h-5 mr-2" />预览
              </a>
              <a href={generatedImage} download className="py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl flex items-center justify-center">
                <Download className="w-5 h-5 mr-2" />下载
              </a>
            </div>
          </div>
        ) : genErrorText ? (
          <div className="h-96 flex flex-col items-center justify-center text-center bg-red-50 rounded-xl px-6">
            <p className="text-red-600 font-medium">生成失败</p>
            <p className="text-sm text-red-600 mt-2 break-words">{genErrorText}</p>
            <p className="text-xs text-red-400 mt-2">错误码：{genErrorCode}</p>
            {genErrorCode !== 'QUOTA_EXHAUSTED' && (
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="mt-5 px-4 py-2 rounded-lg text-sm bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              >
                重试（保留参数）
              </button>
            )}
          </div>
        ) : (
          <div className="h-96 flex items-center justify-center text-gray-400 border-2 border-dashed rounded-xl"><Image className="w-16 h-16 opacity-50" /></div>
        )}
      </div>
    </div>
    {showAssetPicker && (
      <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
        <div className="w-full max-w-6xl max-h-[88vh] overflow-hidden bg-white rounded-2xl border shadow-2xl flex flex-col">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div className="text-lg font-semibold">从资产库选择</div>
            <button onClick={() => setShowAssetPicker(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="px-5 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => setAssetTab('user_upload')} className={`px-3 py-1.5 rounded-lg text-sm ${assetTab === 'user_upload' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>本地上传</button>
              <button onClick={() => setAssetTab('ai_generated')} className={`px-3 py-1.5 rounded-lg text-sm ${assetTab === 'ai_generated' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>AI 生成</button>
            </div>
            <div className="text-sm text-gray-500">已选 {assetSelectedIds.size}/{Math.max(0, MAX_REF_IMAGES - refImages.length)}</div>
          </div>
          <div className="p-5 overflow-auto flex-1">
            {assetBusy ? (
              <div className="text-sm text-gray-500">加载中...</div>
            ) : assetList.length === 0 ? (
              <div className="text-sm text-gray-500">暂无可选图片资产</div>
            ) : (
              <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {assetList.map((a) => {
                  const checked = assetSelectedIds.has(a.id)
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggleAssetPick(a.id)}
                      className={`relative rounded-xl overflow-hidden border transition-all ${checked ? 'border-purple-500 ring-2 ring-purple-300 shadow-[0_0_0_2px_rgba(168,85,247,.35)]' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <img src={a.url} alt={a.name || 'asset'} className="w-full h-24 object-cover" />
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
            <button onClick={() => setShowAssetPicker(false)} className="px-4 py-2 rounded-lg border">取消</button>
            <button onClick={confirmAssetPick} className="px-4 py-2 rounded-lg bg-purple-600 text-white">确认选择（{assetSelectedIds.size}）</button>
          </div>
        </div>
      </div>
    )}
    {previewRefImage && (
      <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreviewRefImage(null)}>
        <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setPreviewRefImage(null)}
            className="absolute -top-10 right-0 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
          >
            关闭
          </button>
          <div className="rounded-2xl border border-white/20 bg-white/5 p-2">
            <img src={previewRefImage.url} alt={previewRefImage.name} className="w-full max-h-[78vh] object-contain rounded-xl" />
          </div>
          <div className="mt-2 text-center text-xs text-white/70">
            {previewRefImage.name}（{previewRefImage.index + 1}/{refImages.length}）
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function Assets() {
  const PAGE_SIZE = 12
  const [userUploads, setUserUploads] = useState<AssetItem[]>([])
  const [aiOutputs, setAiOutputs] = useState<AssetItem[]>([])
  const [userOffset, setUserOffset] = useState(0)
  const [aiOffset, setAiOffset] = useState(0)
  const [userHasMore, setUserHasMore] = useState(true)
  const [aiHasMore, setAiHasMore] = useState(true)
  const [userFilter, setUserFilter] = useState<'all' | 'image' | 'video'>('all')
  const [aiFilter, setAiFilter] = useState<'all' | 'image' | 'video'>('all')
  const [loading, setLoading] = useState(false)
  const [loadingMoreUser, setLoadingMoreUser] = useState(false)
  const [loadingMoreAi, setLoadingMoreAi] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchKeyword, setSearchKeyword] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest')
  const [previewAsset, setPreviewAsset] = useState<AssetItem | null>(null)
  const initializedRef = useRef(false)

  const saveCache = (next: {
    userUploads: AssetItem[]
    aiOutputs: AssetItem[]
    userOffset: number
    aiOffset: number
    userHasMore: boolean
    aiHasMore: boolean
  }) => {
    const payload = { ...next, ts: Date.now() }
    assetsMemoryCache = payload
    try {
      localStorage.setItem(ASSETS_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore cache write errors
    }
  }

  const applyCache = (cached: any) => {
    setUserUploads(Array.isArray(cached?.userUploads) ? cached.userUploads : [])
    setAiOutputs(Array.isArray(cached?.aiOutputs) ? cached.aiOutputs : [])
    setUserOffset(Number(cached?.userOffset || 0))
    setAiOffset(Number(cached?.aiOffset || 0))
    setUserHasMore(Boolean(cached?.userHasMore))
    setAiHasMore(Boolean(cached?.aiHasMore))
  }

  const loadSource = async (source: 'user_upload' | 'ai_generated', reset: boolean) => {
    const isUser = source === 'user_upload'
    const filter = isUser ? userFilter : aiFilter
    const currentOffset = reset ? 0 : isUser ? userOffset : aiOffset
    const r = await listAssetsAPI({
      source,
      type: filter === 'all' ? undefined : filter,
      limit: PAGE_SIZE,
      offset: currentOffset,
    })
    const list = r.assets || []
    if (isUser) {
      if (reset) setUserUploads(list)
      else setUserUploads((prev) => [...prev, ...list])
      const nextOffset = r.nextOffset ?? currentOffset + list.length
      setUserOffset(nextOffset)
      setUserHasMore(Boolean(r.hasMore))
      saveCache({
        userUploads: reset ? list : [...userUploads, ...list],
        aiOutputs,
        userOffset: nextOffset,
        aiOffset,
        userHasMore: Boolean(r.hasMore),
        aiHasMore,
      })
    } else {
      if (reset) setAiOutputs(list)
      else setAiOutputs((prev) => [...prev, ...list])
      const nextOffset = r.nextOffset ?? currentOffset + list.length
      setAiOffset(nextOffset)
      setAiHasMore(Boolean(r.hasMore))
      saveCache({
        userUploads,
        aiOutputs: reset ? list : [...aiOutputs, ...list],
        userOffset,
        aiOffset: nextOffset,
        userHasMore,
        aiHasMore: Boolean(r.hasMore),
      })
    }
  }

  const refreshAll = async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all([loadSource('user_upload', true), loadSource('ai_generated', true)])
    } catch (e: any) {
      setError(e?.message || '获取资产失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // 先用缓存秒开，再静默刷新，避免每次进资产库都白屏等待
    const fromMem = assetsMemoryCache
    if (fromMem) applyCache(fromMem)
    if (!fromMem) {
      try {
        const raw = localStorage.getItem(ASSETS_CACHE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          applyCache(parsed)
          assetsMemoryCache = parsed
        }
      } catch {
        // ignore cache parse errors
      }
    }
    refreshAll()
    initializedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!initializedRef.current) return
    // filter changed -> reset this section pagination
    ;(async () => {
      try {
        await loadSource('user_upload', true)
      } catch {
        // handled in UI on next manual refresh
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilter])

  useEffect(() => {
    if (!initializedRef.current) return
    ;(async () => {
      try {
        await loadSource('ai_generated', true)
      } catch {
        // handled in UI on next manual refresh
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiFilter])

  const handleStandaloneUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    setError('')
    try {
      for (const f of Array.from(files)) {
        const dataUrl = await fileToDataUrl(f)
        await createAssetAPI({
          source: 'user_upload',
          type: guessAssetType(f),
          url: dataUrl,
          name: f.name,
          metadata: { from: 'assets_upload', mime: f.type, size: f.size },
        })
      }
      await refreshAll()
    } catch (e: any) {
      setError(e?.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleRename = async (a: AssetItem) => {
    const next = window.prompt('输入新的资产名称', a.name || '')
    if (next == null) return
    setBusyId(a.id)
    setError('')
    try {
      await updateAssetAPI({ id: a.id, name: next })
      if (a.source === 'user_upload') await loadSource('user_upload', true)
      else await loadSource('ai_generated', true)
    } catch (e: any) {
      setError(e?.message || '重命名失败')
    } finally {
      setBusyId('')
    }
  }

  const handleDelete = async (a: AssetItem) => {
    if (!window.confirm('确认删除该资产吗？删除后不可恢复。')) return
    setBusyId(a.id)
    setError('')
    try {
      await deleteAssetAPI(a.id)
      if (a.source === 'user_upload') {
        setUserUploads((prev) => prev.filter((x) => x.id !== a.id))
      } else {
        setAiOutputs((prev) => prev.filter((x) => x.id !== a.id))
      }
    } catch (e: any) {
      setError(e?.message || '删除失败')
    } finally {
      setBusyId('')
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyView = (items: AssetItem[]) => {
    const kw = searchKeyword.trim().toLowerCase()
    const filtered = kw
      ? items.filter((a) => {
          const name = String(a.name || '').toLowerCase()
          const meta = JSON.stringify(a.metadata || {}).toLowerCase()
          return name.includes(kw) || meta.includes(kw)
        })
      : items
    return [...filtered].sort((a, b) => {
      const ta = new Date(a.created_at).getTime()
      const tb = new Date(b.created_at).getTime()
      return sortBy === 'newest' ? tb - ta : ta - tb
    })
  }

  const shownUserUploads = applyView(userUploads)
  const shownAiOutputs = applyView(aiOutputs)

  const handleBatchDelete = async () => {
    if (!selectedIds.size) return
    if (!window.confirm(`确认批量删除 ${selectedIds.size} 个资产吗？删除后不可恢复。`)) return
    setError('')
    const ids = Array.from(selectedIds)
    try {
      for (const id of ids) {
        await deleteAssetAPI(id)
      }
      setSelectedIds(new Set())
      setUserUploads((prev) => prev.filter((x) => !ids.includes(x.id)))
      setAiOutputs((prev) => prev.filter((x) => !ids.includes(x.id)))
    } catch (e: any) {
      setError(e?.message || '批量删除失败')
    }
  }

  useEffect(() => {
    if (!previewAsset) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewAsset(null)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [previewAsset])

  const renderAssetCard = (a: AssetItem) => {
    const isImage = a.type === 'image'
    const checked = selectedIds.has(a.id)
    return (
      <div key={a.id} className="rounded-xl border bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <label className="inline-flex items-center gap-1 text-xs text-gray-500">
            <input type="checkbox" checked={checked} onChange={() => toggleSelect(a.id)} />
            选择
          </label>
          <span className="text-[11px] text-gray-400">{a.type === 'image' ? '图片' : '视频'}</span>
        </div>
        <button
          type="button"
          onClick={() => setPreviewAsset(a)}
          className="w-full h-28 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden"
          title="点击放大预览"
        >
          {isImage ? (
            <img src={a.url} alt={a.name || 'asset'} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <video src={a.url} className="w-full h-full object-cover" preload="metadata" />
          )}
        </button>
        <div className="mt-2 text-xs text-gray-600 truncate">{a.name || `${a.type} 资产`}</div>
        <div className="mt-1 text-[11px] text-gray-400">{new Date(a.created_at).toLocaleString()}</div>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setPreviewAsset(a)} className="text-xs px-2 py-1 rounded border">预览</button>
          <a href={a.url} download className="text-xs px-2 py-1 rounded border">下载</a>
          <button disabled={busyId === a.id} onClick={() => handleRename(a)} className="text-xs px-2 py-1 rounded border disabled:opacity-50">重命名</button>
          <button disabled={busyId === a.id} onClick={() => handleDelete(a)} className="text-xs px-2 py-1 rounded border text-red-600 border-red-200 disabled:opacity-50">删除</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">资产库</h2>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 border rounded-lg text-sm bg-white"
          >
            <option value="newest">按时间：最新</option>
            <option value="oldest">按时间：最早</option>
          </select>
          <input
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索名称/备注"
            className="px-3 py-2 border rounded-lg text-sm w-44"
          />
          <button
            disabled={!selectedIds.size}
            onClick={handleBatchDelete}
            className="px-3 py-2 border rounded-lg text-sm text-red-600 border-red-200 disabled:opacity-50"
          >
            批量删除({selectedIds.size})
          </button>
          <button onClick={refreshAll} className="px-3 py-2 border rounded-lg text-sm">刷新</button>
          <label className="px-4 py-2 bg-gray-900 text-white rounded-lg cursor-pointer">
            {uploading ? '上传中...' : '上传素材'}
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => handleStandaloneUpload(e.target.files)}
            />
          </label>
        </div>
      </div>
      {!!error && <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">本地上传</h3>
            <div className="flex items-center gap-1">
              {(['all', 'image', 'video'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setUserFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded-lg border ${userFilter === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600'}`}
                >
                  {f === 'all' ? '全部' : f === 'image' ? '图片' : '视频'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-gray-500">包含：本地上传（创作模块上传 + 资产库手动上传），均归档到当前账号。</p>
          <div className="mt-4">
            {loading ? (
              <div className="h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">加载中...</div>
            ) : shownUserUploads.length ? (
              <>
                <div className="grid grid-cols-2 gap-3 max-h-[420px] overflow-auto pr-1">{shownUserUploads.map(renderAssetCard)}</div>
                {userHasMore && (
                  <button
                    disabled={loadingMoreUser}
                    onClick={async () => {
                      setLoadingMoreUser(true)
                      try {
                        await loadSource('user_upload', false)
                      } finally {
                        setLoadingMoreUser(false)
                      }
                    }}
                    className="mt-3 w-full py-2 rounded-lg border text-sm disabled:opacity-50"
                  >
                    {loadingMoreUser ? '加载中...' : '加载更多'}
                  </button>
                )}
              </>
            ) : (
              <div className="h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">暂无素材</div>
            )}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">AI生成</h3>
            <div className="flex items-center gap-1">
              {(['all', 'image', 'video'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setAiFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded-lg border ${aiFilter === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600'}`}
                >
                  {f === 'all' ? '全部' : f === 'image' ? '图片' : '视频'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-gray-500">包含：视频生成、图片生成成功后的结果，自动归档到当前账号。</p>
          <div className="mt-4">
            {loading ? (
              <div className="h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">加载中...</div>
            ) : shownAiOutputs.length ? (
              <>
                <div className="grid grid-cols-2 gap-3 max-h-[420px] overflow-auto pr-1">{shownAiOutputs.map(renderAssetCard)}</div>
                {aiHasMore && (
                  <button
                    disabled={loadingMoreAi}
                    onClick={async () => {
                      setLoadingMoreAi(true)
                      try {
                        await loadSource('ai_generated', false)
                      } finally {
                        setLoadingMoreAi(false)
                      }
                    }}
                    className="mt-3 w-full py-2 rounded-lg border text-sm disabled:opacity-50"
                  >
                    {loadingMoreAi ? '加载中...' : '加载更多'}
                  </button>
                )}
              </>
            ) : (
              <div className="h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">暂无生成记录</div>
            )}
          </div>
        </div>
      </div>
      {previewAsset && (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreviewAsset(null)}>
          <div className="relative w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewAsset(null)}
              className="absolute -top-10 right-0 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
            >
              关闭
            </button>
            <div className="rounded-2xl border border-white/20 bg-white/5 p-2">
              {previewAsset.type === 'image' ? (
                <img src={previewAsset.url} alt={previewAsset.name || 'asset'} className="w-full max-h-[78vh] object-contain rounded-xl" />
              ) : (
                <video src={previewAsset.url} className="w-full max-h-[78vh] rounded-xl bg-black" controls autoPlay />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskCenter() {
  const PAGE_SIZE = 20
  const [tasks, setTasks] = useState<GenerationTaskItem[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'video' | 'image'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'processing' | 'succeeded' | 'failed'>('all')

  const load = async (reset: boolean) => {
    const current = reset ? 0 : offset
    const r = await listTasksAPI({
      type: typeFilter === 'all' ? undefined : typeFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      limit: PAGE_SIZE,
      offset: current,
    })
    const rows = r.tasks || []
    if (reset) setTasks(rows)
    else setTasks((prev) => [...prev, ...rows])
    setOffset(r.nextOffset ?? current + rows.length)
    setHasMore(Boolean(r.hasMore))
  }

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        await load(true)
      } catch (e: any) {
        setError(e?.message || '获取任务失败')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter])

  const statusLabel = (s: string) => {
    const v = String(s || '').toLowerCase()
    if (v === 'submitted') return '已提交'
    if (v === 'processing' || v === 'running' || v === 'in_progress') return '生成中'
    if (v === 'succeeded' || v === 'success' || v === 'completed') return '成功'
    if (v === 'failed' || v === 'error') return '失败'
    return v || '未知'
  }

  const statusClass = (s: string) => {
    const v = String(s || '').toLowerCase()
    if (v === 'succeeded' || v === 'success' || v === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    if (v === 'failed' || v === 'error') return 'bg-red-50 text-red-700 border-red-200'
    if (v === 'processing' || v === 'running' || v === 'in_progress' || v === 'submitted') return 'bg-amber-50 text-amber-700 border-amber-200'
    return 'bg-gray-50 text-gray-700 border-gray-200'
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">任务中心</h2>
          <div className="flex items-center gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="all">全部类型</option>
              <option value="video">视频</option>
              <option value="image">图片</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="all">全部状态</option>
              <option value="submitted">已提交</option>
              <option value="processing">生成中</option>
              <option value="succeeded">成功</option>
              <option value="failed">失败</option>
            </select>
            <button
              onClick={async () => {
                setLoading(true)
                setError('')
                try {
                  await load(true)
                } catch (e: any) {
                  setError(e?.message || '刷新失败')
                } finally {
                  setLoading(false)
                }
              }}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              刷新
            </button>
          </div>
        </div>

        {!!error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

        {loading ? (
          <div className="h-44 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">任务加载中...</div>
        ) : tasks.length ? (
          <div className="space-y-3">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-xl border p-4 bg-white">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm px-2 py-0.5 rounded bg-gray-100 text-gray-700">{t.type === 'video' ? '视频' : '图片'}</span>
                      <span className={`text-sm px-2 py-0.5 rounded border ${statusClass(t.status)}`}>{statusLabel(t.status)}</span>
                    </div>
                    <div className="mt-2 text-sm text-gray-700 truncate">模型：{t.model || '-'}</div>
                    <div className="mt-1 text-xs text-gray-400">创建时间：{new Date(t.created_at).toLocaleString()}</div>
                    {t.provider_task_id ? <div className="mt-1 text-xs text-gray-400 break-all">任务ID：{t.provider_task_id}</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {t.output_url ? (
                      <>
                        <a href={t.output_url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border text-sm">预览</a>
                        <a href={t.output_url} download className="px-3 py-2 rounded-lg border text-sm">下载</a>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">暂无结果</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {hasMore && (
              <button
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true)
                  try {
                    await load(false)
                  } catch (e: any) {
                    setError(e?.message || '加载更多失败')
                  } finally {
                    setLoadingMore(false)
                  }
                }}
                className="w-full py-2 rounded-lg border text-sm disabled:opacity-50"
              >
                {loadingMore ? '加载中...' : '加载更多'}
              </button>
            )}
          </div>
        ) : (
          <div className="h-44 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">暂无任务记录</div>
        )}
      </div>
    </div>
  )
}

function DeveloperConsole() {
  const [tab, setTab] = useState<'monitor' | 'users' | 'models' | 'packages' | 'announcements' | 'tickets'>('users')
  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="bg-white rounded-2xl p-3 shadow border flex items-center gap-2 flex-wrap">
        <button onClick={() => setTab('users')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'users' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>用户管理</button>
        <button onClick={() => setTab('models')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'models' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>模型开关</button>
        <button onClick={() => setTab('packages')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'packages' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>套餐管理</button>
        <button onClick={() => setTab('announcements')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'announcements' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>公告发布</button>
        <button onClick={() => setTab('tickets')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'tickets' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>工单管理</button>
        <button onClick={() => setTab('monitor')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'monitor' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>系统监控</button>
      </div>
      {tab === 'users' && <AdminUsersPanel />}
      {tab === 'models' && <AdminModelControlsPanel />}
      {tab === 'packages' && <AdminPackagesPanel />}
      {tab === 'announcements' && <AdminAnnouncementsPanel />}
      {tab === 'tickets' && <AdminSupportTicketsPanel />}
      {tab === 'monitor' && <AdminMonitoringPanel />}
    </div>
  )
}

function AdminUsersPanel() {
  const [q, setQ] = useState('')
  const [plan, setPlan] = useState('')
  const [frozen, setFrozen] = useState<'all' | 'true' | 'false'>('all')
  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListUsers({ q, plan: plan || undefined, frozen: frozen === 'all' ? undefined : frozen, limit: 100 })
      setUsers(r.users || [])
    } catch (e: any) {
      setErr(e?.message || '加载用户失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setPlanForUser = async (userId: string, planId: string) => {
    setNotice('')
    try {
      await adminUpdateUser({ userId, action: 'setPlan', planId })
      setNotice('套餐更新成功')
      await load()
    } catch (e: any) {
      setErr(e?.message || '更新套餐失败')
    }
  }

  const toggleFreeze = async (userId: string, isFrozen: boolean) => {
    setNotice('')
    try {
      await adminUpdateUser({ userId, action: 'setFrozen', isFrozen, freezeReason: isFrozen ? '运营后台手动冻结' : '' })
      setNotice(isFrozen ? '用户已冻结' : '用户已解冻')
      await load()
    } catch (e: any) {
      setErr(e?.message || '更新冻结状态失败')
    }
  }

  const planLabel: Record<string, string> = {
    trial: '试用版',
    basic: '基础版',
    pro: '专业版',
    enterprise: '旗舰版',
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">用户管理</h3>
          <p className="text-sm text-gray-500 mt-1">查询用户、改套餐、冻结/解冻账号</p>
        </div>
        <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
      </div>
      <div className="grid md:grid-cols-4 gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索邮箱/昵称" className="px-3 py-2 border rounded-lg" />
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="px-3 py-2 border rounded-lg">
          <option value="">全部套餐</option>
          <option value="trial">{planLabel.trial}</option>
          <option value="basic">{planLabel.basic}</option>
          <option value="pro">{planLabel.pro}</option>
          <option value="enterprise">{planLabel.enterprise}</option>
        </select>
        <select value={frozen} onChange={(e) => setFrozen(e.target.value as any)} className="px-3 py-2 border rounded-lg">
          <option value="all">全部状态</option>
          <option value="false">未冻结</option>
          <option value="true">已冻结</option>
        </select>
        <button onClick={() => void load()} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">查询</button>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02] shadow-[0_18px_50px_rgba(2,6,23,0.32)]">
        <table className="min-w-full text-sm">
          <thead className="bg-white/[0.03] text-white/60">
            <tr>
              <th className="text-left px-4 py-3 font-medium">用户</th>
              <th className="text-left px-4 py-3 font-medium">套餐</th>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">注册时间</th>
              <th className="text-left px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-white/10 hover:bg-white/[0.03] transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-white/90">{u.display_name || '-'}</div>
                  <div className="text-xs text-white/55">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={String(u.subscription?.plan_id || 'trial')}
                    onChange={(e) => void setPlanForUser(u.id, e.target.value)}
                    className="px-2.5 py-1.5 border border-white/15 bg-white/[0.03] rounded-lg text-white/85"
                  >
                    <option value="trial">{planLabel.trial}</option>
                    <option value="basic">{planLabel.basic}</option>
                    <option value="pro">{planLabel.pro}</option>
                    <option value="enterprise">{planLabel.enterprise}</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  {u.is_frozen ? (
                    <span className="text-xs px-2.5 py-1 rounded-full border border-red-300/25 bg-red-500/15 text-red-200">已冻结</span>
                  ) : (
                    <span className="text-xs px-2.5 py-1 rounded-full border border-emerald-300/25 bg-emerald-500/15 text-emerald-200">正常</span>
                  )}
                </td>
                <td className="px-4 py-3 text-white/65">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void toggleFreeze(u.id, !u.is_frozen)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                      u.is_frozen
                        ? 'border-emerald-300/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/18'
                        : 'border-red-300/30 bg-red-500/10 text-red-200 hover:bg-red-500/18'
                    }`}
                  >
                    {u.is_frozen ? '解冻' : '冻结'}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-white/45">暂无用户数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AdminModelControlsPanel() {
  const [type, setType] = useState<'video' | 'image' | 'llm'>('video')
  const [controls, setControls] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const allModelIds = useMemo(() => {
    const list = type === 'video' ? VIDEO_MODELS.map((m) => m.id) : type === 'image' ? IMAGE_MODELS.map((m) => m.id) : ['gpt-4o']
    const fromDb = controls.map((c) => String(c.model_id || '')).filter(Boolean)
    return Array.from(new Set([...list, ...fromDb]))
  }, [type, controls])

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListModelControls(type)
      setControls(r.controls || [])
    } catch (e: any) {
      setErr(e?.message || '加载模型开关失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const byId = useMemo(() => {
    const map: Record<string, any> = {}
    for (const c of controls) map[String(c.model_id)] = c
    return map
  }, [controls])

  const save = async (modelId: string, patch: { enabled?: boolean; recommended?: boolean; note?: string }) => {
    setNotice('')
    try {
      const cur = byId[modelId] || {}
      await adminUpdateModelControl({
        modelId,
        type,
        enabled: patch.enabled != null ? patch.enabled : cur.enabled !== false,
        recommended: patch.recommended != null ? patch.recommended : !!cur.recommended,
        note: patch.note != null ? patch.note : cur.note || '',
      })
      setNotice('模型配置已保存')
      await load()
    } catch (e: any) {
      setErr(e?.message || '保存模型配置失败')
    }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">模型开关</h3>
          <p className="text-sm text-gray-500 mt-1">控制模型可用/禁用与推荐默认</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="video">video</option>
            <option value="image">image</option>
            <option value="llm">llm</option>
          </select>
          <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
        </div>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}
      <div className="space-y-2">
        {allModelIds.map((id) => {
          const item = byId[id] || {}
          const enabled = item.enabled !== false
          const recommended = !!item.recommended
          return (
            <div key={id} className="border rounded-lg p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-sm">{id}</div>
                <div className="text-xs text-gray-500">{item.note || '-'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => void save(id, { enabled: !enabled })} className={`px-2 py-1 text-xs rounded-lg ${enabled ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {enabled ? '禁用' : '启用'}
                </button>
                <button onClick={() => void save(id, { recommended: !recommended, enabled: true })} className={`px-2 py-1 text-xs rounded-lg ${recommended ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>
                  {recommended ? '取消推荐' : '设为推荐'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AdminPackagesPanel() {
  const [configs, setConfigs] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [savingPlanId, setSavingPlanId] = useState<string>('')
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const FIXED_PLAN_IDS = ['trial', 'basic', 'pro', 'enterprise']

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListPackageConfigs()
      setConfigs(r.configs || [])
    } catch (e: any) {
      setErr(e?.message || '加载套餐配置失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const updateOne = async (planId: string, patch: any) => {
    setConfigs((prev) => {
      const idx = prev.findIndex((x) => String(x?.plan_id || '') === String(planId))
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], ...patch }
        return next
      }
      const base = DEFAULT_PACKAGES.find((p) => p.plan_id === planId) || {}
      return [...prev, { ...base, plan_id: planId, ...patch }]
    })
  }

  const saveOne = async (row: any) => {
    setNotice('')
    setErr('')
    setSavingPlanId(String(row.plan_id || ''))
    try {
      const features = String(row.featuresText || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
      await adminUpsertPackageConfig({
        planId: row.plan_id,
        name: row.name,
        priceCents: Number(row.price_cents || 0),
        currency: row.currency || 'CNY',
        dailyQuota: Number(row.daily_quota || 0),
        features,
        modelWhitelist: Array.isArray(row.model_whitelist) ? row.model_whitelist : [],
        enabled: row.enabled !== false,
        displayOrder: Number(row.display_order || 100),
        applyMode: String(row.apply_mode || 'new_only'),
        graceDays: Number(row.grace_days || 0),
        effectiveFrom: row.effective_from || null,
      })
      setNotice(`套餐 ${row.plan_id} 已保存`)
      await load()
    } catch (e: any) {
      setErr(e?.message || '保存套餐失败')
    } finally {
      setSavingPlanId('')
      // 无论保存成功与否，都退出编辑态，避免出现“保存后仍可编辑/需点取消”的体验问题
      setEditingPlanId(null)
    }
  }

  const rows = FIXED_PLAN_IDS.map((pid) => {
    const base = DEFAULT_PACKAGES.find((p) => p.plan_id === pid) || ({} as any)
    const r = configs.find((x) => String(x?.plan_id || '') === String(pid)) || {}
    const merged = { ...base, ...r, plan_id: pid }
    const feats = Array.isArray(merged.features) ? merged.features : []
    // textarea 的输入值会写到 merged.featuresText（非 features 数组），这里要优先取用户编辑内容。
    const featuresText =
      typeof merged.featuresText === 'string' ? merged.featuresText : Array.isArray(merged.features) ? merged.features.join('\n') : ''
    return {
      ...merged,
      featuresText,
      apply_mode: merged.apply_mode || 'new_only',
      grace_days: Number(merged.grace_days ?? 0),
      display_order: Number(merged.display_order ?? 100),
      effective_from: merged.effective_from || '',
    }
  })

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">套餐管理（配置化）</h3>
          <p className="text-sm text-gray-500 mt-1">可配置价格、日额度、特性文案</p>
        </div>
        <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}
      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((r, idx) => {
          const isEditing = editingPlanId === r.plan_id
          return (
          <div key={r.plan_id} className="border rounded-xl p-5 space-y-3 bg-white">
            <div className="font-semibold flex items-center justify-between gap-3">
              <span>{r.plan_id}</span>
              <span className={`text-xs px-2 py-1 rounded-full ${r.enabled === false ? 'bg-gray-100 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>
                {r.enabled === false ? '已禁用' : '可用'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">套餐名称（展示给用户）</div>
                <input
                  value={r.name || ''}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { name: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="套餐名称"
                />
              </div>
              <div>
                {!isEditing ? (
                  <button onClick={() => setEditingPlanId(r.plan_id)} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">
                    编辑
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      disabled={savingPlanId === r.plan_id}
                      onClick={() => void saveOne(r)}
                      className={`px-3 py-2 rounded-lg text-white text-sm ${savingPlanId === r.plan_id ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600'}`}
                    >
                      {savingPlanId === r.plan_id ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingPlanId(null)
                        setSavingPlanId('')
                        void load()
                      }}
                      className="px-3 py-2 rounded-lg border text-gray-700 text-sm bg-white"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-gray-500 mb-1">价格（分）</div>
                <input
                  value={r.price_cents ?? 0}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { price_cents: Number(e.target.value || 0) })}
                  className={`px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="价格(分)"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">日额度</div>
                <input
                  value={r.daily_quota ?? 0}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { daily_quota: Number(e.target.value || 0) })}
                  className={`px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="日额度"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-gray-500 mb-1">排序权重（越小越靠前）</div>
                <input
                  value={r.display_order ?? 100}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { display_order: Number(e.target.value || 100) })}
                  className={`px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="排序权重"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">老用户宽限天数</div>
                <input
                  value={r.grace_days ?? 0}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { grace_days: Number(e.target.value || 0) })}
                  className={`px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="老用户宽限天数"
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">生效范围</div>
              <select
                value={r.apply_mode || 'new_only'}
                disabled={!isEditing}
                onChange={(e) => void updateOne(r.plan_id, { apply_mode: e.target.value })}
                className={`w-full px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
              >
                <option value="new_only">仅新用户生效（默认）</option>
                <option value="all_users">新老用户都生效</option>
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">生效时间（ISO，可空；空=立刻）</div>
              <input
                value={r.effective_from || ''}
                disabled={!isEditing}
                onChange={(e) => void updateOne(r.plan_id, { effective_from: e.target.value })}
                className={`w-full px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                placeholder="生效时间(ISO，可空)"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">特性文案（每行一个，展示给用户）</div>
              <textarea
                value={r.featuresText || ''}
                disabled={!isEditing}
                onChange={(e) => void updateOne(r.plan_id, { featuresText: e.target.value })}
                rows={4}
                className={`w-full px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                placeholder="每行一个特性"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={r.enabled !== false}
                disabled={!isEditing}
                onChange={(e) => void updateOne(r.plan_id, { enabled: e.target.checked })}
              />
              启用
            </label>
          </div>
          )
        })}
      </div>
    </div>
  )
}

function AdminAnnouncementsPanel() {
  const [list, setList] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<any>({ title: '', content: '', type: 'system', target: 'all', status: 'draft' })

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListAnnouncements()
      setList(r.announcements || [])
    } catch (e: any) {
      setErr(e?.message || '加载公告失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const submit = async () => {
    setNotice('')
    try {
      await adminUpsertAnnouncement(form)
      setNotice('公告已保存')
      setForm({ title: '', content: '', type: 'system', target: 'all', status: 'draft' })
      await load()
    } catch (e: any) {
      setErr(e?.message || '保存公告失败')
    }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">公告发布（定向触达）</h3>
          <p className="text-sm text-gray-500 mt-1">按目标用户发布草稿/上线/下线公告</p>
        </div>
        <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}
      <div className="border rounded-xl p-4 space-y-3">
        <input value={form.title} onChange={(e) => setForm((x: any) => ({ ...x, title: e.target.value }))} className="w-full px-3 py-2 border rounded-lg" placeholder="公告标题" />
        <textarea value={form.content} onChange={(e) => setForm((x: any) => ({ ...x, content: e.target.value }))} rows={4} className="w-full px-3 py-2 border rounded-lg" placeholder="公告内容" />
        <div className="grid grid-cols-3 gap-2">
          <select value={form.type} onChange={(e) => setForm((x: any) => ({ ...x, type: e.target.value }))} className="px-3 py-2 border rounded-lg">
            <option value="system">系统通知</option>
            <option value="activity">活动公告</option>
            <option value="release">版本发布</option>
          </select>
          <select value={form.target} onChange={(e) => setForm((x: any) => ({ ...x, target: e.target.value }))} className="px-3 py-2 border rounded-lg">
            <option value="all">全部用户</option>
            <option value="trial">试用版用户</option>
            <option value="basic">基础版用户</option>
            <option value="pro">专业版用户</option>
            <option value="enterprise">旗舰版用户</option>
          </select>
          <select value={form.status} onChange={(e) => setForm((x: any) => ({ ...x, status: e.target.value }))} className="px-3 py-2 border rounded-lg">
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="offline">已下线</option>
          </select>
        </div>
        <button onClick={() => void submit()} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">保存公告</button>
      </div>
      <div className="space-y-2">
        {list.map((a) => (
          <div key={a.id} className="border rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-gray-500">
                {{ draft: '草稿', published: '已发布', offline: '已下线' }[String(a.status)] || a.status} ·{' '}
                {{ all: '全部用户', trial: '试用版', basic: '基础版', pro: '专业版', enterprise: '旗舰版' }[String(a.target)] || a.target}
              </div>
            </div>
            <div className="text-sm text-gray-600 mt-1 line-clamp-2">{a.content}</div>
            <div className="mt-2">
              <button onClick={() => setForm({ id: a.id, title: a.title, content: a.content, type: a.type, target: a.target, status: a.status || 'draft' })} className="px-2 py-1 rounded border text-xs">
                编辑
              </button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="text-sm text-gray-400 py-4 text-center">暂无公告</div>}
      </div>
    </div>
  )
}

function AdminSupportTicketsPanel() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'open' | 'in_progress' | 'resolved' | 'closed'>('all')
  const [tickets, setTickets] = useState<AdminSupportTicketItem[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<AdminSupportTicketItem | null>(null)
  const [updating, setUpdating] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')

  const statusLabel: Record<string, string> = { open: '待处理', in_progress: '处理中', resolved: '已解决', closed: '已关闭' }
  const priorityLabel: Record<string, string> = { low: '低', normal: '中', high: '高', urgent: '紧急' }
  const kindLabel: Record<string, string> = { bug: 'Bug/报错', suggestion: '功能建议', other: '其他' }

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListSupportTickets({ q, status, limit: 100 })
      setTickets(r.tickets || [])
    } catch (e: any) {
      setErr(e?.message || '加载工单失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateTicket = async (params: { status?: 'open' | 'in_progress' | 'resolved' | 'closed'; priority?: 'low' | 'normal' | 'high' | 'urgent' }) => {
    if (!selected) return
    setUpdating(true)
    setErr('')
    setNotice('')
    try {
      await adminUpdateSupportTicket({ ticketId: selected.id, ...params, adminNote: noteDraft })
      setNotice('工单更新成功')
      await load()
      const latest = tickets.find((x) => x.id === selected.id)
      if (latest) setSelected(latest)
    } catch (e: any) {
      setErr(e?.message || '更新工单失败')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">工单管理</h3>
          <p className="text-sm text-gray-500 mt-1">查看用户工单、更新状态与备注</p>
        </div>
        <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索工单号/邮箱/主题" className="px-3 py-2 border rounded-lg" />
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="px-3 py-2 border rounded-lg">
          <option value="all">全部状态</option>
          <option value="open">待处理</option>
          <option value="in_progress">处理中</option>
          <option value="resolved">已解决</option>
          <option value="closed">已关闭</option>
        </select>
        <button onClick={() => void load()} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">查询</button>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}

      <div className="overflow-x-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2">工单号</th>
              <th className="text-left px-3 py-2">类型</th>
              <th className="text-left px-3 py-2">用户</th>
              <th className="text-left px-3 py-2">状态</th>
              <th className="text-left px-3 py-2">优先级</th>
              <th className="text-left px-3 py-2">提交时间</th>
              <th className="text-left px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2 font-medium">{t.ticket_no}</td>
                <td className="px-3 py-2">{kindLabel[t.kind] || t.kind}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{t.email || t.user_id}</td>
                <td className="px-3 py-2">{statusLabel[t.status] || t.status}</td>
                <td className="px-3 py-2">{priorityLabel[t.priority] || t.priority}</td>
                <td className="px-3 py-2 text-gray-600">{new Date(t.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => {
                      setSelected(t)
                      setNoteDraft(String(t.admin_note || ''))
                    }}
                    className="px-2.5 py-1 rounded border text-xs"
                  >
                    处理
                  </button>
                </td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-400">暂无工单数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="rounded-xl border p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">工单详情：{selected.ticket_no}</div>
            <button onClick={() => setSelected(null)} className="px-2 py-1 rounded border text-xs">关闭</button>
          </div>
          <div className="text-sm text-gray-700">主题：{selected.subject}</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">描述：{selected.content}</div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">状态</label>
              <select
                value={selected.status}
                onChange={async (e) => {
                  const next = e.target.value as 'open' | 'in_progress' | 'resolved' | 'closed'
                  setSelected((prev) => (prev ? { ...prev, status: next } : prev))
                  await updateTicket({ status: next })
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                disabled={updating}
              >
                <option value="open">待处理</option>
                <option value="in_progress">处理中</option>
                <option value="resolved">已解决</option>
                <option value="closed">已关闭</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">优先级</label>
              <select
                value={selected.priority}
                onChange={async (e) => {
                  const next = e.target.value as 'low' | 'normal' | 'high' | 'urgent'
                  setSelected((prev) => (prev ? { ...prev, priority: next } : prev))
                  await updateTicket({ priority: next })
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                disabled={updating}
              >
                <option value="low">低</option>
                <option value="normal">中</option>
                <option value="high">高</option>
                <option value="urgent">紧急</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">管理员备注</label>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder="输入处理说明..."
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => void updateTicket({})}
              disabled={updating}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
            >
              {updating ? '保存中...' : '保存备注'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AdminMonitoringPanel() {
  const accessToken = localStorage.getItem('tikgen.accessToken') || ''
  const [stats, setStats] = useState<MonitoringStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scope, setScope] = useState<'system' | 'self'>('system')

  const load = async () => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const s = await getMonitoringStatsAPI(accessToken, scope)
      setStats(s)
    } catch (e: any) {
      setError(e?.message || '获取监控统计失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">系统稳定性监控</h2>
            <p className="text-sm text-gray-500 mt-1">近24小时任务与支付分布</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={scope} onChange={(e) => setScope(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="system">全系统</option>
              <option value="self">仅我自己</option>
            </select>
            <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>

        {!!error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

        {stats ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="rounded-lg border p-3 bg-gray-50"><div className="text-xs text-gray-500">任务总数</div><div className="text-xl font-bold">{stats.total}</div></div>
              <div className="rounded-lg border p-3 bg-red-50"><div className="text-xs text-red-500">失败率</div><div className="text-xl font-bold text-red-600">{(stats.failedRate * 100).toFixed(1)}%</div></div>
              <div className="rounded-lg border p-3 bg-emerald-50"><div className="text-xs text-emerald-600">成功</div><div className="text-xl font-bold text-emerald-700">{stats.byStatus.succeeded}</div></div>
              <div className="rounded-lg border p-3 bg-amber-50"><div className="text-xs text-amber-600">处理中</div><div className="text-xl font-bold text-amber-700">{stats.byStatus.processing + stats.byStatus.submitted}</div></div>
              <div className="rounded-lg border p-3 bg-white"><div className="text-xs text-gray-500">图片任务</div><div className="text-xl font-bold">{stats.byType.image}</div></div>
              <div className="rounded-lg border p-3 bg-white"><div className="text-xs text-gray-500">视频任务</div><div className="text-xl font-bold">{stats.byType.video}</div></div>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-4">
              <div className="rounded-lg border p-4">
                <div className="font-medium mb-2">错误分布 TOP</div>
                {stats.errorTop.length ? (
                  <div className="space-y-2">
                    {stats.errorTop.map((x, i) => (
                      <div key={i} className="text-sm flex items-center justify-between gap-2">
                        <span className="truncate text-gray-700">{x.message}</span>
                        <span className="text-red-600 font-semibold">{x.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">暂无错误</div>
                )}
              </div>
              <div className="rounded-lg border p-4">
                <div className="font-medium mb-2">支付状态分布（24h）</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded bg-gray-50 px-3 py-2">created：<span className="font-semibold">{stats.orders24h.byStatus.created}</span></div>
                  <div className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">paid：<span className="font-semibold">{stats.orders24h.byStatus.paid}</span></div>
                  <div className="rounded bg-red-50 px-3 py-2 text-red-700">failed：<span className="font-semibold">{stats.orders24h.byStatus.failed}</span></div>
                  <div className="rounded bg-gray-50 px-3 py-2">refunded：<span className="font-semibold">{stats.orders24h.byStatus.refunded}</span></div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="h-40 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">监控统计加载中...</div>
        )}
      </div>
    </div>
  )
}

function Packages({ user, onRefreshUser, packages }: { user: any; onRefreshUser: () => Promise<void>; packages: PackageConfigItem[] }) {
  const [busyPlan, setBusyPlan] = useState('')
  const [payError, setPayError] = useState('')
  const [payType, setPayType] = useState<'native' | 'alipay'>('native')
  const [checkingPaid, setCheckingPaid] = useState(false)
  const [payInfo, setPayInfo] = useState<{ orderId: string; qrcode?: string; payUrl?: string; status?: string; planId?: string } | null>(null)
  const accessToken = localStorage.getItem('tikgen.accessToken') || ''

  useEffect(() => {
    if (!payInfo?.orderId || payInfo.status === 'paid') return
    let timer: any = null
    let stopped = false
    let tries = 0
    const run = async () => {
      if (stopped || !accessToken || !payInfo?.orderId) return
      tries += 1
      try {
        const r = await getOrderStatus(payInfo.orderId, accessToken)
        const st = String(r.order?.status || '').toLowerCase()
        if (st === 'paid') {
          setPayInfo((prev) => (prev ? { ...prev, status: 'paid' } : prev))
          await onRefreshUser()
          return
        }
      } catch {
        // ignore transient polling failures
      }
      if (tries < 60) timer = setTimeout(run, 3000)
    }
    timer = setTimeout(run, 2500)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [payInfo?.orderId, payInfo?.status, accessToken, onRefreshUser])

  const checkPaidNow = async () => {
    if (!payInfo?.orderId || !accessToken) return
    setCheckingPaid(true)
    setPayError('')
    try {
      const r = await getOrderStatus(payInfo.orderId, accessToken)
      const st = String(r.order?.status || '').toLowerCase()
      if (st === 'paid') {
        setPayInfo((prev) => (prev ? { ...prev, status: 'paid' } : prev))
        await onRefreshUser()
      } else {
        setPayError('订单尚未支付完成，请完成付款后再检查。')
      }
    } catch (e: any) {
      setPayError(e?.message || '检查支付状态失败')
    } finally {
      setCheckingPaid(false)
    }
  }

  const currentPlanName = useMemo(() => {
    const planId = String(user?.package || 'trial')
    const byConfig = (packages || []).find((p) => String(p.plan_id) === planId)?.name
    if (byConfig) return byConfig
    return { trial: '试用版', basic: '基础版', pro: '专业版', enterprise: '旗舰版' }[planId as 'trial' | 'basic' | 'pro' | 'enterprise'] || planId
  }, [packages, user?.package])

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-8 text-center">选择您的套餐</h2>
      <div className="mb-6 bg-white rounded-2xl p-4 shadow border flex items-center justify-between">
        <div className="text-sm text-gray-600">
          当前套餐：
          <span className="font-semibold text-gray-900 ml-1">{currentPlanName}</span>
          {user?.packageExpiresAt ? <span className="ml-3">到期：{user.packageExpiresAt}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">支付方式</span>
          <select value={payType} onChange={(e) => setPayType(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm bg-white">
            <option value="native">微信扫码</option>
            <option value="alipay">支付宝</option>
          </select>
        </div>
      </div>
      {payInfo && (
        <div className="mb-8 bg-white rounded-2xl p-6 shadow-lg border">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-lg">请扫码支付</div>
              <div className="text-sm text-gray-500 mt-1">订单号：{payInfo.orderId}</div>
              <div className="text-sm mt-1">
                状态：
                <span className={`ml-1 font-medium ${payInfo.status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {payInfo.status === 'paid' ? '已支付，权益已更新' : '待支付'}
                </span>
              </div>
            </div>
            <button onClick={() => setPayInfo(null)} className="px-3 py-1.5 rounded-lg border text-sm">关闭</button>
          </div>
          <div className="mt-5 grid md:grid-cols-2 gap-6 items-center">
            <div className="flex items-center justify-center">
              {payInfo.qrcode ? (
                <img src={payInfo.qrcode} alt="支付二维码" className="w-56 h-56 rounded-xl border bg-white" />
              ) : (
                <div className="w-56 h-56 rounded-xl border bg-gray-50 flex items-center justify-center text-gray-400">二维码生成中...</div>
              )}
            </div>
            <div>
              <div className="text-sm text-gray-600">
                - 支持微信/支付宝（由 XorPay 收单）<br />
                - 支付完成后，返回页面刷新权益<br />
                - 若二维码不可扫，可点击下方链接跳转支付
              </div>
              {payInfo.payUrl && (
                <a href={payInfo.payUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold">
                  打开支付页面
                </a>
              )}
              <button
                onClick={checkPaidNow}
                disabled={checkingPaid}
                className="mt-3 ml-0 md:ml-3 px-4 py-2 rounded-xl border font-medium disabled:opacity-50"
              >
                {checkingPaid ? '检查中...' : '我已支付，检查到账'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {packages
          .filter((x) => x.enabled !== false)
          .sort((a, b) => {
            const pa = Number(a.price_cents || 0)
            const pb = Number(b.price_cents || 0)
            if (pa !== pb) return pa - pb
            return Number(a.display_order || 100) - Number(b.display_order || 100)
          })
          .map((pkg) => {
            const isCurrent = String(user?.package || '') === String(pkg.plan_id)
            const priceYuan = Number(pkg.price_cents || 0) / 100
            const displayPrice = priceYuan <= 0 ? '¥0' : `¥${priceYuan}/月`
            const features = Array.isArray(pkg.features) ? pkg.features : []
            return (
          <div
            key={pkg.plan_id}
            className={`bg-white rounded-2xl p-6 shadow-lg border-2 ${isCurrent ? 'border-purple-500' : 'border-transparent'}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">{pkg.name}</h3>
              {isCurrent && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">当前套餐</span>}
            </div>
            <div className="mt-4">
              <div className="text-3xl font-extrabold">{displayPrice}</div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              {features.map((f) => (
                <li key={f} className="flex items-center">
                  <Check className="w-4 h-4 text-green-500 mr-2" />
                  <span>{f}</span>
                </li>
              ))}
              {pkg.apply_mode && (
                <li className="text-xs text-gray-500 mt-2">
                  生效规则：{pkg.apply_mode === 'all_users' ? `新老用户都生效${pkg.grace_days ? `（宽限${pkg.grace_days}天）` : ''}` : '仅新用户生效'}
                </li>
              )}
            </ul>
            <button
              className={`mt-6 w-full py-3 rounded-xl font-bold ${
                priceYuan <= 0 || isCurrent ? 'bg-gray-100 text-gray-700' : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white'
              }`}
              disabled={busyPlan === pkg.plan_id}
              onClick={async () => {
                setPayError('')
                if (priceYuan <= 0 || isCurrent) return
                if (!accessToken) return alert('请先登录')
                setBusyPlan(pkg.plan_id)
                try {
                  const r = await createOrder({ planId: pkg.plan_id, payType }, accessToken)
                  Sentry.captureMessage('payment_order_create_success', { level: 'info', extra: { planId: pkg.plan_id, payType } })
                  setPayInfo({ orderId: r.orderId, qrcode: r.qrcode, payUrl: r.payUrl, status: 'created', planId: pkg.plan_id })
                } catch (e: any) {
                  Sentry.captureException(e, { extra: { scene: 'create_order', planId: pkg.plan_id, payType } })
                  setPayError(e?.message || '下单失败')
                } finally {
                  setBusyPlan('')
                }
              }}
            >
              {isCurrent ? '当前套餐' : priceYuan <= 0 ? '免费套餐' : busyPlan === pkg.plan_id ? '下单中...' : '立即开通'}
            </button>
          </div>
        )})}
      </div>
      {!!payError && <div className="mt-6 p-3 rounded-xl bg-red-50 text-red-600 text-sm">{payError}</div>}
    </div>
  )
}

export default App