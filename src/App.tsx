import { useEffect, useMemo, useRef, useState } from 'react'
import { Video, Image, Zap, LogOut, User, Play, Download, RefreshCw, Sparkles, Menu, X, Upload, Scissors, Eraser, Wand2, Folder, ChevronRight, Check, Crown, WandSparkles, ShieldCheck, Library, Settings2, Eye, EyeOff } from 'lucide-react'
import { checkVideoStatus, generateVideoAPI } from './api/video'
import { beautifyScript, generateImagePrompt, generateVideoScripts, parseProductInfo, type ProductInfo } from './api/ai'
import { generateImageAPI } from './api/image'
import { applyImageStyleTags } from './api/imageStyle'
import { qcEcommerceImage } from './api/imageQc'
import { apiLogin, apiMe, apiRefresh, apiRegister } from './api/auth'
import { createOrder, getOrderStatus } from './api/payments'
import { createAssetAPI, deleteAssetAPI, listAssetsAPI, updateAssetAPI, type AssetItem } from './api/assets'
import { listTasksAPI, type GenerationTaskItem } from './api/tasks'

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
  { id: 'seedream', name: 'Seedream 4.5' },
  { id: 'seedream-4.5', name: 'Seedream 4.5 (Alt)' },
  { id: 'flux', name: 'FLUX' },
  { id: 'flux-dev', name: 'FLUX Dev' },
  { id: 'flux-pro', name: 'FLUX Pro' },
  { id: 'sdxl', name: 'SDXL' },
  { id: 'dalle-3', name: 'DALL·E 3' },
  { id: 'midjourney', name: 'Midjourney' },
]

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
  seedream: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['2048', '4096'], defaults: { aspectRatio: '1:1', resolution: '2048' } },
  'seedream-4.5': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['2048', '4096'], defaults: { aspectRatio: '1:1', resolution: '2048' } },
  flux: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536', '2048'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  'flux-dev': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  'flux-pro': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536', '2048'], defaults: { aspectRatio: '1:1', resolution: '1536' } },
  sdxl: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  'dalle-3': { aspectRatios: ['1:1', '9:16', '16:9'], resolutions: ['1024', '2048'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  midjourney: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '2048'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
}
const PACKAGES = [{ id: 'trial', name: '试用版', price: '¥0', features: ['每天3次', '基础功能'] }, { id: 'basic', name: '基础版', price: '¥69/月', features: ['每天20次', '全部模型'] }, { id: 'pro', name: '专业版', price: '¥249/月', features: ['无限次数', '4K输出'] }, { id: 'enterprise', name: '旗舰版', price: '¥1199/月', features: ['企业级', 'API接入'] }]

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
  const [page, setPage] = useState<'landing' | 'auth' | 'home'>(() => (localStorage.getItem('tikgen.accessToken') ? 'home' : 'landing'))
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [user, setUser] = useState<{ id?: string; name: string; email?: string; credits: number; package: string; packageExpiresAt: string } | null>(null)
  const [accessToken, setAccessToken] = useState<string>(() => localStorage.getItem('tikgen.accessToken') || '')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authPassword2, setAuthPassword2] = useState('')
  const [authShowPassword, setAuthShowPassword] = useState(false)
  const [authShowPassword2, setAuthShowPassword2] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [mainNav, setMainNav] = useState<'create' | 'tasks' | 'tools' | 'assets' | 'benefits'>('create')
  const [createNav, setCreateNav] = useState<'video' | 'image'>('video')
  const [toolNav, setToolNav] = useState<'subtitle' | 'watermark' | 'upscale'>('subtitle')

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
        } catch {
          clearSession()
          setAccessToken('')
          setUser(null)
          setPage('landing')
        }
      } finally {
        // no-op
      }
    })()
  }, [accessToken])

  const handleLogout = () => {
    clearSession()
    setAccessToken('')
    setUser(null)
    setPage('landing')
  }

  const currentPackage = useMemo(() => PACKAGES.find((p) => p.id === user?.package), [user?.package])

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
                setAuthMode('register')
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
              <p className="text-white/60 mt-2 text-sm">用户上传与AI生成素材自动归档到资产库。</p>
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
          <h2 className="text-3xl font-bold text-white text-center mb-8">{authMode === 'login' ? '登录账号' : '注册账号'}</h2>
          <div className="space-y-4">
            <input value={authEmail} onChange={(e)=>setAuthEmail(e.target.value)} type="email" placeholder="邮箱地址" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40" />
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
            {authMode === 'register' && (
              <div className="relative">
                <input
                  value={authPassword2}
                  onChange={(e) => setAuthPassword2(e.target.value)}
                  type={authShowPassword2 ? 'text' : 'password'}
                  placeholder="确认密码"
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
                if (!authEmail || !authPassword) return setAuthError('请输入邮箱与密码')
                if (authMode === 'register' && authPassword !== authPassword2) return setAuthError('两次密码不一致')
                setAuthBusy(true)
                try {
                  const data = authMode === 'register'
                    ? await apiRegister({ email: authEmail, password: authPassword })
                    : await apiLogin({ email: authEmail, password: authPassword })
                  if (authMode === 'register' && data?.needsEmailConfirm) {
                    setAuthMode('login')
                    throw new Error('注册成功：请先去邮箱点击验证链接，然后再回来登录')
                  }
                  const session = data?.session || null
                  const token = session?.access_token
                  if (!token) throw new Error('登录成功但未返回 token')
                  saveSession(session)
                  setAccessToken(token)
                } catch (e:any) {
                  const msg = String(e?.message || '登录失败')
                  if (authMode === 'register' && msg.toLowerCase().includes('rate limit')) {
                    // Supabase auth has strict anti-abuse limits. We keep a short local cooldown
                    // to prevent repeated requests from the same browser/IP.
                    const cooldownMs = 60 * 60 * 1000
                    localStorage.setItem('tikgen.authCooldownUntil', String(Date.now() + cooldownMs))
                    return setAuthError('触发注册限流，请稍后约 60 分钟再试')
                  }
                  setAuthError(msg)
                } finally {
                  setAuthBusy(false)
                }
              }}
              className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl"
            >
              {authBusy ? '处理中...' : authMode === 'login' ? '登录' : '注册并登录'}
            </button>
            {!!authError && <div className="text-sm text-red-200 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{authError}</div>}
            <div className="text-center text-white/60 text-sm">
              {authMode === 'login' ? (
                <button
                  className="hover:text-white"
                  onClick={() => setAuthMode('register')}
                >
                  没有账号？去注册
                </button>
              ) : (
                <button
                  className="hover:text-white"
                  onClick={() => setAuthMode('login')}
                >
                  已有账号？去登录
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
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-white shadow-xl fixed h-full z-30">
        <div className="p-4 border-b"><div className="flex items-center space-x-3"><div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div><span className="text-xl font-bold bg-gradient-to-r from-pink-600 to-purple-600 bg-clip-text text-transparent">TikGen AI</span></div></div>
        <nav className="p-4 space-y-2">
          <NavPrimary icon={<Wand2 className="w-5 h-5" />} label="创作" active={mainNav === 'create'} onClick={() => setMainNav('create')} />
          {mainNav === 'create' && (
            <div className="pl-3 space-y-1">
              <NavSecondary icon={<Video className="w-4 h-4" />} label="视频生成" active={createNav === 'video'} onClick={() => setCreateNav('video')} />
              <NavSecondary icon={<Image className="w-4 h-4" />} label="图片生成" active={createNav === 'image'} onClick={() => setCreateNav('image')} />
            </div>
          )}

          <NavPrimary icon={<Library className="w-5 h-5" />} label="任务中心" active={mainNav === 'tasks'} onClick={() => setMainNav('tasks')} />
          <NavPrimary icon={<Settings2 className="w-5 h-5" />} label="工具" active={mainNav === 'tools'} onClick={() => setMainNav('tools')} />
          {mainNav === 'tools' && (
            <div className="pl-3 space-y-1">
              <NavSecondary icon={<Scissors className="w-4 h-4" />} label="去字幕" active={toolNav === 'subtitle'} onClick={() => setToolNav('subtitle')} />
              <NavSecondary icon={<Eraser className="w-4 h-4" />} label="去水印" active={toolNav === 'watermark'} onClick={() => setToolNav('watermark')} />
              <NavSecondary icon={<WandSparkles className="w-4 h-4" />} label="画质提升" active={toolNav === 'upscale'} onClick={() => setToolNav('upscale')} />
            </div>
          )}

          <NavPrimary
            icon={<Folder className="w-5 h-5" />}
            label="资产库"
            active={mainNav === 'assets'}
            onMouseEnter={() => {
              void prefetchAssetsCacheIfNeeded()
            }}
            onClick={() => setMainNav('assets')}
          />
          <NavPrimary icon={<Crown className="w-5 h-5" />} label="个人权益" active={mainNav === 'benefits'} onClick={() => setMainNav('benefits')} />
        </nav>
      </aside>
      <main className="flex-1 ml-64">
        <header className="bg-white shadow-sm sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button className="p-2 hover:bg-gray-100 rounded-lg"><Menu className="w-5 h-5" /></button>
              <h1 className="text-xl font-bold">
                {mainNav === 'create' && createNav === 'video' && '视频生成'}
                {mainNav === 'create' && createNav === 'image' && '图片生成'}
                {mainNav === 'tasks' && '任务中心'}
                {mainNav === 'tools' && (toolNav === 'subtitle' ? '去字幕' : toolNav === 'watermark' ? '去水印' : '画质提升')}
                {mainNav === 'assets' && '资产库'}
                {mainNav === 'benefits' && '个人权益'}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 bg-gradient-to-r from-pink-50 to-purple-50 px-4 py-2 rounded-full"><Zap className="w-5 h-5 text-pink-500" /><span className="font-bold text-pink-600">{user?.credits}</span><span className="text-sm text-pink-500">积分</span></div>
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-amber-50 rounded-full">
                <Crown className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium text-amber-700">{currentPackage?.name}</span>
                <span className="text-xs text-amber-600/80">至 {user?.packageExpiresAt}</span>
              </div>
              <div className="flex items-center space-x-2"><div className="w-8 h-8 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full flex items-center justify-center"><User className="w-4 h-4 text-white" /></div><span className="text-sm font-medium">{user?.name}</span></div>
              <button
                onClick={handleLogout}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>
        <div className="p-6">
          {/* Keep generators mounted so in-flight tasks survive nav switches. */}
          <div className={mainNav === 'create' && createNav === 'video' ? '' : 'hidden'}>
            <VideoGenerator />
          </div>
          <div className={mainNav === 'create' && createNav === 'image' ? '' : 'hidden'}>
            <ImageGenerator />
          </div>
          {mainNav === 'assets' && <Assets />}
          {mainNav === 'benefits' && <Packages user={user} onRefreshUser={refreshCurrentUser} />}
          {mainNav === 'tasks' && <TaskCenter />}
          {mainNav === 'tools' && <div className="text-center py-20 text-gray-500">工具功能下一版推出</div>}
        </div>
      </main>
    </div>
  )
}

function NavPrimary({ icon, label, active, onClick, onMouseEnter }: any) {
  return (
    <button
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${
        active ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  )
}

function NavSecondary({ icon, label, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center space-x-2 px-4 py-2 rounded-lg transition-all text-sm ${
        active ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function VideoGenerator() {
  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState('')
  const [refImageDataUrl, setRefImageDataUrl] = useState('')
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
  const stopPollingRef = useRef(false)

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
    setIsAiBusy(true)
    try {
      const parsed = await parseProductInfo({ refImage: refImageDataUrl, language: productInfo.language || '简体中文', kind: 'video' })
      setProductInfo(parsed)
    } catch (e: any) {
      setAiError(e?.message || '解析失败')
    } finally {
      setIsAiBusy(false)
    }
  }

  const handleNext = async () => {
    setAiError('')
    if (modalStep === 1) {
      setModalStep(2)
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
        setScripts(r.scripts)
        setScriptBatches([r.scripts])
        setScriptBatchIdx(0)
        setScriptRefreshCount(0)
        setSelectedScript(r.scripts[0] || '')
      } catch (e: any) {
        setAiError(e?.message || '脚本生成失败')
      } finally {
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
    try {
      const r = await generateVideoScripts({
        product: productInfo,
        language: productInfo.language,
        refImage: refImageDataUrl,
        durationSec,
        aspectRatio: size,
        resolution,
      })
      setScriptBatches((prev) => [...prev, r.scripts])
      setScriptBatchIdx(scriptBatches.length)
      setScriptRefreshCount((c) => Math.min(2, c + 1))
      setScripts(r.scripts)
      setSelectedScript(r.scripts[0] || '')
    } catch (e: any) {
      setAiError(e?.message || '脚本生成失败')
    } finally {
      setIsAiBusy(false)
    }
  }

  const handleOptimize = async (tag: string) => {
    const newTags = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
    setTags(newTags)
    setAiError('')
    setIsAiBusy(true)
    try {
      const r = await beautifyScript({ script: selectedScript, tags: newTags, language: productInfo.language })
      setOptimizedPrompt(r.optimized)
    } catch (e: any) {
      setAiError(e?.message || '优化失败')
    } finally {
      setIsAiBusy(false)
    }
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
          throw new Error(s.failReason || '生成失败')
        }

        setStatusText(`生成中... ${s.progress || ''}`.trim())
      }

      throw new Error('生成超时，请稍后在任务列表中查看')
    } catch (e: any) {
      setErrorText(e?.message || '生成失败')
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
              <div className="bg-white shadow-lg border rounded-2xl px-6 py-5 flex items-center">
                <RefreshCw className="w-5 h-5 text-purple-600 animate-spin mr-3" />
                <div>
              <div className="font-medium">
                {modalStep === 3 ? '视频脚本优化中' : modalStep === 2 ? '视频脚本创作中' : '商品信息AI解析中'}
              </div>
                  <div className="text-sm text-gray-500">请稍等，预计几秒钟...</div>
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
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
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
          <div className="h-96 flex flex-col items-center justify-center bg-gray-50 rounded-xl px-6 text-center">
            <RefreshCw className="w-16 h-16 animate-spin text-purple-500" />
            <p className="mt-4 text-lg text-purple-600 font-medium">{statusText || '视频生成中...'}</p>
            <p className="text-sm text-gray-500 mt-1">进度：{progress}</p>
            {taskId && <p className="text-xs text-gray-400 mt-3 break-all">任务ID：{taskId}</p>}
          </div>
        ) : errorText ? (
          <div className="h-96 flex flex-col items-center justify-center text-center bg-red-50 rounded-xl px-6">
            <p className="text-red-600 font-medium">生成失败</p>
            <p className="text-sm text-red-500 mt-2 break-words">{errorText}</p>
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

function ImageGenerator() {
  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState('')
  const [refImageDataUrl, setRefImageDataUrl] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('seedream')
  const [size, setSize] = useState<ImageAspect>('1:1')
  const [resolution, setResolution] = useState<ImageRes>('2048')
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
  const [isAiBusy, setIsAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [imageModels, setImageModels] = useState<{ id: string; name: string }[]>(IMAGE_MODELS)

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

  const handlePromptGen = async () => {
    if (!refImageDataUrl) {
      alert('请先上传参考图')
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
    setIsAiBusy(true)
    try {
      const parsed = await parseProductInfo({ refImage: refImageDataUrl, language: productInfo.language || '简体中文', kind: 'image' })
      setProductInfo(parsed)
    } catch (e: any) {
      setAiError(e?.message || '解析失败')
    } finally {
      setIsAiBusy(false)
    }
  }

  const handleNext = async () => {
    setAiError('')
    if (modalStep === 1) {
      setModalStep(2)
      setIsAiBusy(true)
      try {
        const r = await generateImagePrompt({ product: productInfo, language: productInfo.language, aspectRatio: size, resolution, sceneMode })
        setOptimizedPrompt(r.prompt)
        setOptimizedNegativePrompt(r.negativePrompt || '')
        const hint = String((r as any)?.categoryHint || 'other')
        setCategoryHint(hint)
        const presetParts = applySceneModePreset(sceneMode, r.parts || {})
        const initialParts = applyLearnedTweaks(hint, presetParts)
        setPromptParts(initialParts)
        setOptimizedPrompt(r.prompt || buildPromptFromParts(initialParts))
      } catch (e: any) {
        setAiError(e?.message || '提示词生成失败')
      } finally {
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
      setPromptParts(result.parts || currentParts)
      const nextPrompt = result.prompt || buildPromptFromParts(result.parts || currentParts)
      setOptimizedPrompt(nextPrompt)
      setOptimizedNegativePrompt(result.negativePrompt || '')
      setSelectedStyleTags([])
    } catch (e: any) {
      setAiError(e?.message || 'AI精修失败')
    } finally {
      setIsAiBusy(false)
    }
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
    if (!prompt) {
      alert('请输入图片描述')
      return
    }
    setIsGenerating(true)
    setGeneratedImage('')
    setQcResult(null)
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
      })
      setGeneratedImage(r.imageUrl)
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
      alert(e?.message || '生成失败')
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
              <div className="bg-white shadow-lg border rounded-2xl px-6 py-5 flex items-center">
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
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">创建图片</h2>
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
                  metadata: { from: 'image_generator_ref', mime: f.type, size: f.size },
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
            <label className="block text-sm font-medium mb-1">尺寸</label>
            <select value={size} onChange={e => setSize(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {imageCaps.aspectRatios.map((ar) => (
                <option key={ar} value={ar}>
                  {ar}
                </option>
              ))}
            </select>
          </div>
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
        </div>
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">图片文案描述</label>
            <button
              onClick={handlePromptGen}
              className="px-3 py-1.5 rounded-full text-sm bg-purple-50 text-purple-700 hover:bg-purple-100 flex items-center"
            >
              <Sparkles className="w-4 h-4 mr-1" /> 一键生成提示词
            </button>
          </div>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full px-4 py-3 border rounded-xl min-h-[140px]" placeholder="输入画面描述/风格，或使用一键生成提示词..." />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1">AI模型</label>
            <select value={model} onChange={e => setModel(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {imageModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div />
        </div>
        <button onClick={handleGenerate} disabled={isGenerating || !prompt} className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50">{isGenerating ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin inline" />生成中...</> : '生成图片'}</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">生成结果</h2>
        {isGenerating ? (
          <div className="h-96 flex flex-col items-center justify-center bg-gray-50 rounded-xl px-6 text-center">
            <RefreshCw className="w-16 h-16 animate-spin text-purple-500" />
            <p className="mt-4 text-lg text-purple-600 font-medium">图片生成中，请稍等...</p>
            <div className="w-full max-w-md mt-6">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>生成进度</span>
                <span className="tabular-nums">{Math.max(1, Math.min(99, genProgress))}%</span>
              </div>
              <div className="h-3 bg-white rounded-full border overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full transition-all"
                  style={{ width: `${Math.max(1, Math.min(99, genProgress))}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-gray-500">生成完成后会自动进行一次电商主图质检</div>
            </div>
          </div>
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
        ) : (
          <div className="h-96 flex items-center justify-center text-gray-400 border-2 border-dashed rounded-xl"><Image className="w-16 h-16 opacity-50" /></div>
        )}
      </div>
    </div>
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
        <div className="h-28 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden">
          {isImage ? (
            <img src={a.url} alt={a.name || 'asset'} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <video src={a.url} className="w-full h-full object-cover" preload="metadata" />
          )}
        </div>
        <div className="mt-2 text-xs text-gray-600 truncate">{a.name || `${a.type} 资产`}</div>
        <div className="mt-1 text-[11px] text-gray-400">{new Date(a.created_at).toLocaleString()}</div>
        <div className="mt-2 flex gap-2">
          <a href={a.url} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded border">预览</a>
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
            <h3 className="font-bold">用户上传</h3>
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
          <p className="text-sm text-gray-500">包含：创作模块上传 + 资产库手动上传，均归档到当前账号。</p>
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

function Packages({ user, onRefreshUser }: { user: any; onRefreshUser: () => Promise<void> }) {
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

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-8 text-center">选择您的套餐</h2>
      <div className="mb-6 bg-white rounded-2xl p-4 shadow border flex items-center justify-between">
        <div className="text-sm text-gray-600">
          当前套餐：
          <span className="font-semibold text-gray-900 ml-1">{user?.package || 'trial'}</span>
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
        {PACKAGES.map((pkg) => (
          <div
            key={pkg.id}
            className={`bg-white rounded-2xl p-6 shadow-lg border-2 ${pkg.id === 'basic' ? 'border-purple-500' : 'border-transparent'}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">{pkg.name}</h3>
              {pkg.id === 'basic' && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">推荐</span>}
            </div>
            <div className="mt-4">
              <div className="text-3xl font-extrabold">{pkg.price}</div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              {pkg.features.map((f) => (
                <li key={f} className="flex items-center">
                  <Check className="w-4 h-4 text-green-500 mr-2" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              className={`mt-6 w-full py-3 rounded-xl font-bold ${
                pkg.id === 'trial' ? 'bg-gray-100 text-gray-700' : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white'
              }`}
              disabled={busyPlan === pkg.id}
              onClick={async () => {
                setPayError('')
                if (pkg.id === 'trial') return
                if (!accessToken) return alert('请先登录')
                setBusyPlan(pkg.id)
                try {
                  const r = await createOrder({ planId: pkg.id, payType }, accessToken)
                  setPayInfo({ orderId: r.orderId, qrcode: r.qrcode, payUrl: r.payUrl, status: 'created', planId: pkg.id })
                } catch (e: any) {
                  setPayError(e?.message || '下单失败')
                } finally {
                  setBusyPlan('')
                }
              }}
            >
              {pkg.id === 'trial' ? '当前试用' : busyPlan === pkg.id ? '下单中...' : '立即开通'}
            </button>
          </div>
        ))}
      </div>
      {!!payError && <div className="mt-6 p-3 rounded-xl bg-red-50 text-red-600 text-sm">{payError}</div>}
    </div>
  )
}

export default App